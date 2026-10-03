/**
 * Seeds the supplied Salanca site content into the CMS.
 *
 * Input is `data/salanca-content.json`, generated from the frontend's shipped
 * copy by `salanca-web`'s `pnpm run export:cms-seed`. Everything the frontend
 * adapters read is written here, so pages render from the CMS instead of
 * requiring content to be published in each requested locale.
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
import { adaptHomePageForCurrentSchema } from './adapt-current-schema.mjs';
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
const HEADER_SETTING_UID = 'api::header-setting.header-setting';
const FOOTER_SETTING_UID = 'api::footer-setting.footer-setting';
const HOME_PAGE_UID = 'api::home-page.home-page';
const LOCATION_UID = 'api::location.location';

/**
 * With --prune the payload is authoritative: rows in the seeded collections
 * that it does not define (leftovers from seed:demo) are deleted. Off by
 * default so a normal re-seed never removes anything an editor added.
 */
const prune = args.includes('--prune');
const ownerRefresh = args.includes('--owner-refresh');
if (ownerRefresh && prune) throw new Error('Owner refresh never prunes editorial documents.');
const ownerUids = new Set(['api::menu-category.menu-category', 'api::menu-package.menu-package', 'api::menu-item.menu-item', 'api::home-page.home-page', 'api::menu-page.menu-page', 'api::story-page.story-page', 'api::experience-page.experience-page', 'api::campaign-page.campaign-page', 'api::campaign.campaign', 'api::header-setting.header-setting']);

const originalPayload = JSON.parse(readFileSync(PAYLOAD_PATH, 'utf8'));
const restorePages = args.includes('--restore-experience-space');
if (restorePages && prune) throw new Error('Page restoration never prunes.');
const payload = restorePages ? {
  liveSnapshot: true,
  locales: originalPayload.locales,
  pages: Object.fromEntries(Object.entries(originalPayload.pages).filter(([uid]) => ['api::experience-page.experience-page', 'api::space-page.space-page'].includes(uid))),
  collections: { 'api::gallery-item.gallery-item': originalPayload.collections['api::gallery-item.gallery-item'] },
} : originalPayload;
if (restorePages) {
  const media = new Set();
  const collect = value => {
    if (!value || typeof value !== 'object') return;
    if (value.__file) media.add(value.__file);
    if (value.__media) media.add(value.__media);
    for (const nested of Object.values(value)) collect(nested);
  };
  collect(payload);
  payload.media = [...media];
}
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
    const keepExisting = ownerRefresh && !ownerUids.has(uid);
    const prior = keepExisting ? await app.documents(uid).findFirst({ locale: primaryLocale, filters: { [matchField]: primaryData[matchField] } }) : null;
    if (prior) {
      refIds.set(`${uid}:${entry.key}`, prior.documentId);
      summary.record('skipped');
      continue;
    }
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
  if (ownerRefresh && !ownerUids.has(uid)) {
    const existing = await app.documents(uid).findFirst({ locale: primaryLocale, status: 'draft' });
    if (existing) { summary.record('skipped'); return existing; }
  }
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
  if (restorePages) {
    const slug = originalPayload.collections[LOCATION_UID][locales[0]].slug;
    const location = await app.documents(LOCATION_UID).findFirst({ locale: locales[0], status: 'published', filters: { slug } });
    if (!location) throw new Error('Existing published location is required for scoped restoration.');
    refIds.set(`${LOCATION_UID}:${slug}`, location.documentId);
  }
  console.log(`seed:content media from ${mediaDirectory()}`);
  const mediaIds = await ensureContentMedia(app, summary, payload.media);

  // Location is a collection but single-instance, so it ships keyed by locale.
  const location = payload.collections[LOCATION_UID];
  if (location) {
  const [primaryLocale, ...otherLocales] = locales;
  const locationPrimary = resolvePlaceholders(location[primaryLocale], mediaIds, refIds);
  const existingLocation = ownerRefresh ? await app.documents(LOCATION_UID).findFirst({ locale: primaryLocale, filters: { slug: locationPrimary.slug } }) : null;
  const locationDoc = existingLocation ? { action: 'skipped', documentId: existingLocation.documentId } : await upsertBySlug(
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
    if (existingLocation) continue;
    await upsertLocalization(
      app,
      LOCATION_UID,
      locationDoc.documentId,
      locale,
      resolvePlaceholders(location[locale], mediaIds, refIds),
    );
    summary.record('updated');
  }
  }

  for (const uid of COLLECTION_ORDER) {
    const collection = payload.collections[uid];
    if (collection === undefined) continue;
    await seedCollection(uid, collection, mediaIds);
  }

  // export:cms-seed already emits globalSetting/headerSetting/footerSetting
  // split to the current shape. Seed sequentially to avoid overlapping publish transactions.
  if (payload.globalSetting) await seedLocalizedSingleType(GLOBAL_SETTING_UID, payload.globalSetting, mediaIds);
  if (payload.headerSetting) await seedLocalizedSingleType(HEADER_SETTING_UID, payload.headerSetting, mediaIds);
  if (payload.footerSetting) await seedLocalizedSingleType(FOOTER_SETTING_UID, payload.footerSetting, mediaIds);

  for (const [uid, byLocale] of Object.entries(payload.pages)) {
    const adapted =
      uid === HOME_PAGE_UID && !payload.liveSnapshot
        ? Object.fromEntries(
            Object.entries(byLocale).map(([locale, data]) => [
              locale,
              adaptHomePageForCurrentSchema(data),
            ]),
          )
        : byLocale;
    await seedLocalizedSingleType(uid, adapted, mediaIds);
  }

  // Live snapshots can contain reverse/forward collection links (category ->
  // items, location -> gallery). Restore them after every destination id exists.
  if (payload.liveSnapshot) {
    for (const [uid, collection] of Object.entries(payload.collections)) {
      const entries = uid === LOCATION_UID
        ? [{ key: collection[locales[0]].slug, ...collection }]
        : collection.entries;
      for (const entry of entries) {
        const documentId = refIds.get(`${uid}:${entry.key}`);
        if (!documentId) throw new Error(`Missing destination document ${uid}.`);
        for (const locale of locales) {
          const relationData = Object.fromEntries(Object.entries(entry[locale]).filter(([key]) => app.contentTypes[uid].attributes[key]?.type === 'relation'));
          if (!Object.keys(relationData).length) continue;
          await app.documents(uid).update({ documentId, locale, data: resolvePlaceholders(relationData, mediaIds, refIds) });
          await app.documents(uid).publish({ documentId, locale });
        }
      }
    }
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
    if (error?.message === 'aborted') {
      console.warn('seed:content shutdown warning: aborted');
    } else {
      console.error('seed:content shutdown failed:', error);
      process.exitCode = 1;
    }
  };
  process.on('uncaughtException', ignoreShutdownNoise);
  process.on('unhandledRejection', ignoreShutdownNoise);

  await app.destroy().catch(ignoreShutdownNoise);
  process.exit(process.exitCode ?? 0);
}
