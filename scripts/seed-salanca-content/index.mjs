/**
 * Seeds the approved Salanca site content into the CMS.
 *
 * Input is `data/salanca-content.json`, generated from the frontend's shipped
 * copy by `salanca-web`'s `pnpm run export:cms-seed`. Everything the frontend
 * adapters read is written here, so pages render from the CMS instead of
 * falling back to the copy compiled into the bundle.
 *
 * Idempotent: single types upsert by locale, collections upsert by slug, and
 * media reuses any file already in the library.
 *
 * Usage: npm run seed:content
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createSummary, upsertBySlug, upsertLocalization, upsertSingleType } from '../lib/seed-document.mjs';
import { loadStrapiApp } from '../lib/strapi-load.mjs';
import { ensureContentMedia, mediaDirectory } from './media.mjs';
import { resolvePlaceholders } from './resolve.mjs';

const args = process.argv.slice(2);
const payloadArg = args.find((arg) => !arg.startsWith('--'));
const PAYLOAD_PATH = resolve(payloadArg ?? 'data/salanca-content.json');

/**
 * Collections are seeded before pages because pages hold the relations, and
 * within this list each entry may only reference earlier ones.
 */
const COLLECTION_ORDER = [
  'api::menu-category.menu-category',
  'api::menu-package.menu-package',
  'api::menu-item.menu-item',
  'api::campaign.campaign',
  'api::gallery-item.gallery-item',
];

const GLOBAL_SETTING_UID = 'api::global-setting.global-setting';
const LOCATION_UID = 'api::location.location';

/**
 * With --prune the payload is authoritative: rows in the seeded collections
 * that it does not define (leftovers from seed:demo) are deleted. Off by
 * default so a normal re-seed never removes anything an editor added.
 */
const prune = args.includes('--prune');

const payload = JSON.parse(readFileSync(PAYLOAD_PATH, 'utf8'));
const locales = payload.locales;
const summary = createSummary();
const app = await loadStrapiApp();

/** `${uid}:${slug}` -> documentId, filled as collections are seeded. */
const refIds = new Map();

async function seedCollection(uid, collection, mediaIds) {
  const { matchField, entries } = collection;
  const [primaryLocale, ...others] = locales;
  const seededDocumentIds = new Set();

  for (const entry of entries) {
    const primaryData = resolvePlaceholders(entry[primaryLocale], mediaIds, refIds);
    const primary = await upsertByField(
      uid,
      primaryLocale,
      matchField,
      primaryData,
    );
    summary.record(primary.action);
    // Relations address an entry by its cross-locale key, so that is what the
    // ref index holds — a localized slug would only resolve in one locale.
    refIds.set(`${uid}:${entry.key}`, primary.documentId);

    for (const locale of others) {
      const localized = entry[locale];
      if (localized === undefined) continue;
      await upsertLocalization(
        app,
        uid,
        primary.documentId,
        locale,
        resolvePlaceholders(localized, mediaIds, refIds),
      );
      summary.record('updated');
    }

    seededDocumentIds.add(primary.documentId);
  }

  if (prune) {
    await pruneCollection(uid, seededDocumentIds);
  }
}

/**
 * `upsertBySlug` only knows the `slug` attribute; collections without one
 * (gallery items) match on whatever field the payload nominates.
 */
async function upsertByField(uid, locale, matchField, data) {
  if (matchField === 'slug') {
    return upsertBySlug(app, uid, locale, data.slug, data);
  }

  const [existing] = await app.documents(uid).findMany({
    locale,
    filters: { [matchField]: { $eq: data[matchField] } },
    limit: 1,
  });

  if (existing) {
    await app.documents(uid).update({ documentId: existing.documentId, locale, data });
    await app.documents(uid).publish({ documentId: existing.documentId, locale });
    return { action: 'updated', documentId: existing.documentId };
  }

  const created = await app.documents(uid).create({ locale, data });
  await app.documents(uid).publish({ documentId: created.documentId, locale });
  return { action: 'created', documentId: created.documentId };
}

/**
 * Deletes documents in `uid` that the seed did not write. Identity is the
 * documentId, so a row is kept if any locale of it was seeded.
 */
async function pruneCollection(uid, keptDocumentIds) {
  const existing = await app.documents(uid).findMany({
    locale: locales[0],
    status: 'draft',
    limit: 500,
  });

  for (const row of existing) {
    if (keptDocumentIds.has(row.documentId)) continue;
    await app.documents(uid).delete({ documentId: row.documentId });
    console.log(`prune: removed ${uid} ${row.slug ?? row.title ?? row.documentId}`);
    summary.record('deleted');
  }
}

async function seedLocalizedSingleType(uid, byLocale, mediaIds) {
  const [primaryLocale, ...others] = locales;
  const primary = await upsertSingleType(
    app,
    uid,
    primaryLocale,
    resolvePlaceholders(byLocale[primaryLocale], mediaIds, refIds),
  );
  summary.record(primary.action);

  for (const locale of others) {
    const localized = byLocale[locale];
    if (localized === undefined) continue;
    await upsertLocalization(
      app,
      uid,
      primary.documentId,
      locale,
      resolvePlaceholders(localized, mediaIds, refIds),
    );
    summary.record('updated');
  }

  return primary;
}

try {
  console.log(`seed:content media from ${mediaDirectory()}`);
  const mediaIds = await ensureContentMedia(app, summary, payload.media);

  // Location is a collection but single-instance, so it ships keyed by locale.
  const location = payload.collections[LOCATION_UID];
  const [primaryLocale, ...otherLocales] = locales;
  const locationPrimary = resolvePlaceholders(location[primaryLocale], mediaIds, refIds);
  const locationDoc = await upsertBySlug(
    app,
    LOCATION_UID,
    primaryLocale,
    locationPrimary.slug,
    locationPrimary,
  );
  summary.record(locationDoc.action);
  refIds.set(`${LOCATION_UID}:${locationPrimary.slug}`, locationDoc.documentId);

  if (prune) {
    await pruneCollection(LOCATION_UID, new Set([locationDoc.documentId]));
  }

  for (const locale of otherLocales) {
    if (location[locale] === undefined) continue;
    await upsertLocalization(
      app,
      LOCATION_UID,
      locationDoc.documentId,
      locale,
      resolvePlaceholders(location[locale], mediaIds, refIds),
    );
    summary.record('updated');
  }

  for (const uid of COLLECTION_ORDER) {
    const collection = payload.collections[uid];
    if (collection === undefined) continue;
    await seedCollection(uid, collection, mediaIds);
  }

  await seedLocalizedSingleType(GLOBAL_SETTING_UID, payload.globalSetting, mediaIds);

  for (const [uid, byLocale] of Object.entries(payload.pages)) {
    await seedLocalizedSingleType(uid, byLocale, mediaIds);
  }

  console.log(`seed:content complete — ${summary.toString()}`);
} catch (error) {
  console.error('seed:content failed');
  console.error(error);
  if (error?.details?.errors) {
    console.error('validation details:', JSON.stringify(error.details.errors, null, 2));
  }
  process.exitCode = 1;
} finally {
  // Tearing down the pg pool on Windows aborts pending clients, and tarn raises
  // that as an uncaught error rather than rejecting destroy(). The seed is
  // already finished at this point, so it must not change the exit code.
  const ignoreShutdownNoise = (error) => {
    console.warn('seed:content shutdown warning:', error?.message ?? error);
  };
  process.on('uncaughtException', ignoreShutdownNoise);
  process.on('unhandledRejection', ignoreShutdownNoise);

  await app.destroy().catch(ignoreShutdownNoise);
  process.exit(process.exitCode ?? 0);
}
