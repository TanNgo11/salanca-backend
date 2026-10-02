import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadStrapiApp } from './lib/strapi-load.mjs';
import { resolvePlaceholders } from './seed-salanca-content/resolve.mjs';

if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DATABASE_HOST) || process.env.DATABASE_URL) throw new Error('Local database required.');
const payload = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const audit = JSON.parse(readFileSync('.tmp/source-audit/unpublished-documents.json', 'utf8'));
const campaignUid = 'api::campaign.campaign';
const pageUid = 'api::campaign-page.campaign-page';
const app = await loadStrapiApp();
function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt', 'locale'].includes(key)).map(([key, child]) => [key, comparable(child)]));
}
try {
  const planned = [];
  const mediaIds = new Map();
  const refs = new Map();
  async function existingMedia(value) {
    if (Array.isArray(value)) { for (const child of value) await existingMedia(child); return; }
    if (!value || typeof value !== 'object') return;
    if (value.__media && !mediaIds.has(value.__media)) {
      const file = await app.db.query('plugin::upload.file').findOne({ where: { name: value.__media } });
      if (!file) throw new Error(`Existing upload required: ${value.__media}`);
      mediaIds.set(value.__media, file.id);
    }
    for (const child of Object.values(value)) await existingMedia(child);
  }
  for (const locale of ['vi', 'en']) {
    const prior = audit.find((entry) => entry.uid === campaignUid && entry.locale === locale)?.rows;
    if (prior?.length !== 7) throw new Error(`Expected seven recorded campaigns ${locale}.`);
    const drafts = await app.documents(campaignUid).findMany({ locale, status: 'draft', populate: '*' });
    if (drafts.length !== 7) throw new Error(`Unexpected draft count ${locale}.`);
    for (const old of prior) {
      const row = drafts.find((draft) => draft.documentId === old.documentId);
      if (!row || JSON.stringify(comparable(row)) !== JSON.stringify(comparable(old))) throw new Error(`Edited campaign ${locale}/${old.slug}; preserved.`);
      const source = payload.collections[campaignUid].entries.find((entry) => entry.key === row.slug)?.[locale];
      if (!source || source.title !== row.title || source.summary !== row.summary) throw new Error(`Reference mismatch ${row.slug}.`);
      await existingMedia(source.coverImage);
      refs.set(`${campaignUid}:${row.slug}`, row.documentId);
      planned.push({ uid: campaignUid, locale, before: row, data: { coverImage: resolvePlaceholders(source.coverImage, mediaIds, refs) } });
      console.log(`Restore ${locale}/${row.slug}: existing draft + restaurant photo.`);
    }
    const row = await app.documents(pageUid).findFirst({ locale, status: 'published', populate: { hero: { populate: '*' }, eventCta: { populate: '*' }, closingCta: { populate: '*' }, featuredCampaign: true } });
    const draft = await app.documents(pageUid).findOne({ documentId: row.documentId, locale, status: 'draft', populate: { hero: { populate: '*' }, eventCta: { populate: '*' }, closingCta: { populate: '*' }, featuredCampaign: true } });
    if (JSON.stringify(comparable(row)) !== JSON.stringify(comparable(draft))) throw new Error(`Unpublished page edits ${locale}; preserved.`);
    if (row.hero?.title !== (locale === 'vi' ? 'Ưu đãi' : 'Offers') || row.featuredCampaign || row.eventCta) throw new Error(`Unrecognized simplified page ${locale}; preserved.`);
    const source = payload.pages[pageUid][locale];
    const fields = Object.fromEntries(['hero', 'featuredHeading', 'featuredCampaign', 'listingHeading', 'eventCta', 'closingCta'].map((key) => [key, source[key]]));
    await existingMedia(fields);
    if (!refs.get(`${campaignUid}:brazil-night`)) throw new Error('Featured relation missing.');
    planned.push({ uid: pageUid, locale, before: row, data: resolvePlaceholders(fields, mediaIds, refs) });
    console.log(`Restore ${locale} campaign-page shell and featured relation.`);
  }
  if (!process.argv.includes('--apply')) console.log('Preview only; no writes.');
  else {
    mkdirSync('.tmp/offers-restore', { recursive: true });
    writeFileSync(`.tmp/offers-restore/before-${Date.now()}.json`, JSON.stringify(planned, null, 2));
    for (const row of planned) {
      await app.documents(row.uid).update({ documentId: row.before.documentId, locale: row.locale, data: row.data });
      await app.documents(row.uid).publish({ documentId: row.before.documentId, locale: row.locale });
    }
    console.log(`Restored ${planned.length} localized documents.`);
  }
} finally {
  const pool = app.db.connection.client.pool;
  for (let idle = 0, turns = 0; idle < 2; turns++) {
    if (turns > 200) throw new Error('Database events did not drain.');
    await new Promise((resolve) => setTimeout(resolve, 50));
    idle = pool.numUsed() === 0 && pool.numPendingAcquires() === 0 ? idle + 1 : 0;
  }
  await app.destroy();
}
