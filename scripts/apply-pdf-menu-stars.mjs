/** Preview/apply the four PDF star markers without reseeding unrelated content. */
import { loadStrapiApp } from './lib/strapi-load.mjs';

const apply = process.argv.includes('--apply');
const itemUid = 'api::menu-item.menu-item';
const packageUid = 'api::menu-package.menu-package';
const packageTitles = {
  vi: ['Xúc xích Calabresa', 'Cupim', 'Thăn bò cuộn bacon', 'Cánh gà', 'Ba chỉ heo', 'Đùi heo muối', 'Mông bò', 'Dứa nướng'],
  en: ['Calabresa sausage', 'Cupim', 'Bacon-wrapped beef', 'Chicken wings', 'Pork belly', 'Salted pork leg', 'Beef rump', 'Grilled pineapple'],
};
const starredPackageIndexes = new Set([1, 6]);
const app = await loadStrapiApp();
try {
  const targets = [];
  for (const locale of ['vi', 'en']) {
    for (const slug of ['picanha', 'grilled-pineapple']) {
      const service = app.documents(itemUid);
      const filters = { slug: { $eq: slug } };
      const draft = await service.findFirst({ locale, status: 'draft', filters });
      const published = await service.findFirst({ locale, status: 'published', filters });
      if (!draft || !published || draft.documentId !== published.documentId) throw new Error(`Missing item pair: ${locale}/${slug}`);
      if (draft.updatedAt !== published.updatedAt) throw new Error(`Review unpublished item edits first: ${locale}/${slug}`);
      if (![null, false, true].includes(draft.showStar)) throw new Error(`Unexpected star value: ${locale}/${slug}`);
      targets.push({ uid: itemUid, locale, slug, documentId: draft.documentId, data: { showStar: true }, needsUpdate: draft.showStar !== true });
    }
    const service = app.documents(packageUid);
    const filters = { slug: { $eq: 'rodizio' } };
    const draft = await service.findFirst({ locale, status: 'draft', filters, populate: ['includedItems'] });
    const published = await service.findFirst({ locale, status: 'published', filters, populate: ['includedItems'] });
    if (!draft || !published || draft.documentId !== published.documentId) throw new Error(`Missing package pair: ${locale}/rodizio`);
    if (draft.updatedAt !== published.updatedAt) throw new Error(`Review unpublished package edits first: ${locale}/rodizio`);
    if (!Array.isArray(draft.includedItems) || draft.includedItems.length !== packageTitles[locale].length) throw new Error(`Unexpected included item count: ${locale}/rodizio`);
    const includedItems = draft.includedItems.map((entry, index) => {
      if (entry.title !== packageTitles[locale][index] || ![null, false, true].includes(entry.showStar)) throw new Error(`Unexpected package row: ${locale}/${index}`);
      if (entry.showStar === true && !starredPackageIndexes.has(index)) throw new Error(`Existing extra star requires review: ${locale}/${entry.title}`);
      return { id: entry.id, title: entry.title, description: entry.description, showStar: starredPackageIndexes.has(index) };
    });
    const needsUpdate = includedItems.some((entry, index) => draft.includedItems[index].showStar !== entry.showStar);
    targets.push({ uid: packageUid, locale, slug: 'rodizio', documentId: draft.documentId, data: { includedItems }, needsUpdate });
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', targets: targets.map(({ uid, locale, slug, needsUpdate }) => ({ uid, locale, slug, needsUpdate })) }, null, 2));
  if (apply) {
    for (const target of targets.filter((entry) => entry.needsUpdate)) {
      const service = app.documents(target.uid);
      await service.update({ documentId: target.documentId, locale: target.locale, data: target.data, status: 'published' });
      const saved = await service.findOne({ documentId: target.documentId, locale: target.locale, status: 'published', ...(target.uid === packageUid ? { populate: ['includedItems'] } : {}) });
      const correct = target.uid === itemUid
        ? saved?.showStar === true
        : saved?.includedItems?.length === target.data.includedItems.length && saved.includedItems.every((entry, index) => entry.showStar === target.data.includedItems[index].showStar);
      if (!correct) throw new Error(`Verification failed: ${target.locale}/${target.slug}`);
    }
    console.log(`Published ${targets.filter((entry) => entry.needsUpdate).length} scoped updates.`);
  }
} finally {
  await app.destroy();
}
