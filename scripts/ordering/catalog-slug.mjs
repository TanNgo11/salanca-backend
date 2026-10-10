import assert from 'node:assert/strict';

import { withApp } from './_harness.mjs';

const PRODUCT = 'plugin::ordering.catalog-product';
const CATEGORY = 'plugin::ordering.catalog-category';
const SLUG = 'plugin::ordering.catalog-slug';

const slugRows = async (app, entityType, documentId) =>
  app.db
    .query(SLUG)
    .findMany({ where: { entityType, entityDocumentId: documentId }, orderBy: { locale: 'asc' } });

withApp(async (app) => {
  const docs = (uid) => app.documents(uid);

  // Create: provided slug wins per locale, missing locales derive from name.
  const p1 = await docs(PRODUCT).create({
    data: {
      productType: 'food',
      name: { vi: 'Bún bò Huế', en: 'Hue beef noodle' },
      slug: { vi: 'bun-bo-hue-custom' },
      status: 'active',
      sellOnline: true,
    },
  });
  let rows = await slugRows(app, 'catalog-product', p1.documentId);
  assert.deepEqual(
    rows.map(({ locale, slug }) => [locale, slug]),
    [
      ['en', 'hue-beef-noodle'],
      ['vi', 'bun-bo-hue-custom'],
    ],
  );

  // Duplicate slug in the same locale → field-level validation error, nothing persisted.
  await assert.rejects(
    docs(PRODUCT).create({
      data: {
        productType: 'food',
        name: { vi: 'Món khác' },
        slug: { vi: 'Bun Bo Hue Custom!!' },
        status: 'draft',
      },
    }),
    (error) => error?.code === 'VALIDATION_ERROR' && error?.details?.field === 'slug.vi',
  );
  const orphans = await app.db.query(SLUG).findMany({
    where: { entityType: 'catalog-product', slug: 'mon-khac' },
  });
  assert.equal(orphans.length, 0, 'rejected create must not leave slug rows');

  // The same slug in a different locale is fine.
  const p2 = await docs(PRODUCT).create({
    data: {
      productType: 'food',
      name: { vi: 'Trà đào' },
      slug: { en: 'bun-bo-hue-custom' },
      status: 'draft',
    },
  });
  rows = await slugRows(app, 'catalog-product', p2.documentId);
  assert.deepEqual(
    rows.map(({ locale, slug }) => [locale, slug]),
    [
      ['en', 'bun-bo-hue-custom'],
      ['vi', 'tra-dao'],
    ],
  );

  // Update name only: derived locales follow the new name, explicit slugs stay put.
  await docs(PRODUCT).update({
    documentId: p2.documentId,
    data: { name: { vi: 'Trà đào cam sả' } },
  });
  rows = await slugRows(app, 'catalog-product', p2.documentId);
  assert.deepEqual(
    rows.map(({ locale, slug }) => [locale, slug]),
    [
      ['en', 'bun-bo-hue-custom'],
      ['vi', 'tra-dao-cam-sa'],
    ],
  );

  // Clearing the explicit slug falls back to the localized name.
  await docs(PRODUCT).update({
    documentId: p1.documentId,
    data: { slug: {} },
  });
  rows = await slugRows(app, 'catalog-product', p1.documentId);
  assert.deepEqual(
    rows.map(({ locale, slug }) => [locale, slug]),
    [
      ['en', 'hue-beef-noodle'],
      ['vi', 'bun-bo-hue'],
    ],
  );

  // localized-text validation: unknown locale keys and empty required values are rejected.
  await assert.rejects(
    docs(CATEGORY).create({ data: { name: { fr: 'Catégorie' }, rank: 0 } }),
    (error) => error?.code === 'VALIDATION_ERROR',
  );
  await assert.rejects(
    docs(PRODUCT).create({
      data: { productType: 'food', name: { vi: '   ' }, status: 'draft' },
    }),
    (error) => error?.code === 'VALIDATION_ERROR' && error?.details?.field === 'name',
  );

  // Delete releases the slug; it is immediately reusable.
  await docs(PRODUCT).delete({ documentId: p1.documentId });
  rows = await slugRows(app, 'catalog-product', p1.documentId);
  assert.equal(rows.length, 0, 'delete must release slug rows');
  const p3 = await docs(PRODUCT).create({
    data: {
      productType: 'food',
      name: { vi: 'Bún bò Huế' },
      status: 'draft',
    },
  });
  rows = await slugRows(app, 'catalog-product', p3.documentId);
  assert.deepEqual(
    rows.map(({ locale, slug }) => [locale, slug]),
    [['vi', 'bun-bo-hue']],
  );

  // Categories get the same behavior.
  const cat = await docs(CATEGORY).create({
    data: { name: { vi: 'Món chính', en: 'Mains' }, rank: 0 },
  });
  rows = await slugRows(app, 'catalog-category', cat.documentId);
  assert.deepEqual(
    rows.map(({ locale, slug }) => [locale, slug]),
    [
      ['en', 'mains'],
      ['vi', 'mon-chinh'],
    ],
  );

  console.log('[ordering-test] catalog-slug: create/duplicate/locale/update/release verified');
});
