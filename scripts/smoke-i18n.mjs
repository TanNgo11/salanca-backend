import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { compileStrapi, createStrapi } = require('@strapi/core');

process.env.PORT = process.env.I18N_SMOKE_PORT ?? '1340';

const suffix = `${Date.now()}-${process.pid}`;
const created = [];
const appContext = await compileStrapi();
const app = await createStrapi(appContext).load();
const apiTokenService = app.service('admin::api-token-content-api');
const uploadService = app.plugin('upload').service('upload');
let apiToken;
let uploadedFile;

async function create(uid, locale, data) {
  const document = await app.documents(uid).create({ locale, data });
  created.unshift([uid, document.documentId]);
  return document;
}

async function localize(uid, documentId, data) {
  return app.documents(uid).update({ documentId, locale: 'en', data });
}

async function publish(uid, documentId, locale) {
  return app.documents(uid).publish({ documentId, locale });
}

async function removeDocument(uid, documentId) {
  for (const locale of ['en', 'vi']) {
    await app.documents(uid).delete({ documentId, locale }).catch(() => undefined);
  }
}

function image(mediaId, alt, caption) {
  return { media: mediaId, alt, caption };
}

function seo(language) {
  return {
    metaTitle: `${language} SEO ${suffix}`,
    metaDescription: `${language} SEO description for the Phase 3 smoke dataset.`,
    canonicalPath: `/${language.toLowerCase()}-${suffix}`,
    noIndex: true,
  };
}

function hero(mediaId, language) {
  return {
    title: `${language} hero ${suffix}`,
    description: `${language} localized hero description.`,
    backgroundImage: image(
      mediaId,
      `${language} hero image alt`,
      `${language} hero image caption`,
    ),
  };
}

function cta(language) {
  return {
    heading: `${language} CTA ${suffix}`,
    body: `${language} CTA body.`,
    link: {
      label: `${language} CTA link`,
      url: `/${language.toLowerCase()}-booking`,
      openInNewTab: false,
    },
  };
}

async function assertSingletonEmpty(uid) {
  const count = await app.db.query(uid).count();
  assert.equal(
    count,
    0,
    `${uid} must be empty before smoke:i18n so real editorial content is never overwritten`,
  );
}

async function createLocalizedCategory(index) {
  const vi = await create('api::menu-category.menu-category', 'vi', {
    name: `Danh mục ${index} ${suffix}`,
    slug: `danh-muc-${index}-${suffix}`,
    displayOrder: 9900 + index,
    isActive: false,
  });
  const en = await localize('api::menu-category.menu-category', vi.documentId, {
    name: `Category ${index} ${suffix}`,
    slug: `category-${index}-${suffix}`,
  });
  return { vi, en };
}

async function createLocalizedItem(index, categoryDocumentId) {
  const vi = await create('api::menu-item.menu-item', 'vi', {
    name: `Món ${index} ${suffix}`,
    slug: `mon-${index}-${suffix}`,
    price: 100000 + index * 10000,
    category: categoryDocumentId,
    displayOrder: 9900 + index,
    isFeatured: false,
    isActive: false,
  });
  const en = await localize('api::menu-item.menu-item', vi.documentId, {
    name: `Item ${index} ${suffix}`,
    slug: `item-${index}-${suffix}`,
    category: categoryDocumentId,
  });
  return { vi, en };
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiToken.accessKey}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

