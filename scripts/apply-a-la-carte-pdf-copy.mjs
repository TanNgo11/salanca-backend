/** Scoped correction of the owner PDF's a-la-carte copy. Preview by default. */
import { loadStrapiApp } from './lib/strapi-load.mjs';
import { isDeepStrictEqual } from 'node:util';

const apply = process.argv.includes('--apply');
const paragraph = (text) => [{ type: 'paragraph', children: [{ type: 'text', text }] }];
const changes = [
  {
    uid: 'api::menu-category.menu-category',
    locale: 'vi', slug: 'goi-mon', field: 'description',
    before: 'Món chính dùng kèm lựa chọn salad xanh / Caesar với sốt Thousand Island, cơm bơ, hành tây nướng hoặc khoai tây chiên.',
    after: 'Chọn một món ăn kèm với bất kỳ món chính nào:\nSalad xanh hoặc Caesar với sốt Thousand Island\nCơm bơ Jasmine\nHành tây nướng hoặc khoai tây chiên',
  },
  {
    uid: 'api::menu-category.menu-category',
    locale: 'en', slug: 'a-la-carte', field: 'description',
    before: 'Choose sides with your main course: green / Caesar salad with Thousand Island dressing, buttered rice, grilled onions or French fries.',
    after: 'Choose one side dish with any main course:\nGreen or Caesar salad with Thousand Island dressing\nButtered rice with Feijoada (Brazilian bean stew)\nGrilled onions or French fries',
  },
  {
    uid: 'api::menu-item.menu-item', locale: 'en', slug: 'picanha-a-cavalo', field: 'shortDescription',
    before: 'Grilled picanha with buttered onions, rice and feijoada.',
    after: 'Grilled picanha topped with buttered onions, served with rice and feijoada.',
  },
  {
    uid: 'api::menu-item.menu-item', locale: 'en', slug: 'picanha-a-cavalo', field: 'description',
    before: paragraph('Grilled picanha with buttered onions, rice and feijoada.'),
    after: paragraph('Grilled picanha topped with buttered onions, served with rice and feijoada.'),
  },
  {
    uid: 'api::menu-item.menu-item', locale: 'vi', slug: 'shrimp-thermidor', field: 'shortDescription',
    before: 'Tôm thẻ phô mai đút lò.', after: '',
  },
  {
    uid: 'api::menu-item.menu-item', locale: 'vi', slug: 'shrimp-thermidor', field: 'description',
    before: paragraph('Tôm thẻ phô mai đút lò.'), after: [],
  },
  {
    uid: 'api::menu-item.menu-item', locale: 'en', slug: 'shrimp-thermidor', field: 'shortDescription',
    before: '', after: 'Baked with cheese.',
  },
  {
    uid: 'api::menu-item.menu-item', locale: 'en', slug: 'shrimp-thermidor', field: 'description',
    before: [], after: paragraph('Baked with cheese.'),
  },
  {
    uid: 'api::menu-item.menu-item', locale: 'vi', slug: 'seafood-moqueca', field: 'shortDescription',
    before: 'Hải sản hầm nước cốt dừa, ớt chuông và gia vị Brazil, dùng với cơm tỏi và farofa. Liên hệ nhà hàng để biết giá.',
    after: 'Hải sản hầm nước cốt dừa, ớt chuông và gia vị Brazil, dùng với cơm tỏi và farofa.',
  },
  {
    uid: 'api::menu-item.menu-item', locale: 'vi', slug: 'seafood-moqueca', field: 'description',
    before: paragraph('Hải sản hầm nước cốt dừa, ớt chuông và gia vị Brazil, dùng với cơm tỏi và farofa. Liên hệ nhà hàng để biết giá.'),
    after: paragraph('Hải sản hầm nước cốt dừa, ớt chuông và gia vị Brazil, dùng với cơm tỏi và farofa.'),
  },
  {
    uid: 'api::menu-item.menu-item', locale: 'en', slug: 'seafood-moqueca', field: 'shortDescription',
    before: 'Brazilian seafood stew in coconut broth with peppers, garlic rice and farofa. Contact the restaurant for pricing.',
    after: 'Brazilian seafood stew in coconut broth with peppers, garlic rice and farofa.',
  },
  {
    uid: 'api::menu-item.menu-item', locale: 'en', slug: 'seafood-moqueca', field: 'description',
    before: paragraph('Brazilian seafood stew in coconut broth with peppers, garlic rice and farofa. Contact the restaurant for pricing.'),
    after: paragraph('Brazilian seafood stew in coconut broth with peppers, garlic rice and farofa.'),
  },
];
const equal = isDeepStrictEqual;

const app = await loadStrapiApp();
try {
  const targets = [];
  for (const change of changes) {
    const service = app.documents(change.uid);
    const query = { locale: change.locale, filters: { slug: { $eq: change.slug } } };
    const draft = await service.findFirst({ ...query, status: 'draft' });
    const published = await service.findFirst({ ...query, status: 'published' });
    if (!draft || !published || draft.documentId !== published.documentId) throw new Error(`Missing locale pair: ${change.locale}/${change.slug}`);
    if (draft.updatedAt !== published.updatedAt) throw new Error(`Review unpublished edits first: ${change.locale}/${change.slug}`);
    if (!equal(draft[change.field], change.before) && !equal(draft[change.field], change.after)) throw new Error(`Unexpected CMS text: ${change.locale}/${change.slug}`);
    targets.push({ ...change, documentId: draft.documentId, needsUpdate: !equal(draft[change.field], change.after) });
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', targets: targets.map(({ uid, locale, slug, field, needsUpdate }) => ({ uid, locale, slug, field, needsUpdate })) }, null, 2));
  if (apply) {
    for (const target of targets.filter((entry) => entry.needsUpdate)) {
      const service = app.documents(target.uid);
      await service.update({ documentId: target.documentId, locale: target.locale, data: { [target.field]: target.after }, status: 'published' });
      const saved = await service.findOne({ documentId: target.documentId, locale: target.locale, status: 'published' });
      if (!equal(saved?.[target.field], target.after)) throw new Error(`Verification failed: ${target.locale}/${target.slug}`);
    }
    console.log(`Published ${targets.filter((entry) => entry.needsUpdate).length} scoped updates.`);
  }
} finally {
  await app.destroy();
}
