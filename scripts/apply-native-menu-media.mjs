import { mkdirSync, writeFileSync } from 'node:fs';
import { loadStrapiApp } from './lib/strapi-load.mjs';
import { ensureContentMedia } from './seed-salanca-content/media.mjs';

if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DATABASE_HOST) || process.env.DATABASE_URL) {
  throw new Error('Explicit local database required.');
}
const targets = [
  { uid: 'api::menu-package.menu-package', slug: 'rodizio', file: 'pdf-rodizio-skewer-4k.webp', old: ['pdf-churrasco-service-4k.webp'] },
  { uid: 'api::story-page.story-page', field: 'originImage', locale: 'vi', file: 'pdf-birds-left-4k.webp', old: ['pdf-churrascaria-cover-exact.webp'] },
  { uid: 'api::story-page.story-page', field: 'originImage', locale: 'en', file: 'pdf-birds-right-4k.webp', old: ['pdf-churrascaria-cover-exact.webp'] },
  { uid: 'api::experience-page.experience-page', field: 'introImage', locale: 'vi', file: 'pdf-churrasco-service-4k.webp', old: ['pdf-rodizio-skewer-4k.webp'] },
  { uid: 'api::experience-page.experience-page', field: 'introImage', locale: 'en', file: 'pdf-samba-dancer-4k.webp', old: ['pdf-rodizio-skewer-4k.webp'] },
  { uid: 'api::contact-page.contact-page', field: 'visitImage', file: 'pdf-brazil-map.jpg', old: ['pdf-botanical-4k.webp'] },
];
const originalRodizioTitles = {
  vi: ['Xúc xích Calabresa', 'Cupim', 'Thăn bò cuộn bacon', 'Cánh gà', 'Ba chỉ heo', 'Đùi heo muối', 'Mông bò', 'Dứa nướng'],
  en: ['Calabresa sausage', 'Cupim', 'Bacon-wrapped beef', 'Chicken wings', 'Pork belly', 'Salted pork leg', 'Beef rump', 'Grilled pineapple'],
};
const pdfRodizioOrder = [0, 2, 4, 6, 1, 3, 5, 7];
const app = await loadStrapiApp();
const apply = process.argv.includes('--apply');
function editableFields(value) {
  if (Array.isArray(value)) return value.map(editableFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt', 'locale'].includes(key))
    .map(([key, child]) => [key, editableFields(child)]));
}
try {
  const planned = [];
  for (const target of targets) for (const locale of ['vi', 'en']) {
    if (target.locale && target.locale !== locale) continue;
    const field = target.field ?? 'image';
    const componentFields = Object.entries(app.contentType(target.uid).attributes)
      .filter(([, attribute]) => attribute.type === 'component')
      .map(([name]) => [name, { populate: '*' }]);
    const populate = { ...Object.fromEntries(componentFields), [field]: { populate: { media: true } } };
    const rows = await app.documents(target.uid).findMany({ locale, status: 'published', ...(target.slug ? { filters: { slug: target.slug } } : {}), populate });
    if (rows.length !== 1) throw new Error(`Expected exactly one ${target.slug ?? target.uid} ${locale}.`);
    const row = rows[0];
    const current = row[field]?.media?.name;
    console.log(`${target.slug ?? field} ${locale}: ${current ?? 'no media'} -> ${target.file}`);
    const originalTitles = originalRodizioTitles[locale];
    const needsOrder = target.slug === 'rodizio' && JSON.stringify(row.includedItems?.map((item) => item.title)) === JSON.stringify(originalTitles);
    if (current === target.file && !needsOrder) continue;
    if (current !== target.file && !target.old.includes(current)) throw new Error(`Unrecognized editor image for ${target.slug}; preserved.`);
    const draft = await app.documents(target.uid).findOne({ documentId: row.documentId, locale, status: 'draft', populate });
    if (JSON.stringify(editableFields(draft)) !== JSON.stringify(editableFields(row))) throw new Error(`Unpublished changes for ${target.slug}; preserved.`);
    planned.push({ ...target, field, locale, documentId: row.documentId, image: row[field],
      ...(needsOrder ? { originalItems: row.includedItems, includedItems: pdfRodizioOrder.map((index) => {
        const { id, ...item } = row.includedItems[index]; void id; return item;
      }) } : {}),
    });
    if (needsOrder) console.log(`Rodizio ${locale}: original seed order -> PDF order (editable in CMS).`);
  }
  const pages = [];
  for (const locale of ['vi', 'en']) {
    const rows = await app.documents('api::menu-page.menu-page').findMany({ locale, status: 'published', populate: '*' });
    if (rows.length !== 1) throw new Error(`Expected one menu-page ${locale}.`);
    const row = rows[0];
    console.log(`menu-page ${locale}: priceNote ${row.priceNote ? 'already set' : 'empty'}`);
    if (!row.priceNote) {
      const draft = await app.documents('api::menu-page.menu-page').findOne({ documentId: row.documentId, locale, status: 'draft', populate: '*' });
      if (JSON.stringify(editableFields(draft)) !== JSON.stringify(editableFields(row))) throw new Error(`Unpublished menu-page ${locale} changes; preserved.`);
      pages.push({ documentId: row.documentId, locale, priceNote: row.priceNote ?? null });
    }
  }
  const files = [...new Set(planned.map((row) => row.file))];
  for (const name of files) {
    const existing = await app.db.query('plugin::upload.file').findOne({ where: { name } });
    console.log(`library ${name}: ${existing ? 'reusable' : 'upload required'}`);
  }
  if (!apply) { console.log('Preview only; no content changed.'); }
  else {
    mkdirSync('.tmp/native-menu', { recursive: true });
    writeFileSync(`.tmp/native-menu/before-${Date.now()}.json`, JSON.stringify({ planned, pages }, null, 2));
    const media = await ensureContentMedia(app, { record() {} }, files);
    for (const row of planned) {
      const { id: componentId, media: oldMedia, ...imageFields } = row.image;
      void componentId; void oldMedia;
      await app.documents(row.uid).update({ documentId: row.documentId, locale: row.locale, data: {
        [row.field]: { ...imageFields, media: media.get(row.file) },
        ...(row.includedItems ? { includedItems: row.includedItems } : {}),
      } });
      await app.documents(row.uid).publish({ documentId: row.documentId, locale: row.locale });
      console.log(`Applied ${row.slug ?? row.field} ${row.locale}.`);
    }
    for (const page of pages) {
      await app.documents('api::menu-page.menu-page').update({ documentId: page.documentId, locale: page.locale, data: { priceNote: page.locale === 'vi' ? 'Giá chưa bao gồm 5% phí phục vụ và thuế GTGT.' : 'Prices exclude a 5% service charge and VAT.' } });
      await app.documents('api::menu-page.menu-page').publish({ documentId: page.documentId, locale: page.locale });
      console.log(`Applied menu-page priceNote ${page.locale}.`);
    }
  }
} finally {
  // Document Service emits populate/event work after commit without awaiting it.
  // Drain its database work before destroying the CLI application's pool.
  const pool = app.db.connection.client.pool;
  const deadline = Date.now() + 10000;
  let idleTurns = 0;
  while (idleTurns < 2) {
    await new Promise((resolve) => setImmediate(resolve));
    if (pool.numUsed() === 0 && pool.numPendingAcquires() === 0) idleTurns += 1;
    else {
      idleTurns = 0;
      if (Date.now() > deadline) throw new Error('Pending database events; shutdown withheld.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  await app.destroy();
}