try {
  const localeService = app.plugin('i18n').service('locales');
  const locales = await localeService.find();
  assert.deepEqual(locales.map(({ code }) => code).sort(), ['en', 'vi']);
  assert.equal(await localeService.getDefaultLocale(), 'vi');

  await assertSingletonEmpty('api::global-setting.global-setting');
  await assertSingletonEmpty('api::campaign-page.campaign-page');

  const imagePath = resolve('favicon.png');
  [uploadedFile] = await uploadService.upload({
    data: {
      fileInfo: {
        name: `phase-3-i18n-smoke-${suffix}.png`,
        alternativeText: 'Temporary Phase 3 smoke asset',
        caption: 'Automatically deleted after smoke:i18n',
      },
    },
    files: {
      filepath: imagePath,
      originalFilename: `phase-3-i18n-smoke-${suffix}.png`,
      mimetype: 'image/png',
      size: statSync(imagePath).size,
    },
  });
  assert.ok(uploadedFile.id);

  const locationVi = await create('api::location.location', 'vi', {
    name: `Địa điểm thử nghiệm ${suffix}`,
    slug: `dia-diem-thu-nghiem-${suffix}`,
    address: 'Địa chỉ thử nghiệm tiếng Việt',
    heroImage: image(uploadedFile.id, 'Không gian nhà hàng', 'Chú thích tiếng Việt'),
    isActive: false,
    displayOrder: 9999,
  });
  const locationEn = await localize('api::location.location', locationVi.documentId, {
    name: `Test location ${suffix}`,
    slug: `test-location-${suffix}`,
    address: 'English test address',
    heroImage: image(uploadedFile.id, 'Restaurant space', 'English caption'),
  });

  const categoryA = await createLocalizedCategory(1);
  const categoryB = await createLocalizedCategory(2);
  const fullItems = [
    await createLocalizedItem(1, categoryA.vi.documentId),
    await createLocalizedItem(2, categoryA.vi.documentId),
    await createLocalizedItem(3, categoryB.vi.documentId),
  ];
  for (const item of fullItems) {
    assert.equal(item.vi.documentId, item.en.documentId);
  }

  const viOnlyItem = await create('api::menu-item.menu-item', 'vi', {
    name: `Món chỉ có tiếng Việt ${suffix}`,
    slug: `mon-chi-co-tieng-viet-${suffix}`,
    price: 99000,
    category: categoryB.vi.documentId,
    displayOrder: 9998,
    isFeatured: false,
    isActive: false,
  });
  assert.equal(
    await app.documents('api::menu-item.menu-item').findOne({
      documentId: viOnlyItem.documentId,
      locale: 'en',
      status: 'draft',
    }),
    null,
  );

  const firstItemEn = await app.documents('api::menu-item.menu-item').findOne({
    documentId: fullItems[0].vi.documentId,
    locale: 'en',
    status: 'draft',
    populate: ['category'],
  });
  assert.equal(firstItemEn.category.locale, 'en');
  assert.equal(firstItemEn.category.documentId, categoryA.en.documentId);
  assert.notEqual(fullItems[0].vi.slug, fullItems[0].en.slug);

  await app.documents('api::menu-item.menu-item').update({
    documentId: fullItems[0].vi.documentId,
    locale: 'en',
    data: { price: 135000 },
  });
  const firstItemViAfterPriceSync = await app.documents('api::menu-item.menu-item').findOne({
    documentId: fullItems[0].vi.documentId,
    locale: 'vi',
    status: 'draft',
  });
  assert.equal(Number(firstItemViAfterPriceSync.price), 135000);

  const packageVi = await create('api::menu-package.menu-package', 'vi', {
    name: `Gói thử nghiệm ${suffix}`,
    slug: `goi-thu-nghiem-${suffix}`,
    adultPrice: 750000,
    childPrice: 350000,
    includedItems: [{ title: 'Nội dung gói', description: 'Mô tả tiếng Việt' }],
    isFeatured: false,
    isActive: false,
    displayOrder: 9999,
  });
  const packageEn = await localize('api::menu-package.menu-package', packageVi.documentId, {
    name: `Test package ${suffix}`,
    slug: `test-package-${suffix}`,
    includedItems: [{ title: 'Package content', description: 'English description' }],
  });
  assert.equal(Number(packageVi.adultPrice), Number(packageEn.adultPrice));
  assert.equal(Number(packageVi.childPrice), Number(packageEn.childPrice));

  const campaignVi = await create('api::campaign.campaign', 'vi', {
    kind: 'event',
    title: `Sự kiện thử nghiệm ${suffix}`,
    slug: `su-kien-thu-nghiem-${suffix}`,
    startsAt: '2026-08-01T12:00:00.000Z',
    endsAt: '2026-08-01T15:00:00.000Z',
    displayOrder: 9999,
    isFeatured: false,
    seo: seo('Vietnamese'),
  });
  const campaignEn = await localize('api::campaign.campaign', campaignVi.documentId, {
    title: `Test event ${suffix}`,
    slug: `test-event-${suffix}`,
    seo: seo('English'),
  });
  assert.equal(campaignVi.startsAt, campaignEn.startsAt);
  assert.equal(campaignVi.endsAt, campaignEn.endsAt);

  const galleryVi = await create('api::gallery-item.gallery-item', 'vi', {
    title: `Ảnh thử nghiệm ${suffix}`,
    description: 'Mô tả ảnh tiếng Việt',
    image: image(uploadedFile.id, 'Không gian Salanca', 'Chú thích tiếng Việt'),
    area: 'main_hall',
    location: locationVi.documentId,
    displayOrder: 9999,
    isActive: false,
  });
  await localize('api::gallery-item.gallery-item', galleryVi.documentId, {
    title: `Test gallery ${suffix}`,
    description: 'English gallery description',
    image: image(uploadedFile.id, 'Salanca dining space', 'English caption'),
    location: locationVi.documentId,
  });
  const [galleryViRead, galleryEnRead] = await Promise.all([
    app.documents('api::gallery-item.gallery-item').findOne({
      documentId: galleryVi.documentId,
      locale: 'vi',
      status: 'draft',
      populate: { image: { populate: ['media'] }, location: true },
    }),
    app.documents('api::gallery-item.gallery-item').findOne({
      documentId: galleryVi.documentId,
      locale: 'en',
      status: 'draft',
      populate: { image: { populate: ['media'] }, location: true },
    }),
  ]);
  assert.equal(galleryViRead.image.media.id, galleryEnRead.image.media.id);
  assert.notEqual(galleryViRead.image.alt, galleryEnRead.image.alt);
  assert.equal(galleryViRead.location.locale, 'vi');
  assert.equal(galleryEnRead.location.locale, 'en');

  const globalVi = await create('api::global-setting.global-setting', 'vi', {
    brandName: `Salanca thử nghiệm ${suffix}`,
    hotline: '0900000000',
    email: 'smoke@example.com',
    address: 'Địa chỉ thương hiệu tiếng Việt',
    mainLocation: locationVi.documentId,
    defaultSeo: seo('Vietnamese global'),
  });
  await localize('api::global-setting.global-setting', globalVi.documentId, {
    brandName: `Salanca test ${suffix}`,
    address: 'English brand address',
    mainLocation: locationVi.documentId,
    defaultSeo: seo('English global'),
  });
  const globalEnRead = await app.documents('api::global-setting.global-setting').findOne({
    documentId: globalVi.documentId,
    locale: 'en',
    status: 'draft',
    populate: ['mainLocation'],
  });
  assert.equal(globalEnRead.hotline, '0900000000');
  assert.equal(globalEnRead.mainLocation.locale, 'en');

  const campaignPageVi = await create('api::campaign-page.campaign-page', 'vi', {
    hero: hero(uploadedFile.id, 'Vietnamese'),
    featuredHeading: `Nổi bật ${suffix}`,
    featuredCampaign: campaignVi.documentId,
    listingHeading: `Danh sách ${suffix}`,
    closingCta: cta('Vietnamese'),
    seo: seo('Vietnamese page'),
  });
  await localize('api::campaign-page.campaign-page', campaignPageVi.documentId, {
    hero: hero(uploadedFile.id, 'English'),
    featuredHeading: `Featured ${suffix}`,
    featuredCampaign: campaignVi.documentId,
    listingHeading: `Campaign list ${suffix}`,
    closingCta: cta('English'),
    seo: seo('English page'),
  });

  for (const category of [categoryA, categoryB]) {
    await publish('api::menu-category.menu-category', category.vi.documentId, 'vi');
    await publish('api::menu-category.menu-category', category.vi.documentId, 'en');
  }
  for (const item of fullItems) {
    await publish('api::menu-item.menu-item', item.vi.documentId, 'vi');
    await publish('api::menu-item.menu-item', item.vi.documentId, 'en');
  }
  await publish('api::menu-package.menu-package', packageVi.documentId, 'vi');
  await publish('api::menu-package.menu-package', packageVi.documentId, 'en');
  await publish('api::campaign.campaign', campaignVi.documentId, 'vi');
  await publish('api::campaign.campaign', campaignVi.documentId, 'en');
  await publish('api::location.location', locationVi.documentId, 'vi');
  await publish('api::location.location', locationVi.documentId, 'en');
  await publish('api::gallery-item.gallery-item', galleryVi.documentId, 'vi');
  await publish('api::gallery-item.gallery-item', galleryVi.documentId, 'en');
  await publish('api::global-setting.global-setting', globalVi.documentId, 'vi');
  await publish('api::campaign-page.campaign-page', campaignPageVi.documentId, 'vi');

  assert.equal(
    await app.documents('api::campaign-page.campaign-page').findOne({
      documentId: campaignPageVi.documentId,
      locale: 'en',
      status: 'published',
    }),
    null,
  );
  assert.ok(await app.documents('api::campaign-page.campaign-page').findOne({
    documentId: campaignPageVi.documentId,
    locale: 'en',
    status: 'draft',
  }));

  await app.documents('api::campaign-page.campaign-page').update({
    documentId: campaignPageVi.documentId,
    locale: 'vi',
    data: { featuredHeading: `Nổi bật đã sửa ${suffix}` },
  });
  const [pageViDraftAfterUpdate, pageViPublishedBeforeRepublish] = await Promise.all([
    app.documents('api::campaign-page.campaign-page').findOne({
      documentId: campaignPageVi.documentId,
      locale: 'vi',
      status: 'draft',
    }),
    app.documents('api::campaign-page.campaign-page').findOne({
      documentId: campaignPageVi.documentId,
      locale: 'vi',
      status: 'published',
    }),
  ]);
  assert.notEqual(
    pageViDraftAfterUpdate.featuredHeading,
    pageViPublishedBeforeRepublish.featuredHeading,
  );
  await publish('api::campaign-page.campaign-page', campaignPageVi.documentId, 'vi');

  apiToken = await apiTokenService.create({
    name: `Phase 3 i18n smoke ${suffix}`,
    description: 'Temporary token; automatically revoked by smoke-i18n.mjs',
    type: 'full-access',
    permissions: [],
    lifespan: null,
  });
  await app.start();

  const viItemQuery = new URLSearchParams({
    locale: 'vi',
    'filters[slug][$eq]': fullItems[0].vi.slug,
    populate: 'category',
  });
  const enItemQuery = new URLSearchParams({
    locale: 'en',
    'filters[slug][$eq]': fullItems[0].en.slug,
    populate: 'category',
  });
  const [viItemResponse, enItemResponse] = await Promise.all([
    apiRequest(`/api/menu-items?${viItemQuery}`),
    apiRequest(`/api/menu-items?${enItemQuery}`),
  ]);
  assert.equal(viItemResponse.response.status, 200);
  assert.equal(enItemResponse.response.status, 200);
  assert.equal(viItemResponse.body.data[0].locale, 'vi');
  assert.equal(viItemResponse.body.data[0].category.locale, 'vi');
  assert.equal(enItemResponse.body.data[0].locale, 'en');
  assert.equal(enItemResponse.body.data[0].category.locale, 'en');

  const missingEnQuery = new URLSearchParams({
    locale: 'en',
    'filters[documentId][$eq]': viOnlyItem.documentId,
  });
  const missingEnResponse = await apiRequest(`/api/menu-items?${missingEnQuery}`);
  assert.equal(missingEnResponse.response.status, 200);
  assert.equal(missingEnResponse.body.data.length, 0);

  const duplicateSlugResponse = await apiRequest('/api/menu-categories?locale=vi', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        name: `Duplicate slug ${suffix}`,
        slug: categoryA.vi.slug,
        displayOrder: 9999,
        isActive: false,
      },
    }),
  });
  if (duplicateSlugResponse.response.status === 201 && duplicateSlugResponse.body?.data?.documentId) {
    created.unshift([
      'api::menu-category.menu-category',
      duplicateSlugResponse.body.data.documentId,
    ]);
  }
  assert.equal(duplicateSlugResponse.response.status, 400);

  const missingCategoryResponse = await apiRequest('/api/menu-items?locale=vi', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        name: `Missing category ${suffix}`,
        slug: `missing-category-${suffix}`,
        price: 1000,
        displayOrder: 9999,
        isFeatured: false,
        isActive: false,
      },
    }),
  });
  if (missingCategoryResponse.response.status === 201 && missingCategoryResponse.body?.data?.documentId) {
    created.unshift(['api::menu-item.menu-item', missingCategoryResponse.body.data.documentId]);
  }
  assert.equal(missingCategoryResponse.response.status, 400);

  await app.documents('api::menu-item.menu-item').unpublish({
    documentId: fullItems[0].vi.documentId,
    locale: 'en',
  });
  const enAfterUnpublish = await apiRequest(`/api/menu-items?${enItemQuery}`);
  assert.equal(enAfterUnpublish.response.status, 200);
  assert.equal(enAfterUnpublish.body.data.length, 0);
  assert.ok(await app.documents('api::menu-item.menu-item').findOne({
    documentId: fullItems[0].vi.documentId,
    locale: 'vi',
    status: 'published',
  }));

  console.log(
    'i18n smoke passed: required dataset, localized singletons/slugs/components/media/relations, shared technical fields, validation, missing translation, REST locale contract, and independent publish state.',
  );
} finally {
  if (apiToken?.id) {
    await apiTokenService.revoke(apiToken.id).catch(() => undefined);
  }
  for (const [uid, documentId] of created) {
    await removeDocument(uid, documentId);
  }
  if (uploadedFile?.id) {
    await uploadService.remove(uploadedFile).catch(() => undefined);
  }
  for (const [uid, documentId] of created) {
    assert.equal(
      await app.db.query(uid).count({ where: { documentId } }),
      0,
      `cleanup left ${uid} fixture ${documentId} in PostgreSQL`,
    );
  }
  if (apiToken?.id) {
    assert.equal(
      await app.db.query('admin::api-token').count({ where: { id: apiToken.id } }),
      0,
      `cleanup left temporary API token ${apiToken.id} in PostgreSQL`,
    );
  }
  if (uploadedFile?.id) {
    assert.equal(
      await app.db.query('plugin::upload.file').count({ where: { id: uploadedFile.id } }),
      0,
      `cleanup left temporary media ${uploadedFile.id} in the Media Library`,
    );
  }
  await app.destroy();
}
