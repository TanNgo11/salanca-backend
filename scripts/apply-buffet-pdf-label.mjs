import { mkdirSync, writeFileSync } from 'node:fs';
import { loadStrapiApp } from './lib/strapi-load.mjs';

if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DATABASE_HOST) || process.env.DATABASE_URL) {
  throw new Error('Explicit local database required.');
}
const expected = {
  vi: ['Hơn 12 loại thịt nướng', 'Salad bar đa dạng', 'Dứa nướng Brazil', 'Phục vụ không giới hạn'],
  en: ['12+ grilled meats', 'Generous salad bar', 'Brazilian grilled pineapple', 'Unlimited tableside service'],
};
const replacement = ['CHURRASCARIA', 'CHURRASCARIA'];
const uid = 'api::menu-package.menu-package';
const app = await loadStrapiApp();
const apply = process.argv.includes('--apply');
function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt', 'locale'].includes(key))
    .map(([key, child]) => [key, comparable(child)]));
}
try {
  const planned = [];
  for (const locale of ['vi', 'en']) {
    const rows = await app.documents(uid).findMany({ locale, status: 'published', filters: { slug: 'buffet' }, populate: '*' });
    if (rows.length !== 1) throw new Error(`Expected one buffet ${locale}.`);
    const row = rows[0];
    const titles = row.includedItems.map((item) => item.title);
    console.log(`${locale}: ${JSON.stringify(titles)} -> ${JSON.stringify(replacement)}`);
    if (JSON.stringify(titles) === JSON.stringify(replacement)) continue;
    if (JSON.stringify(titles) !== JSON.stringify(expected[locale])) throw new Error(`Unrecognized editor text ${locale}; preserved.`);
    const draft = await app.documents(uid).findOne({ documentId: row.documentId, locale, status: 'draft', populate: '*' });
    if (JSON.stringify(comparable(draft)) !== JSON.stringify(comparable(row))) throw new Error(`Unpublished changes ${locale}; preserved.`);
    planned.push({ locale, documentId: row.documentId, includedItems: row.includedItems });
  }
  if (!apply) console.log('Preview only; no content changed.');
  else if (planned.length) {
    mkdirSync('.tmp/native-menu', { recursive: true });
    writeFileSync(`.tmp/native-menu/buffet-label-before-${Date.now()}.json`, JSON.stringify(planned, null, 2));
    for (const row of planned) {
      await app.documents(uid).update({ documentId: row.documentId, locale: row.locale, data: {
        includedItems: replacement.map((title) => ({ title, showStar: false })),
      } });
      await app.documents(uid).publish({ documentId: row.documentId, locale: row.locale });
      console.log(`Applied buffet label ${row.locale}.`);
    }
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
