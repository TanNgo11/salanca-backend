import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadStrapiApp } from './lib/strapi-load.mjs';
import { allUids, collectionFields, singleUids, locales, populateFor, serialize, sha, replaceFiles, validateBundle, editableProjection, matchesRestoredGallery } from './content-bundle.helper.mjs';

process.chdir(resolve(import.meta.dirname, '..'));
const args = process.argv.slice(2).filter(a => a !== '--');
const [mode, directory] = args;
if (!['pack', 'deploy', 'seed'].includes(mode) || !directory) throw new Error('Use seed-production-content.mjs or content:pack / content:deploy.');
const shipped = mode === 'seed';
const restoreStory = args.includes('--restore-story');
const restoreBooking = args.includes('--restore-booking');
const restoredSingleUid = restoreBooking ? 'api::booking-page.booking-page' : restoreStory ? 'api::story-page.story-page' : undefined;
const restoreMarketing = args.includes('--restore-marketing-pages');
const restorePages = args.includes('--restore-experience-space') || restoreMarketing || restoreStory || restoreBooking;
if (args.filter(arg => arg.startsWith('--restore-')).length > 1) throw new Error('Choose one restoration scope.');
if (restorePages && !shipped) throw new Error('Page restoration requires the shipped release.');
const restoredUids = restoredSingleUid ? [restoredSingleUid] : ['api::gallery-item.gallery-item', 'api::experience-page.experience-page', 'api::space-page.space-page', ...(restoreMarketing ? ['api::campaign.campaign', 'api::campaign-page.campaign-page', 'api::contact-page.contact-page', 'api::location.location'] : [])];
if (shipped && resolve(directory) !== resolve('data/content-release')) throw new Error('Owner seed must use the shipped release.');
if (args.includes('--prune')) throw new Error('Content bundles never prune.');
const root = resolve(directory);
const manifestPath = resolve(root, 'bundle.json');
const apply = args.includes('--apply');
let bundle;
if (mode === 'pack' && existsSync(root)) throw new Error('Choose a new output directory; existing bundles are preserved.');
if (mode !== 'pack') {
  bundle = JSON.parse(readFileSync(manifestPath, 'utf8'));
  validateBundle(bundle);
  for (const file of bundle.files) {
    if (shipped && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file.sourceFile ?? '')) throw new Error('Unsafe source artwork path.');
    const path = shipped ? resolve('data/media/salanca', file.sourceFile) : resolve(root, 'media', file.name);
    if (sha(readFileSync(path)) !== file.sha256) throw new Error(`Checksum mismatch: ${file.name}`);
  }
}
const app = await loadStrapiApp();
try {
  const schemaHash = sha(JSON.stringify(allUids.map(uid => [uid, app.contentTypes[uid]?.attributes]).concat(Object.entries(app.components).sort(([a], [b]) => a.localeCompare(b)))));
  if (mode === 'pack') {
    const rows = new Map(), refs = new Map(), media = new Map();
    for (const uid of allUids) {
      for (const locale of locales) {
        const found = await app.documents(uid).findMany({ locale, status: 'published', populate: populateFor(app, uid), limit: 2000 });
        if (found.length >= 2000) throw new Error('Export limit reached; refusing truncated snapshot.');
        if (singleUids.includes(uid) && found.length !== 1) throw new Error(`Expected one published ${uid}/${locale}.`);
        rows.set(`${uid}:${locale}`, found);
      }
      if (collectionFields[uid]) {
        const primary = rows.get(`${uid}:vi`), english = rows.get(`${uid}:en`);
        if (primary.length !== english.length || english.some(r => !primary.some(p => p.documentId === r.documentId))) throw new Error(`Incomplete bilingual collection: ${uid}`);
        const identities = new Set();
        for (const row of primary) {
          const key = row[collectionFields[uid]];
          if (!key || identities.has(key)) throw new Error(`Missing/duplicate identity: ${uid}`);
          identities.add(key); refs.set(`${uid}:${row.documentId}`, key);
        }
      }
    }
    const payload = { liveSnapshot: true, generatedFrom: 'Published local CMS snapshot', locales, collections: {}, pages: {} };
    for (const uid of allUids) {
      const localized = locale => rows.get(`${uid}:${locale}`);
      const data = (locale, row) => serialize(app, uid, row, refs, media);
      if (uid === 'api::location.location') {
        if (localized('vi').length !== 1) throw new Error('Expected exactly one location.');
        payload.collections[uid] = Object.fromEntries(locales.map(locale => [locale, data(locale, localized(locale)[0])]));
      } else if (collectionFields[uid]) {
        payload.collections[uid] = { matchField: collectionFields[uid], entries: localized('vi').map(row => ({ key: refs.get(`${uid}:${row.documentId}`), ...Object.fromEntries(locales.map(locale => [locale, data(locale, localized(locale).find(r => r.documentId === row.documentId))])) })) };
      } else {
        const values = Object.fromEntries(locales.map(locale => [locale, data(locale, localized(locale)[0])]));
        const setting = { 'api::global-setting.global-setting': 'globalSetting', 'api::header-setting.header-setting': 'headerSetting', 'api::footer-setting.footer-setting': 'footerSetting' }[uid];
        if (setting) payload[setting] = values; else payload.pages[uid] = values;
      }
    }
    mkdirSync(resolve(root, 'media'), { recursive: true });
    const files = [], names = new Map();
    for (const [id, file] of media) {
      let bytes;
      if (file.url.startsWith('/uploads/')) {
        if (file.url.includes('..')) throw new Error('Unsafe upload path.');
        bytes = readFileSync(resolve('public', `.${file.url}`));
      } else {
        const url = new URL(file.url), cdn = new URL(process.env.CDN_URL);
        if (url.protocol !== 'https:' || url.origin !== cdn.origin || url.username || url.password) throw new Error('Media URL must belong to configured HTTPS CDN_URL.');
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(`Unable to download media id ${id}: HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
      }
      const hash = sha(bytes), name = hash + extname(file.name).toLowerCase();
      names.set(String(id), name);
      files.push({ name, sha256: hash, originalName: file.name });
      writeFileSync(resolve(root, 'media', name), bytes);
    }
    bundle = { version: 1, createdAt: new Date().toISOString(), schemaHash, files, payload: replaceFiles(payload, names) };
    bundle.payload.media = [...new Set(files.map(f => f.name))];
    validateBundle(bundle);
    writeFileSync(manifestPath, JSON.stringify(bundle, null, 2));
    console.log(`Packed published VI/EN marketing content and ${files.length} media files into ${root}.`);
  } else {
    if (bundle.schemaHash !== schemaHash) throw new Error('Schema mismatch. Deploy matching backend code before content.');
    if (shipped && app.config.get('plugin::upload.provider') !== 'aws-s3') throw new Error('This seed requires the configured S3 upload provider.');
    const recovery = { createdAt: new Date().toISOString(), purpose: 'Marketing content recovery snapshot; not a full database backup', documents: {} };
    const restoreRefs = new Map();
    if (restorePages) {
      const locations = await app.documents('api::location.location').findMany({ locale: 'vi', status: 'published', limit: 2000 });
      for (const row of locations) restoreRefs.set(`api::location.location:${row.documentId}`, row.slug);
    }
    let count = 0;
    for (const uid of restorePages ? restoredUids : allUids) for (const locale of locales) {
      const published = await app.documents(uid).findMany({ locale, status: 'published', populate: populateFor(app, uid), limit: 2000 });
      const drafts = await app.documents(uid).findMany({ locale, status: 'draft', populate: populateFor(app, uid), limit: 2000 });
      if (published.length >= 2000 || drafts.length >= 2000) throw new Error('Target limit reached; refusing ambiguous preview.');
      recovery.documents[`${uid}:${locale}`] = { published, drafts };
      // Compare raw populated records after removing framework-only metadata.
      const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'createdAt', 'updatedAt', 'publishedAt'].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, normalize(v)])) : value;
      const incoming = collectionFields[uid] && uid !== 'api::location.location' ? bundle.payload.collections[uid].entries.map(e => e[locale]) : [uid === 'api::location.location' ? bundle.payload.collections[uid][locale] : (bundle.payload.pages[uid] ?? bundle.payload[{ 'api::global-setting.global-setting': 'globalSetting', 'api::header-setting.header-setting': 'headerSetting', 'api::footer-setting.footer-setting': 'footerSetting' }[uid]])[locale]];
      for (const data of incoming) {
        const field = collectionFields[uid];
        const matches = drafts.filter(r => !field || r[field] === data[field]);
        if (matches.length > 1) throw new Error(`Ambiguous target ${uid}/${locale}.`);
        const draft = matches[0], live = draft && published.find(r => r.documentId === draft.documentId);
        const draftContent = editableProjection(app, uid, draft), liveContent = editableProjection(app, uid, live);
        const approvedGallery = restorePages && uid === 'api::gallery-item.gallery-item' && !live && draft && matchesRestoredGallery(app, draft, data, bundle, restoreRefs);
        if (draft && !approvedGallery && (!live || JSON.stringify(normalize(draftContent)) !== JSON.stringify(normalize(liveContent)))) {
          const changed = live ? Object.keys(draftContent).filter(key => JSON.stringify(normalize(draftContent[key])) !== JSON.stringify(normalize(liveContent[key]))) : ['unpublished document'];
          throw new Error(`Unpublished target edits: ${uid}/${locale} (${changed.join(', ')}); preserved.`);
        }
        console.log(`${draft ? 'UPDATE' : 'CREATE'} ${uid}/${locale}`); count++;
      }
    }
    const selectedMedia = new Set();
    const collectMedia = value => {
      if (!value || typeof value !== 'object') return;
      if (value.__file) selectedMedia.add(value.__file);
      for (const nested of Object.values(value)) collectMedia(nested);
    };
    if (restoredSingleUid) collectMedia(bundle.payload.pages[restoredSingleUid]);
    else if (restorePages) {
      collectMedia(bundle.payload.pages['api::experience-page.experience-page']);
      collectMedia(bundle.payload.pages['api::space-page.space-page']);
      collectMedia(bundle.payload.collections['api::gallery-item.gallery-item']);
      if (restoreMarketing) {
        collectMedia(bundle.payload.pages['api::campaign-page.campaign-page']);
        collectMedia(bundle.payload.pages['api::contact-page.contact-page']);
        collectMedia(bundle.payload.collections['api::campaign.campaign']);
      }
    }
    console.log(`Preview: ${count} localized documents, ${restorePages ? selectedMedia.size : bundle.files.length} media files. No pruning.`);
    if (apply && shipped) {
      const backupDir = resolve('.tmp/content-deploy-backups'); mkdirSync(backupDir, { recursive: true });
      const backupPath = resolve(backupDir, `${Date.now()}-marketing.json`);
      writeFileSync(backupPath, JSON.stringify(recovery, null, 2), { mode: 0o600, flag: 'wx' });
      console.log(`Marketing recovery snapshot saved: ${backupPath}`);
    } else if (apply) {
      const connection = app.config.get('database.connection.connection');
      const dbUrl = connection.connectionString ? new URL(connection.connectionString) : null;
      const database = dbUrl ? decodeURIComponent(dbUrl.pathname.slice(1)) : connection.database;
      const expected = args[args.indexOf('--database') + 1];
      if (!args.includes('--database') || expected !== database) throw new Error('Apply requires --database matching the destination database name.');
      const backupDir = resolve('.tmp/content-deploy-backups'); mkdirSync(backupDir, { recursive: true });
      const dumpPath = resolve(backupDir, `${Date.now()}.dump`);
      const sslMode = dbUrl?.searchParams.get('sslmode') || (connection.ssl ? connection.ssl.rejectUnauthorized === false ? 'require' : 'verify-full' : undefined);
      const backup = spawnSync(process.env.PG_DUMP_BIN || 'pg_dump', ['--format=custom', '--file', dumpPath], { env: { ...process.env, PGHOST: dbUrl?.hostname || connection.host, PGPORT: dbUrl?.port || String(connection.port), PGUSER: dbUrl ? decodeURIComponent(dbUrl.username) : connection.user, PGPASSWORD: dbUrl ? decodeURIComponent(dbUrl.password) : connection.password, PGDATABASE: database, ...(sslMode ? { PGSSLMODE: sslMode } : {}) }, stdio: ['ignore', 'inherit', 'pipe'] });
      if (backup.status !== 0) throw new Error('PostgreSQL backup failed. Set PG_DUMP_BIN; no content writes performed.');
      console.log(`Backup saved: ${dumpPath}`);
    }
  }
} finally { await app.destroy(); }
if (mode !== 'pack' && apply) {
  const executionRoot = shipped ? resolve('.tmp', `content-seed-${Date.now()}`) : root;
  if (shipped) {
    mkdirSync(resolve(executionRoot, 'media'), { recursive: true });
    for (const file of bundle.files) copyFileSync(resolve('data/media/salanca', file.sourceFile), resolve(executionRoot, 'media', file.name));
  }
  const payloadPath = resolve(executionRoot, 'payload.json'); writeFileSync(payloadPath, JSON.stringify(bundle.payload));
  const result = spawnSync(process.execPath, ['scripts/seed-salanca-content/index.mjs', payloadPath, ...(restorePages ? [restoreBooking ? '--restore-booking' : restoreStory ? '--restore-story' : restoreMarketing ? '--restore-marketing-pages' : '--restore-experience-space'] : [])], { env: { ...process.env, SALANCA_WEB_MEDIA_DIR: resolve(executionRoot, 'media'), ...(shipped ? { SALANCA_SEED_REQUIRE_S3: 'true' } : {}) }, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Seed failed; partial writes may exist. Preserve the recorded recovery snapshot and inspect the failure before retrying.');
  console.log('Content/media deployment complete. Rebuild/revalidate the frontend using its existing deployment pipeline.');
}
