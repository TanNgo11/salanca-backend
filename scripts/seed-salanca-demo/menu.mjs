import { upsertBySlug, upsertLocalization } from '../lib/seed-document.mjs';
import { image, paragraph, seo } from './builders.mjs';

export async function seedMenu(app, summary, mediaId) {
  const catThit = await upsertBySlug(app, 'api::menu-category.menu-category', 'vi', 'thit-nuong', {
    name: 'Thịt nướng',
    description: 'Các cut thịt nướng kiểu Brazil.',
    displayOrder: 0,
    isActive: true,
  });
  summary.record(catThit.action);
  await upsertLocalization(app, 'api::menu-category.menu-category', catThit.documentId, 'en', {
    name: 'Grilled meats',
    description: 'Brazilian-style grilled cuts.',
    slug: 'grilled-meats',
  });
  summary.record('updated');

  const catKem = await upsertBySlug(app, 'api::menu-category.menu-category', 'vi', 'mon-kem', {
    name: 'Món kèm',
    description: 'Salad, bánh mì và món phụ.',
    displayOrder: 1,
    isActive: true,
  });
  summary.record(catKem.action);
  await upsertLocalization(app, 'api::menu-category.menu-category', catKem.documentId, 'en', {
    name: 'Sides',
    description: 'Salads, bread and sides.',
    slug: 'sides',
  });
  summary.record('updated');

  const itemPicanha = await upsertBySlug(app, 'api::menu-item.menu-item', 'vi', 'picanha', {
    name: 'Picanha',
    shortDescription: 'Thăn ngoại bò nướng muối biển.',
    description: paragraph('Picanha là cut signature của churrasco Brazil.'),
    price: 0,
    category: catThit.documentId,
    isFeatured: true,
    isActive: true,
    displayOrder: 0,
    image: image(mediaId, 'Picanha nướng'),
  });
  summary.record(itemPicanha.action);
  await upsertLocalization(app, 'api::menu-item.menu-item', itemPicanha.documentId, 'en', {
    name: 'Picanha',
    shortDescription: 'Top sirloin cap with sea salt.',
    description: paragraph('Picanha is the signature Brazilian churrasco cut.'),
    slug: 'picanha-en',
    category: catThit.documentId,
    image: image(mediaId, 'Grilled picanha'),
  });
  summary.record('updated');

  const itemSalad = await upsertBySlug(app, 'api::menu-item.menu-item', 'vi', 'salad-nha', {
    name: 'Salad nhà',
    shortDescription: 'Rau củ theo mùa.',
    price: 0,
    category: catKem.documentId,
    isFeatured: false,
    isActive: true,
    displayOrder: 0,
  });
  summary.record(itemSalad.action);

  const pkg = await upsertBySlug(app, 'api::menu-package.menu-package', 'vi', 'buffet-chuan', {
    name: 'Buffet chuẩn',
    description: paragraph('Thịt nướng không giới hạn kèm salad bar.'),
    adultPrice: 899000,
    childPrice: 449000,
    includedItems: [
      { title: 'Thịt nướng', description: 'Picanha và các cut chọn lọc' },
      { title: 'Salad bar', description: 'Rau củ và món kèm' },
    ],
    image: image(mediaId, 'Buffet chuẩn Salanca'),
    isFeatured: true,
    isActive: true,
    displayOrder: 0,
    seo: seo('Buffet chuẩn', 'Gói buffet churrasco Salanca.', '/vi/thuc-don/buffet-chuan'),
  });
  summary.record(pkg.action);
  await upsertLocalization(app, 'api::menu-package.menu-package', pkg.documentId, 'en', {
    name: 'Signature buffet',
    description: paragraph('Unlimited grilled meats with salad bar.'),
    slug: 'signature-buffet',
    includedItems: [
      { title: 'Grilled meats', description: 'Picanha and selected cuts' },
      { title: 'Salad bar', description: 'Seasonal sides' },
    ],
    image: image(mediaId, 'Salanca signature buffet'),
    seo: seo('Signature buffet', 'Salanca churrasco buffet package.', '/en/menu/signature-buffet'),
  });
  summary.record('updated');

  return { catThit, catKem, itemPicanha, itemSalad, pkg };
}
