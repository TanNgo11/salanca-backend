/**
 * Targeted production update (2026-10-10), VI + EN:
 * - experience-page: Rodizio green/red cards and the heritage block;
 * - menu-package "buffet": drop the duplicate CHURRASCARIA included item;
 * - header-setting: drop the Desserts submenu link (category is unpublished).
 *
 * Nothing else is touched. Preview by default; pass --apply to write.
 * Usage (backend container, /app): node scripts/seed-experience-update.mjs [--apply]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadStrapiApp } from './lib/strapi-load.mjs';
import { editableProjection, populateFor } from './lib/content-release.helper.mjs';
import { ensureContentMedia } from './lib/content-import/media.mjs';
import {
  EXPERIENCE_UID,
  HEADER_UID,
  PACKAGE_UID,
  experienceFields,
  experienceMediaSources,
  stripIds,
  withoutDuplicateTitles,
  withoutRetiredMenuLinks,
} from './lib/experience-update.helper.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw new Error('Usage: node scripts/seed-experience-update.mjs [--apply]');
const apply = args.includes('--apply');
const locales = ['vi', 'en'];

process.chdir(resolve(import.meta.dirname, '..'));
const bundle = JSON.parse(readFileSync('data/content-release/bundle.json', 'utf8'));
const mediaSources = experienceMediaSources(bundle, locales);

const normalize = value => Array.isArray(value)
  ? value.map(normalize)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'createdAt', 'updatedAt', 'publishedAt'].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, normalize(v)]))
    : value;

const app = await loadStrapiApp();
try {
  if (apply && app.config.get('plugin::upload.provider') !== 'aws-s3') throw new Error('Apply requires the configured S3 upload provider.');

  /** Loads draft + published, refusing when the draft holds unpublished edits. */
  const target = async (uid, locale, filters) => {
    const find = status => app.documents(uid).findFirst({ locale, status, populate: populateFor(app, uid), ...(filters ? { filters } : {}) });
    const [draft, live] = [await find('draft'), await find('published')];
    if (!draft || !live) throw new Error(`Missing published ${uid}/${locale}.`);
    const changed = Object.keys(editableProjection(app, uid, draft)).filter(key =>
      JSON.stringify(normalize(editableProjection(app, uid, draft)[key])) !== JSON.stringify(normalize(editableProjection(app, uid, live)[key])));
    if (changed.length > 0) throw new Error(`Unpublished edits in ${uid}/${locale} (${changed.join(', ')}); publish or discard them first.`);
    return { draft, live };
  };

  const plan = [];
  const snapshot = { createdAt: new Date().toISOString(), purpose: 'seed-experience-update recovery snapshot', documents: {} };
  for (const locale of locales) {
    const experience = await target(EXPERIENCE_UID, locale);
    snapshot.documents[`${EXPERIENCE_UID}:${locale}`] = experience.live;
    plan.push({ uid: EXPERIENCE_UID, locale, documentId: experience.draft.documentId, fields: 'experience', note: 'Rodizio cards + heritage block' });

    const buffet = await target(PACKAGE_UID, locale, { slug: 'buffet' });
    snapshot.documents[`${PACKAGE_UID}:buffet:${locale}`] = buffet.live;
    const includedItems = withoutDuplicateTitles(stripIds(buffet.live.includedItems));
    if (includedItems) plan.push({ uid: PACKAGE_UID, locale, documentId: buffet.draft.documentId, data: { includedItems }, note: `includedItems ${buffet.live.includedItems.length} -> ${includedItems.length}` });

    const header = await target(HEADER_UID, locale);
    snapshot.documents[`${HEADER_UID}:${locale}`] = header.live;
    const menuLinks = withoutRetiredMenuLinks(stripIds(header.live.menuLinks));
    if (menuLinks) plan.push({ uid: HEADER_UID, locale, documentId: header.draft.documentId, data: { menuLinks }, note: `menuLinks ${header.live.menuLinks.length} -> ${menuLinks.length}` });
  }

  for (const step of plan) console.log(`${apply ? 'UPDATE' : 'WOULD UPDATE'} ${step.uid}/${step.locale}: ${step.note}`);
  console.log(`Media: ${[...new Set(mediaSources.values())].join(', ')}`);

  if (!apply) {
    console.log('Preview only. Re-run with --apply to write.');
  } else {
    const backupDir = resolve('.tmp/content-deploy-backups');
    mkdirSync(backupDir, { recursive: true });
    const backupPath = resolve(backupDir, `${Date.now()}-experience-update.json`);
    writeFileSync(backupPath, JSON.stringify(snapshot, null, 2), { mode: 0o600, flag: 'wx' });
    console.log(`Recovery snapshot saved: ${backupPath}`);

    process.env.SALANCA_SEED_REQUIRE_S3 = 'true';
    const bySource = await ensureContentMedia(app, { record() {} }, [...new Set(mediaSources.values())]);
    const mediaIds = new Map([...mediaSources].map(([file, source]) => [file, bySource.get(source)]));

    for (const step of plan) {
      const data = step.fields === 'experience' ? experienceFields(bundle, step.locale, mediaIds) : step.data;
      await app.documents(step.uid).update({ documentId: step.documentId, locale: step.locale, data });
      await app.documents(step.uid).publish({ documentId: step.documentId, locale: step.locale });
      console.log(`PUBLISHED ${step.uid}/${step.locale}`);
    }
    console.log('Done. Revalidate or redeploy the web if pages do not refresh.');
  }
} finally {
  await app.destroy().catch(() => {});
}
process.exit(0);
