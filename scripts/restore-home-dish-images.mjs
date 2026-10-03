/** Restore only the six featured dish images; content stays editable in Strapi. */
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadStrapiApp } from './lib/strapi-load.mjs';
import { sha, populateFor, editableProjection } from './content-bundle.helper.mjs';
import { ensureContentMedia } from './seed-salanca-content/media.mjs';
import { createSummary } from './lib/seed-document.mjs';

process.chdir(resolve(import.meta.dirname, '..'));
if (process.argv.length > 2) throw new Error('Usage: node scripts/restore-home-dish-images.mjs');
const keys = ['picanha', 'costela', 'cupim', 'panceta', 'cordeiro', 'camarao'];
const bundle = JSON.parse(readFileSync('data/content-release/bundle.json', 'utf8'));
const uid = 'api::menu-item.menu-item';
const entries = keys.map(key => bundle.payload.collections[uid].entries.find(entry => entry.key === key));
const files = new Map();
for (const entry of entries) {
  if (!entry) throw new Error('Missing featured dish in release.');
  for (const locale of ['vi', 'en']) {
    const name = entry[locale].image?.media?.__file;
    const file = bundle.files.find(file => file.name === name);
    if (!file || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file.sourceFile)) throw new Error('Invalid original artwork.');
    if (sha(readFileSync(resolve('data/media/salanca', file.sourceFile))) !== file.sha256) throw new Error('Original artwork checksum mismatch.');
    files.set(name, file);
  }
}
const app = await loadStrapiApp();
try {
  if (app.config.get('plugin::upload.provider') !== 'aws-s3') throw new Error('Configured S3 provider is required.');
  const targets = [], recovery = [];
  const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)])) : value;
  for (const entry of entries) for (const locale of ['vi', 'en']) {
    const query = { locale, filters: { slug: entry[locale].slug }, populate: populateFor(app, uid), limit: 2 };
    const published = await app.documents(uid).findMany({ ...query, status: 'published' });
    const drafts = await app.documents(uid).findMany({ ...query, status: 'draft' });
    if (published.length !== 1 || drafts.length !== 1 || published[0].documentId !== drafts[0].documentId) throw new Error(`Missing/ambiguous published dish: ${entry.key}/${locale}`);
    if (JSON.stringify(normalize(editableProjection(app, uid, published[0]))) !== JSON.stringify(normalize(editableProjection(app, uid, drafts[0])))) throw new Error(`Unpublished dish edits preserved: ${entry.key}/${locale}`);
    targets.push({ entry, locale, documentId: published[0].documentId });
    recovery.push({ locale, published: published[0], draft: drafts[0] });
  }
  const root = resolve('.tmp', `home-dish-images-${Date.now()}`);
  mkdirSync(resolve(root, 'media'), { recursive: true });
  writeFileSync(resolve(root, 'recovery.json'), JSON.stringify(recovery, null, 2), { mode: 0o600, flag: 'wx' });
  for (const file of files.values()) copyFileSync(resolve('data/media/salanca', file.sourceFile), resolve(root, 'media', file.name));
  process.env.SALANCA_WEB_MEDIA_DIR = resolve(root, 'media');
  process.env.SALANCA_SEED_REQUIRE_S3 = 'true';
  const summary = createSummary();
  const media = await ensureContentMedia(app, summary, [...files.keys()]);
  for (const { entry, locale, documentId } of targets) {
    const { media: source, ...attributes } = entry[locale].image;
    await app.documents(uid).update({ documentId, locale, data: { image: { ...attributes, media: media.get(source.__file) } } });
    await app.documents(uid).publish({ documentId, locale });
    console.log(`Restored image: ${entry.key}/${locale}`);
  }
  console.log(`Restored six featured dish images in VI/EN. Media: ${summary.toString()}. Recovery: ${resolve(root, 'recovery.json')}`);
} catch (error) {
  console.error('Featured dish image restoration failed:', error);
  process.exitCode = 1;
} finally {
  // Windows pg/tarn may reject pending clients during pool shutdown after writes.
  const shutdownError = error => {
    if (error?.message === 'aborted') console.warn('Strapi shutdown warning: aborted');
    else { console.error('Strapi shutdown failed:', error); process.exitCode = 1; }
  };
  process.on('uncaughtException', shutdownError);
  process.on('unhandledRejection', shutdownError);
  await app.destroy().catch(shutdownError);
}
