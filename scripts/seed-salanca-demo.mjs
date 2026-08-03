/**
 * Idempotent demo seed for Salanca CMS content.
 * Safe to re-run: upserts by slug (collections) or singleton (single types).
 *
 * Usage: npm run seed:demo
 */
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadStrapiApp } from './lib/strapi-load.mjs';
import {
  createSummary,
  upsertBySlug,
  upsertLocalization,
  upsertSingleType,
} from './lib/seed-document.mjs';

const summary = createSummary();

function seo(metaTitle, metaDescription, canonicalPath) {
  return {
    metaTitle: metaTitle.slice(0, 60),
    metaDescription: metaDescription.slice(0, 160),
    canonicalPath,
    noIndex: false,
  };
}

function link(label, url) {
  return { label, url, openInNewTab: false };
}

function image(mediaId, alt, caption = null) {
  return { media: mediaId, alt, caption };
}

function hero(mediaId, title, description, ctaLabel, ctaUrl) {
  return {
    title,
    description,
    backgroundImage: image(mediaId, `${title} — ảnh nền`),
    primaryLink: link(ctaLabel, ctaUrl),
  };
}

function cta(heading, body, label, url) {
  return {
    heading,
    body,
    link: link(label, url),
  };
}

function paragraph(text) {
  return [
    {
      type: 'paragraph',
      children: [{ type: 'text', text }],
    },
  ];
}

const app = await loadStrapiApp();

