import { upsertBySlug, upsertLocalization } from '../lib/seed-document.mjs';
import { image, paragraph, seo } from './builders.mjs';

/**
 * Seeds menu categories, signature cuts, packages, and an a-la-carte item
 * aligned with salanca-web static menu copy so CMS full-collection replace
 * has useful demo data (not just a single picanha row).
 */
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

  const catALaCarte = await upsertBySlug(app, 'api::menu-category.menu-category', 'vi', 'a-la-carte', {
    name: 'A la carte',
    description: 'Món gọi riêng.',
    displayOrder: 2,
    isActive: true,
  });
  summary.record(catALaCarte.action);
  await upsertLocalization(app, 'api::menu-category.menu-category', catALaCarte.documentId, 'en', {
    name: 'A la carte',
    description: 'Individually priced dishes.',
    slug: 'a-la-carte-en',
  });
  summary.record('updated');

  const cuts = [
    {
      slug: 'picanha',
      vi: { name: 'Picanha', shortDescription: 'Phần ngon nhất của mông bò', order: 0 },
      en: { name: 'Picanha', shortDescription: 'The prized cut from the rump cap', slug: 'picanha' },
      featured: true,
    },
    {
      slug: 'costela',
      vi: { name: 'Costela', shortDescription: 'Sườn bò nướng', order: 1 },
      en: { name: 'Costela', shortDescription: 'Grilled beef ribs', slug: 'costela' },
      featured: true,
    },
    {
      slug: 'cupim',
      vi: { name: 'Cupim', shortDescription: 'Nạc vai bò', order: 2 },
      en: { name: 'Cupim', shortDescription: 'Beef hump', slug: 'cupim' },
      featured: true,
    },
    {
      slug: 'panceta',
      vi: { name: 'Panceta', shortDescription: 'Ba chỉ heo nướng', order: 3 },
      en: { name: 'Panceta', shortDescription: 'Grilled pork belly', slug: 'panceta' },
      featured: true,
    },
    {
      slug: 'cordeiro',
      vi: { name: 'Cordeiro', shortDescription: 'Đùi cừu', order: 4 },
      en: { name: 'Cordeiro', shortDescription: 'Lamb leg', slug: 'cordeiro' },
      featured: true,
    },
    {
      slug: 'camarao',
      vi: { name: 'Camarão', shortDescription: 'Tôm cuộn bacon', order: 5 },
      en: { name: 'Camarão', shortDescription: 'Bacon-wrapped prawns', slug: 'camarao' },
      featured: true,
    },
  ];

  for (const cut of cuts) {
    const created = await upsertBySlug(app, 'api::menu-item.menu-item', 'vi', cut.slug, {
      name: cut.vi.name,
      shortDescription: cut.vi.shortDescription,
      description: paragraph(`${cut.vi.name} — cut signature churrasco.`),
      price: 0,
      category: catThit.documentId,
      isFeatured: cut.featured,
      isActive: true,
      displayOrder: cut.vi.order,
      image: image(mediaId, cut.vi.name),
    });
    summary.record(created.action);
    await upsertLocalization(app, 'api::menu-item.menu-item', created.documentId, 'en', {
      name: cut.en.name,
      shortDescription: cut.en.shortDescription,
      description: paragraph(`${cut.en.name} — signature churrasco cut.`),
      slug: cut.en.slug,
      category: catThit.documentId,
      image: image(mediaId, cut.en.name),
    });
    summary.record('updated');
  }

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

  const itemSteak = await upsertBySlug(app, 'api::menu-item.menu-item', 'vi', 'steak-salanca', {
    name: 'Steak Salanca',
    shortDescription: 'Rib eye steak đúng với sốt nấm hoặc sốt tiêu',
    price: 850000,
    category: catALaCarte.documentId,
    isFeatured: false,
    isActive: true,
    displayOrder: 0,
    image: image(mediaId, 'Steak Salanca'),
  });
  summary.record(itemSteak.action);
  await upsertLocalization(app, 'api::menu-item.menu-item', itemSteak.documentId, 'en', {
    name: 'Steak Salanca',
    shortDescription: 'Rib eye steak with mushroom sauce or pepper sauce',
    slug: 'steak-salanca',
    category: catALaCarte.documentId,
    image: image(mediaId, 'Steak Salanca'),
  });
  summary.record('updated');

  const buffet = await upsertBySlug(app, 'api::menu-package.menu-package', 'vi', 'buffet-chuan', {
    name: 'Buffet Churrascaria',
    description: paragraph('Thịt nướng không giới hạn kèm salad bar.'),
    adultPrice: 950000,
    childPrice: 590000,
    includedItems: [
      { title: 'Hơn 12 loại thịt nướng' },
      { title: 'Salad bar đa dạng' },
      { title: 'Dứa nướng Brazil' },
      { title: 'Phục vụ không giới hạn' },
    ],
    image: image(mediaId, 'Buffet Churrascaria Salanca'),
    isFeatured: true,
    isActive: true,
    displayOrder: 0,
    seo: seo('Buffet Churrascaria', 'Gói buffet churrasco Salanca.', '/vi/thuc-don'),
  });
  summary.record(buffet.action);
  await upsertLocalization(app, 'api::menu-package.menu-package', buffet.documentId, 'en', {
    name: 'Buffet Churrascaria',
    description: paragraph('Unlimited grilled meats with salad bar.'),
    slug: 'signature-buffet',
    includedItems: [
      { title: '12+ grilled meats' },
      { title: 'Generous salad bar' },
      { title: 'Brazilian grilled pineapple' },
      { title: 'Unlimited tableside service' },
    ],
    image: image(mediaId, 'Salanca signature buffet'),
    seo: seo('Buffet Churrascaria', 'Salanca churrasco buffet package.', '/en/menu'),
  });
  summary.record('updated');

  const rodizio = await upsertBySlug(app, 'api::menu-package.menu-package', 'vi', 'rodizio-menu', {
    name: 'Rodizio Menu',
    description: paragraph('Thịt nướng phục vụ liên tục tại bàn theo phong cách rodizio.'),
    adultPrice: 850000,
    childPrice: 490000,
    includedItems: [
      { title: 'Xúc xích Calabresa' },
      { title: 'Cupim' },
      { title: 'Thăn bò cuộn bacon' },
      { title: 'Cánh gà' },
      { title: 'Ba chỉ heo' },
      { title: 'Đùi heo muối' },
      { title: 'Mông bò' },
      { title: 'Dứa nướng' },
    ],
    image: image(mediaId, 'Rodizio Menu Salanca'),
    isFeatured: true,
    isActive: true,
    displayOrder: 1,
    seo: seo('Rodizio Menu', 'Gói rodizio Salanca.', '/vi/thuc-don'),
  });
  summary.record(rodizio.action);
  await upsertLocalization(app, 'api::menu-package.menu-package', rodizio.documentId, 'en', {
    name: 'Rodizio Menu',
    description: paragraph('Continuous tableside carving in the rodizio tradition.'),
    slug: 'rodizio-menu',
    includedItems: [
      { title: 'Calabresa sausage' },
      { title: 'Cupim' },
      { title: 'Bacon-wrapped beef' },
      { title: 'Chicken wings' },
      { title: 'Pork belly' },
      { title: 'Salted pork leg' },
      { title: 'Beef rump' },
      { title: 'Grilled pineapple' },
    ],
    image: image(mediaId, 'Salanca rodizio'),
    seo: seo('Rodizio Menu', 'Salanca rodizio package.', '/en/menu'),
  });
  summary.record('updated');

  return {
    catThit,
    catKem,
    catALaCarte,
    itemSalad,
    itemSteak,
    buffet,
    rodizio,
  };
}
