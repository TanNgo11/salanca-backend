/** Apply the two PDF stars and remove package notes from four exact menu rows. */
import { loadStrapiApp } from './lib/strapi-load.mjs';

const apply = process.argv.includes('--apply');
const uid = 'api::menu-item.menu-item';
const changes = [
  { slug: 'butter-rice', data: { showStar: true } },
  { slug: 'feijoada', data: { showStar: true } },
  { slug: 'beef-bacon', data: { portion: null } },
  { slug: 'passion-fruit-mousse', data: { portion: null } },
];
const oldPortions = {
  vi: { 'beef-bacon': 'Trong gói Rodizio', 'passion-fruit-mousse': 'Trong gói buffet / Rodizio' },
  en: { 'beef-bacon': 'Included in Rodizio', 'passion-fruit-mousse': 'Included in buffet / Rodizio' },
};
const oldCategoryDescriptions = {
  vi: 'Salad, món ăn kèm và Feijoada truyền thống Brazil trong gói buffet / Rodizio.',
  en: 'Salads, sides and traditional Brazilian Feijoada included in buffet / Rodizio.',
};
const editorialFields = ['name', 'slug', 'shortDescription', 'portion', 'description', 'price', 'isFeatured', 'isActive', 'displayOrder'];

const app = await loadStrapiApp();
try {
  const service = app.documents(uid);
  const targets = [];
  for (const locale of ['vi', 'en']) {
    for (const change of changes) {
      const filters = { slug: { $eq: change.slug } };
      const draft = await service.findFirst({ locale, status: 'draft', filters });
      const published = await service.findFirst({ locale, status: 'published', filters });
      if (!draft || !published || draft.documentId !== published.documentId) throw new Error(`Missing published/draft pair: ${locale}/${change.slug}`);
      const sharedStarSync = 'showStar' in change.data && published.showStar === true && draft.showStar !== true
        && editorialFields.every((field) => JSON.stringify(draft[field]) === JSON.stringify(published[field]));
      if (draft.updatedAt !== published.updatedAt && !sharedStarSync) throw new Error(`Unpublished edits must be reviewed first: ${locale}/${change.slug}`);
      if ('portion' in change.data && ![oldPortions[locale][change.slug], null].includes(draft.portion)) throw new Error(`Unexpected portion: ${locale}/${change.slug}`);
      if ('showStar' in change.data && ![null, false, true].includes(draft.showStar)) throw new Error(`Unexpected star: ${locale}/${change.slug}`);
      targets.push({ uid, locale, change, documentId: draft.documentId, needsUpdate: Object.entries(change.data).some(([field, value]) => draft[field] !== value) });
    }
    const categoryUid = 'api::menu-category.menu-category';
    const categorySlug = locale === 'vi' ? 'mon-kem' : 'sides';
    const categoryService = app.documents(categoryUid);
    const categoryFilters = { slug: { $eq: categorySlug } };
    const categoryDraft = await categoryService.findFirst({ locale, status: 'draft', filters: categoryFilters });
    const categoryPublished = await categoryService.findFirst({ locale, status: 'published', filters: categoryFilters });
    if (!categoryDraft || !categoryPublished || categoryDraft.documentId !== categoryPublished.documentId) throw new Error(`Missing published/draft category: ${locale}/${categorySlug}`);
    if (categoryDraft.updatedAt !== categoryPublished.updatedAt) throw new Error(`Unpublished category edits must be reviewed first: ${locale}/${categorySlug}`);
    if (![oldCategoryDescriptions[locale], null].includes(categoryDraft.description)) throw new Error(`Unexpected category description: ${locale}/${categorySlug}`);
    targets.push({ uid: categoryUid, locale, change: { slug: categorySlug, data: { description: null } }, documentId: categoryDraft.documentId, needsUpdate: categoryDraft.description !== null });
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', targets: targets.map(({ uid: targetUid, locale, change, documentId, needsUpdate }) => ({ uid: targetUid, locale, slug: change.slug, documentId, needsUpdate, change: change.data })) }, null, 2));
  if (apply) {
    for (const target of targets) {
      if (!target.needsUpdate) continue;
      const targetService = app.documents(target.uid);
      await targetService.update({ documentId: target.documentId, locale: target.locale, data: target.change.data, status: 'published' });
      const saved = await targetService.findOne({ documentId: target.documentId, locale: target.locale, status: 'published' });
      if (!saved || Object.entries(target.change.data).some(([field, value]) => saved[field] !== value)) throw new Error(`Verification failed: ${target.locale}/${target.change.slug}`);
    }
    console.log(`Published ${targets.filter((target) => target.needsUpdate).length} scoped locale updates.`);
  }
} finally {
  await app.destroy();
}