try {
  const uploadService = app.plugin('upload').service('upload');
  const imagePath = resolve('favicon.png');

  // Reuse an existing demo asset when present to avoid duplicate uploads.
  const existingFiles = await app.db.query('plugin::upload.file').findMany({
    where: { name: { $containsi: 'salanca-seed-demo' } },
    limit: 1,
  });

  let mediaId;
  if (existingFiles[0]?.id) {
    mediaId = existingFiles[0].id;
    summary.record('skipped');
    console.log(`media: reuse file id=${mediaId}`);
  } else {
    const [uploaded] = await uploadService.upload({
      data: {
        fileInfo: {
          name: 'salanca-seed-demo.png',
          alternativeText: 'Salanca demo media',
          caption: 'Seeded by seed-salanca-demo.mjs',
        },
      },
      files: {
        filepath: imagePath,
        originalFilename: 'salanca-seed-demo.png',
        mimetype: 'image/png',
        size: statSync(imagePath).size,
      },
    });
    mediaId = uploaded.id;
    summary.record('created');
    console.log(`media: created file id=${mediaId}`);
  }

  // --- Location ---
  const locationVi = await upsertBySlug(
    app,
    'api::location.location',
    'vi',
    'salanca-quan-1',
    {
      name: 'Salanca Quận 1',
      address: '123 Đồng Khởi, Quận 1, TP. Hồ Chí Minh',
      mapUrl: 'https://maps.google.com/?q=Salanca',
      phone: '02812345678',
      email: 'hello@salanca.example',
      operatingHours: [
        { label: 'Buổi trưa', opensAt: '11:00:00.000', closesAt: '14:00:00.000' },
        { label: 'Buổi tối', opensAt: '17:30:00.000', closesAt: '22:00:00.000' },
      ],
      heroImage: image(mediaId, 'Không gian Salanca Quận 1'),
      isActive: true,
      displayOrder: 0,
      seo: seo('Salanca Quận 1', 'Chi nhánh chính Salanca tại trung tâm Quận 1.', '/vi/dia-diem/salanca-quan-1'),
    },
  );
  summary.record(locationVi.action);
  await upsertLocalization(app, 'api::location.location', locationVi.documentId, 'en', {
    name: 'Salanca District 1',
    slug: 'salanca-district-1',
    address: '123 Dong Khoi, District 1, Ho Chi Minh City',
    operatingHours: [
      { label: 'Lunch', opensAt: '11:00:00.000', closesAt: '14:00:00.000' },
      { label: 'Dinner', opensAt: '17:30:00.000', closesAt: '22:00:00.000' },
    ],
    heroImage: image(mediaId, 'Salanca District 1 interior'),
    seo: seo('Salanca District 1', 'Main Salanca branch in District 1.', '/en/locations/salanca-quan-1'),
  });
  summary.record('updated');

  // --- Menu categories ---
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

  // --- Menu items ---
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

  // --- Package ---
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

  // --- Campaigns ---
  const promo = await upsertBySlug(app, 'api::campaign.campaign', 'vi', 'uu-dai-khai-truong', {
    kind: 'promotion',
    title: 'Ưu đãi khai trương',
    summary: 'Giảm 15% cho bàn đặt trước trong tháng này.',
    body: paragraph('Áp dụng cho buffet chuẩn, không gộp voucher khác.'),
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-08-31T23:59:59.000Z',
    isFeatured: true,
    displayOrder: 0,
    coverImage: image(mediaId, 'Ưu đãi khai trương'),
    cta: cta('Đặt bàn ngay', 'Giữ chỗ để nhận ưu đãi khai trương.', 'Đặt bàn', '/vi/dat-ban'),
    seo: seo('Ưu đãi khai trương', 'Khuyến mãi bàn đặt trước tại Salanca.', '/vi/uu-dai/uu-dai-khai-truong'),
  });
  summary.record(promo.action);
  await upsertLocalization(app, 'api::campaign.campaign', promo.documentId, 'en', {
    kind: 'promotion',
    title: 'Opening promotion',
    summary: '15% off for advance bookings this month.',
    body: paragraph('Applies to the signature buffet; cannot stack with other vouchers.'),
    slug: 'opening-promotion',
    coverImage: image(mediaId, 'Opening promotion'),
    cta: cta('Book a table', 'Reserve to claim the opening offer.', 'Book a table', '/en/booking'),
    seo: seo('Opening promotion', 'Advance booking offer at Salanca.', '/en/offers/opening-promotion'),
  });
  summary.record('updated');

  // EN incomplete sample: VI published, EN draft only
  const privateEvent = await upsertBySlug(
    app,
    'api::campaign.campaign',
    'vi',
    'tiec-rieng-tu',
    {
      kind: 'private_event',
      title: 'Tiệc riêng tư',
      summary: 'Không gian phòng riêng cho nhóm từ 10 khách.',
      body: paragraph('Liên hệ để nhận báo giá theo số khách.'),
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-12-31T23:59:59.000Z',
      isFeatured: false,
      displayOrder: 1,
      coverImage: image(mediaId, 'Phòng tiệc riêng'),
      cta: cta('Đặt tiệc riêng', 'Liên hệ để nhận báo giá theo số khách.', 'Liên hệ', '/vi/lien-he'),
      seo: seo('Tiệc riêng tư', 'Đặt phòng riêng tại Salanca.', '/vi/uu-dai/tiec-rieng-tu'),
    },
  );
  summary.record(privateEvent.action);
  await upsertLocalization(
    app,
    'api::campaign.campaign',
    privateEvent.documentId,
    'en',
    {
      kind: 'private_event',
      title: 'Private dining (draft)',
      summary: 'Translation pending editorial review.',
      slug: 'private-dining-draft',
      coverImage: image(mediaId, 'Private dining room'),
      cta: cta('Private dining', 'Contact us for a group quote.', 'Contact', '/en/contact'),
      seo: seo(
        'Private dining draft',
        'English copy pending review — keep draft.',
        '/en/offers/private-dining-draft',
      ),
    },
    { publish: false },
  );
  summary.record('updated');

  // --- Gallery (no slug field — upsert by title) ---
  {
    const galleryUid = 'api::gallery-item.gallery-item';
    const galleryTitle = 'Sảnh chính';
    const galleryData = {
      title: galleryTitle,
      description: 'Không gian sảnh chính về đêm.',
      image: image(mediaId, 'Sảnh chính Salanca'),
      area: 'main_hall',
      location: locationVi.documentId,
      displayOrder: 0,
      isActive: true,
    };
    const existingGallery = await app.documents(galleryUid).findMany({
      locale: 'vi',
      filters: { title: { $eq: galleryTitle } },
      limit: 1,
    });
    if (existingGallery[0]) {
      await app.documents(galleryUid).update({
        documentId: existingGallery[0].documentId,
        locale: 'vi',
        data: galleryData,
      });
      await app.documents(galleryUid).publish({
        documentId: existingGallery[0].documentId,
        locale: 'vi',
      });
      summary.record('updated');
    } else {
      const createdGallery = await app.documents(galleryUid).create({
        locale: 'vi',
        data: galleryData,
      });
      await app.documents(galleryUid).publish({
        documentId: createdGallery.documentId,
        locale: 'vi',
      });
      summary.record('created');
    }
  }

  // --- Global setting ---
  const globalResult = await upsertSingleType(app, 'api::global-setting.global-setting', 'vi', {
    brandName: 'Salanca',
    tagline: 'Churrascaria Brazil tại Sài Gòn',
    hotline: '02812345678',
    email: 'hello@salanca.example',
    address: '123 Đồng Khởi, Quận 1, TP. Hồ Chí Minh',
    mapUrl: 'https://maps.google.com/?q=Salanca',
    openingHours: [
      { label: 'Hằng ngày', opensAt: '11:00:00.000', closesAt: '22:00:00.000' },
    ],
    socialLinks: [
      { platform: 'facebook', label: 'Facebook', url: 'https://facebook.com/salanca' },
      { platform: 'instagram', label: 'Instagram', url: 'https://instagram.com/salanca' },
    ],
    headerLinks: [
      link('Thực đơn', '/vi/thuc-don'),
      link('Ưu đãi', '/vi/uu-dai'),
      link('Đặt bàn', '/vi/dat-ban'),
    ],
    footerExploreLinks: [
      link('Câu chuyện', '/vi/cau-chuyen'),
      link('Không gian', '/vi/khong-gian'),
    ],
    footerInfoLinks: [
      link('Liên hệ', '/vi/lien-he'),
      link('Đặt bàn', '/vi/dat-ban'),
    ],
    mainLocation: locationVi.documentId,
    defaultSeo: seo(
      'Salanca Churrascaria',
      'Nhà hàng thịt nướng Brazil tại TP. Hồ Chí Minh.',
      '/vi',
    ),
  });
  summary.record(globalResult.action);
  await upsertLocalization(app, 'api::global-setting.global-setting', globalResult.documentId, 'en', {
    brandName: 'Salanca',
    tagline: 'Brazilian churrascaria in Saigon',
    address: '123 Dong Khoi, District 1, Ho Chi Minh City',
    openingHours: [
      { label: 'Daily', opensAt: '11:00:00.000', closesAt: '22:00:00.000' },
    ],
    socialLinks: [
      { platform: 'facebook', label: 'Facebook', url: 'https://facebook.com/salanca' },
      { platform: 'instagram', label: 'Instagram', url: 'https://instagram.com/salanca' },
    ],
    headerLinks: [
      link('Menu', '/en/menu'),
      link('Offers', '/en/offers'),
      link('Booking', '/en/booking'),
    ],
    footerExploreLinks: [
      link('Our story', '/en/story'),
      link('Spaces', '/en/spaces'),
    ],
    footerInfoLinks: [
      link('Contact', '/en/contact'),
      link('Booking', '/en/booking'),
    ],
    defaultSeo: seo(
      'Salanca Churrascaria',
      'Brazilian grilled meats restaurant in Ho Chi Minh City.',
      '/en',
    ),
  });
  summary.record('updated');

  // --- Pages (required hero + seo) ---
  async function seedPage(uid, viData, enData) {
    const vi = await upsertSingleType(app, uid, 'vi', viData);
    summary.record(vi.action);
    if (enData) {
      await upsertLocalization(app, uid, vi.documentId, 'en', enData);
      summary.record('updated');
    }
    return vi;
  }

  await seedPage(
    'api::home-page.home-page',
    {
      hero: hero(mediaId, 'Thịt nướng Brazil đúng điệu', 'Rodizio không giới hạn tại trung tâm Sài Gòn.', 'Xem thực đơn', '/vi/thuc-don'),
      experienceHeading: 'Trải nghiệm churrasco',
      experienceBody: 'Thịt được nướng trên que sắt và phục vụ tận bàn.',
      experienceImage: image(mediaId, 'Trải nghiệm churrasco'),
      experienceLink: link('Khám phá', '/vi/trai-nghiem'),
      featuredPackage: pkg.documentId,
      featuredMenuHeading: 'Món nổi bật',
      closingCta: cta('Đặt bàn tối nay', 'Giữ chỗ trước để có bàn đẹp.', 'Đặt bàn', '/vi/dat-ban'),
      seo: seo('Salanca — Trang chủ', 'Churrascaria Brazil tại Sài Gòn.', '/vi'),
    },
    {
      hero: hero(mediaId, 'Authentic Brazilian grill', 'Unlimited rodizio in central Saigon.', 'View menu', '/en/menu'),
      experienceHeading: 'The churrasco experience',
      experienceBody: 'Meats grilled on skewers and carved tableside.',
      experienceImage: image(mediaId, 'Churrasco experience'),
      experienceLink: link('Explore', '/en/experience'),
      featuredMenuHeading: 'Featured dishes',
      closingCta: cta('Book tonight', 'Reserve ahead for the best tables.', 'Book', '/en/booking'),
      seo: seo('Salanca — Home', 'Brazilian churrascaria in Saigon.', '/en'),
    },
  );

  await seedPage(
    'api::menu-page.menu-page',
    {
      hero: hero(mediaId, 'Thực đơn', 'Buffet và các món nướng signature.', 'Đặt bàn', '/vi/dat-ban'),
      packageSectionHeading: 'Gói buffet',
      itemSectionHeading: 'Món nổi bật',
      bookingCta: cta('Sẵn sàng đặt bàn?', 'Chọn gói và giữ chỗ.', 'Đặt bàn', '/vi/dat-ban'),
      seo: seo('Thực đơn Salanca', 'Buffet và món nướng.', '/vi/thuc-don'),
    },
    {
      hero: hero(mediaId, 'Menu', 'Buffet packages and signature cuts.', 'Book', '/en/booking'),
      packageSectionHeading: 'Buffet packages',
      itemSectionHeading: 'Featured items',
      bookingCta: cta('Ready to book?', 'Pick a package and reserve.', 'Book', '/en/booking'),
      seo: seo('Salanca menu', 'Buffet and grilled dishes.', '/en/menu'),
    },
  );

  await seedPage(
    'api::campaign-page.campaign-page',
    {
      hero: hero(mediaId, 'Ưu đãi & sự kiện', 'Khuyến mãi và tiệc riêng.', 'Xem ưu đãi', '/vi/uu-dai'),
      featuredHeading: 'Nổi bật',
      listingHeading: 'Tất cả chương trình',
      closingCta: cta('Cần tư vấn sự kiện?', 'Đội ngũ Salanca sẵn sàng hỗ trợ.', 'Liên hệ', '/vi/lien-he'),
      seo: seo('Ưu đãi Salanca', 'Khuyến mãi và sự kiện.', '/vi/uu-dai'),
    },
    {
      hero: hero(mediaId, 'Offers & events', 'Promotions and private events.', 'View offers', '/en/offers'),
      featuredHeading: 'Featured',
      listingHeading: 'All programs',
      closingCta: cta('Planning an event?', 'Our team can help.', 'Contact', '/en/contact'),
      seo: seo('Salanca offers', 'Promotions and events.', '/en/offers'),
    },
  );

  await seedPage(
    'api::story-page.story-page',
    {
      hero: hero(mediaId, 'Câu chuyện Salanca', 'Hành trình mang churrasco đến Sài Gòn.', 'Trải nghiệm', '/vi/trai-nghiem'),
      originHeading: 'Nguồn gốc',
      closingCta: cta('Ghé thăm chúng tôi', 'Một buổi tối nướng đúng điệu.', 'Đặt bàn', '/vi/dat-ban'),
      seo: seo('Câu chuyện Salanca', 'Về Salanca churrascaria.', '/vi/cau-chuyen'),
    },
    {
      hero: hero(mediaId, 'Our story', 'Bringing churrasco to Saigon.', 'Experience', '/en/experience'),
      originHeading: 'Origins',
      closingCta: cta('Visit us', 'An evening of proper grill.', 'Book', '/en/booking'),
      seo: seo('Salanca story', 'About Salanca churrascaria.', '/en/story'),
    },
  );

  await seedPage(
    'api::experience-page.experience-page',
    {
      hero: hero(mediaId, 'Trải nghiệm', 'Rodizio, nghi thức và hương vị.', 'Đặt bàn', '/vi/dat-ban'),
      introHeading: 'Một buổi tối churrasco',
      closingCta: cta('Thưởng thức ngay', 'Giữ chỗ cho nhóm của bạn.', 'Đặt bàn', '/vi/dat-ban'),
      seo: seo('Trải nghiệm Salanca', 'Quy trình rodizio tại Salanca.', '/vi/trai-nghiem'),
    },
    {
      hero: hero(mediaId, 'Experience', 'Rodizio, ritual and flavour.', 'Book', '/en/booking'),
      introHeading: 'A churrasco evening',
      closingCta: cta('Taste it tonight', 'Reserve for your group.', 'Book', '/en/booking'),
      seo: seo('Salanca experience', 'The rodizio flow at Salanca.', '/en/experience'),
    },
  );

  await seedPage(
    'api::space-page.space-page',
    {
      hero: hero(mediaId, 'Không gian', 'Sảnh chính, quầy bar và phòng riêng.', 'Đặt bàn', '/vi/dat-ban'),
      introHeading: 'Không gian nhà hàng',
      closingCta: cta('Tham quan & đặt chỗ', 'Phù hợp hẹn hò và tiệc nhóm.', 'Liên hệ', '/vi/lien-he'),
      seo: seo('Không gian Salanca', 'Gallery và khu vực nhà hàng.', '/vi/khong-gian'),
    },
    {
      hero: hero(mediaId, 'Spaces', 'Main hall, bar and private rooms.', 'Book', '/en/booking'),
      introHeading: 'Restaurant spaces',
      closingCta: cta('Visit & reserve', 'Ideal for dates and groups.', 'Contact', '/en/contact'),
      seo: seo('Salanca spaces', 'Gallery and dining areas.', '/en/spaces'),
    },
  );

  await seedPage(
    'api::contact-page.contact-page',
    {
      hero: hero(mediaId, 'Liên hệ', 'Ghé thăm hoặc gửi lời nhắn.', 'Gọi hotline', 'tel:02812345678'),
      visitHeading: 'Ghé nhà hàng',
      formHeading: 'Gửi thông tin',
      closingCta: cta('Cần đặt bàn gấp?', 'Gọi hotline để được hỗ trợ.', 'Gọi ngay', 'tel:02812345678'),
      seo: seo('Liên hệ Salanca', 'Địa chỉ và thông tin liên hệ.', '/vi/lien-he'),
    },
    {
      hero: hero(mediaId, 'Contact', 'Visit us or send a message.', 'Call hotline', 'tel:02812345678'),
      visitHeading: 'Visit the restaurant',
      formHeading: 'Send a message',
      closingCta: cta('Need a table soon?', 'Call the hotline for help.', 'Call now', 'tel:02812345678'),
      seo: seo('Contact Salanca', 'Address and contact details.', '/en/contact'),
    },
  );

  await seedPage(
    'api::booking-page.booking-page',
    {
      hero: hero(mediaId, 'Đặt bàn', 'Giữ chỗ trước — chưa phải booking engine.', 'Gọi hotline', 'tel:02812345678'),
      formHeading: 'Thông tin đặt bàn',
      seo: seo('Đặt bàn Salanca', 'Hướng dẫn đặt bàn tại Salanca.', '/vi/dat-ban'),
    },
    {
      hero: hero(mediaId, 'Booking', 'Reserve ahead — not a live booking engine yet.', 'Call hotline', 'tel:02812345678'),
      formHeading: 'Reservation details',
      seo: seo('Book Salanca', 'How to reserve at Salanca.', '/en/booking'),
    },
  );

  console.log(`seed:demo complete — ${summary.toString()}`);
} catch (error) {
  console.error('seed:demo failed');
  console.error(error);
  if (error?.details?.errors) {
    console.error(
      'validation details:',
      JSON.stringify(error.details.errors, null, 2),
    );
  }
  process.exitCode = 1;
} finally {
  // Strapi/pg pool sometimes aborts in-flight clients during destroy on Windows.
  // That must not flip a successful seed to a non-zero exit.
  await app.destroy().catch((destroyError) => {
    console.warn('seed:demo shutdown warning:', destroyError?.message ?? destroyError);
  });
  process.exit(process.exitCode ?? 0);
}
