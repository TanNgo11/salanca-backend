/** Restore the approved homepage space block through Strapi and configured S3. */
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadStrapiApp } from './lib/strapi-load.mjs';
import { sha, populateFor, editableProjection } from './content-bundle.helper.mjs';
import { ensureContentMedia } from './seed-salanca-content/media.mjs';
import { createSummary } from './lib/seed-document.mjs';

process.chdir(resolve(import.meta.dirname, '..'));
const closing = process.argv.slice(2).includes('--restore-closing');
const restoreHero = process.argv.slice(2).includes('--restore-hero');
if (process.argv.slice(2).some(arg => !['--restore-closing', '--restore-hero'].includes(arg))) throw new Error('Usage: node scripts/restore-home-space.mjs [--restore-closing] [--restore-hero]');
const uid = 'api::home-page.home-page';
const bundle = JSON.parse(readFileSync('data/content-release/bundle.json', 'utf8'));
const source = bundle.payload.pages[uid];
const allowed = ['client-interior-main.jpg', 'client-interior-hall.jpg', 'client-interior-veranda.jpg'];
const files = new Map();
for (const locale of ['vi', 'en']) {
  if (source[locale].space.images.length !== 3) throw new Error('Expected three gallery images.');
  source[locale].space.images.forEach((image, index) => {
    const file = bundle.files.find(file => file.name === image.media.__file);
    if (file?.sourceFile !== allowed[index]) throw new Error('Unexpected gallery artwork.');
    if (sha(readFileSync(resolve('data/media/salanca', file.sourceFile))) !== file.sha256) throw new Error('Artwork checksum mismatch.');
    files.set(file.name, file);
  });
  if (closing) {
    const file = bundle.files.find(file => file.name === source[locale].bookingStrip.image.media.__file);
    if (file?.sourceFile !== 'botanical-sketch-v1.png') throw new Error('Unexpected booking illustration.');
    if (sha(readFileSync(resolve('data/media/salanca', file.sourceFile))) !== file.sha256) throw new Error('Booking artwork checksum mismatch.');
    files.set(file.name, file);
  }
  if (restoreHero) {
    for (const [field, original] of [['backgroundImage', 'hero-churrasco-service-v2.png'], ['decorativeImage', 'hero-decor-right.png']]) {
      const file = bundle.files.find(file => file.name === source[locale].hero[field].media.__file);
      if (file?.sourceFile !== original) throw new Error('Unexpected hero artwork.');
      if (sha(readFileSync(resolve('data/media/salanca', file.sourceFile))) !== file.sha256) throw new Error('Hero artwork checksum mismatch.');
      files.set(file.name, file);
    }
  }
}
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)])) : value;
const app = await loadStrapiApp();
try {
  if (app.config.get('plugin::upload.provider') !== 'aws-s3') throw new Error('Configured S3 provider is required.');
  const targets = [], recovery = [];
  for (const locale of ['vi', 'en']) {
    const query = { locale, populate: populateFor(app, uid), limit: 2 };
    const published = await app.documents(uid).findMany({ ...query, status: 'published' });
    const drafts = await app.documents(uid).findMany({ ...query, status: 'draft' });
    if (published.length !== 1 || drafts.length !== 1 || published[0].documentId !== drafts[0].documentId) throw new Error(`Missing/ambiguous homepage: ${locale}`);
    if (JSON.stringify(normalize(editableProjection(app, uid, published[0]))) !== JSON.stringify(normalize(editableProjection(app, uid, drafts[0])))) throw new Error(`Unpublished homepage edits preserved: ${locale}`);
    targets.push({ locale, documentId: published[0].documentId });
    recovery.push({ locale, published: published[0], draft: drafts[0] });
  }
  const root = resolve('.tmp', `home-space-${Date.now()}`);
  mkdirSync(resolve(root, 'media'), { recursive: true });
  writeFileSync(resolve(root, 'recovery.json'), JSON.stringify(recovery, null, 2), { mode: 0o600, flag: 'wx' });
  for (const file of files.values()) copyFileSync(resolve('data/media/salanca', file.sourceFile), resolve(root, 'media', file.name));
  process.env.SALANCA_WEB_MEDIA_DIR = resolve(root, 'media');
  process.env.SALANCA_SEED_REQUIRE_S3 = 'true';
  const summary = createSummary();
  const media = await ensureContentMedia(app, summary, [...files.keys()]);
  for (const { locale, documentId } of targets) {
    const images = source[locale].space.images.map(({ media: file, ...attributes }) => ({ ...attributes, media: media.get(file.__file) }));
    const data = { space: { ...source[locale].space, images } };
    if (closing) {
      const { media: file, ...attributes } = source[locale].bookingStrip.image;
      data.process = source[locale].process;
      data.bookingStrip = { ...source[locale].bookingStrip, image: { ...attributes, media: media.get(file.__file) } };
    }
    if (restoreHero) {
      const resolveImage = ({ media: file, ...attributes }) => ({ ...attributes, media: media.get(file.__file) });
      data.hero = { ...source[locale].hero, backgroundImage: resolveImage(source[locale].hero.backgroundImage), decorativeImage: resolveImage(source[locale].hero.decorativeImage) };
    }
    await app.documents(uid).update({ documentId, locale, data });
    await app.documents(uid).publish({ documentId, locale });
    console.log(`Restored homepage space: ${locale}`);
  }
  console.log(`Media: ${summary.toString()}. Recovery: ${resolve(root, 'recovery.json')}`);
} catch (error) {
  console.error('Homepage space restoration failed:', error);
  process.exitCode = 1;
} finally {
  const shutdownError = error => {
    if (error?.message === 'aborted') console.warn('Strapi shutdown warning: aborted');
    else { console.error('Strapi shutdown failed:', error); process.exitCode = 1; }
  };
  process.on('uncaughtException', shutdownError);
  process.on('unhandledRejection', shutdownError);
  await app.destroy().catch(shutdownError);
}
