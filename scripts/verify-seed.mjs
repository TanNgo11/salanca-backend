/**
 * Verifies demo seed invariants (counts, prices, locale isolation, EN draft).
 * Usage: npm run verify:seed
 */
import assert from 'node:assert/strict';

import { loadStrapiApp } from './lib/strapi-load.mjs';
import { findBySlug } from './lib/seed-document.mjs';

const app = await loadStrapiApp();

try {
  const location = await findBySlug(app, 'api::location.location', 'vi', 'salanca-quan-1');
  assert.ok(location, 'expected seeded location salanca-quan-1');

  const categories = await app.documents('api::menu-category.menu-category').findMany({
    locale: 'vi',
    status: 'published',
    filters: { slug: { $in: ['thit-nuong', 'mon-kem'] } },
  });
  assert.ok(categories.length >= 2, 'expected at least 2 menu categories');

  const picanha = await findBySlug(app, 'api::menu-item.menu-item', 'vi', 'picanha');
  assert.ok(picanha, 'expected menu item picanha');
  assert.equal(typeof Number(picanha.price), 'number');

  const pkg = await findBySlug(app, 'api::menu-package.menu-package', 'vi', 'buffet-chuan');
  assert.ok(pkg, 'expected package buffet-chuan');
  assert.ok(Number(pkg.adultPrice) > 0, 'adultPrice must be numeric and positive');

  const promo = await findBySlug(app, 'api::campaign.campaign', 'vi', 'uu-dai-khai-truong');
  assert.ok(promo, 'expected campaign uu-dai-khai-truong');
  const promoEn = await app.documents('api::campaign.campaign').findOne({
    documentId: promo.documentId,
    locale: 'en',
    status: 'published',
  });
  assert.ok(promoEn, 'opening promotion EN should be published');

  const privateEvent = await findBySlug(app, 'api::campaign.campaign', 'vi', 'tiec-rieng-tu');
  assert.ok(privateEvent, 'expected campaign tiec-rieng-tu');
  const privateEnPublished = await app.documents('api::campaign.campaign').findOne({
    documentId: privateEvent.documentId,
    locale: 'en',
    status: 'published',
  });
  assert.equal(
    privateEnPublished,
    null,
    'private event EN must remain draft (not published)',
  );
  const privateEnDraft = await app.documents('api::campaign.campaign').findOne({
    documentId: privateEvent.documentId,
    locale: 'en',
    status: 'draft',
  });
  assert.ok(privateEnDraft, 'private event EN draft should exist');

  const globalVi = await app.documents('api::global-setting.global-setting').findFirst({
    locale: 'vi',
    status: 'published',
  });
  assert.ok(globalVi, 'global-setting VI published required');
  assert.equal(globalVi.brandName, 'Salanca');

  const homeVi = await app.documents('api::home-page.home-page').findFirst({
    locale: 'vi',
    status: 'published',
  });
  assert.ok(homeVi, 'home-page VI published required');

  for (const uid of [
    'api::menu-page.menu-page',
    'api::campaign-page.campaign-page',
    'api::story-page.story-page',
    'api::experience-page.experience-page',
    'api::space-page.space-page',
    'api::contact-page.contact-page',
    'api::booking-page.booking-page',
  ]) {
    const page = await app.documents(uid).findFirst({ locale: 'vi', status: 'published' });
    assert.ok(page, `${uid} VI published required`);
  }

  const gallery = await app.documents('api::gallery-item.gallery-item').findMany({
    locale: 'vi',
    status: 'published',
    filters: { title: { $eq: 'Sảnh chính' } },
    limit: 1,
  });
  assert.ok(gallery[0], 'expected gallery item Sảnh chính');

  console.log('verify:seed passed');
} catch (error) {
  console.error('verify:seed failed');
  console.error(error);
  process.exitCode = 1;
} finally {
  await app.destroy();
}
