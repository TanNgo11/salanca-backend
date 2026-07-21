import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compileStrapi, createStrapi } = require('@strapi/core');

const suffix = `${Date.now()}-${process.pid}`;
const created = [];
const appContext = await compileStrapi();
const app = await createStrapi(appContext).load();

async function create(uid, data) {
  const document = await app.documents(uid).create({ data });
  created.unshift([uid, document.documentId]);
  return document;
}

try {
  const category = await create('api::menu-category.menu-category', {
    name: `Phase 2 smoke category ${suffix}`,
    slug: `phase-2-smoke-category-${suffix}`,
    displayOrder: 9999,
    isActive: false,
  });
  const publishedCategory = await app.documents('api::menu-category.menu-category').publish({
    documentId: category.documentId,
  });
  assert.equal(publishedCategory.entries.length, 1);

  const item = await create('api::menu-item.menu-item', {
    name: `Phase 2 smoke item ${suffix}`,
    slug: `phase-2-smoke-item-${suffix}`,
    price: 125000,
    category: category.documentId,
    displayOrder: 9999,
    isFeatured: false,
    isActive: false,
  });

  const updatedItem = await app.documents('api::menu-item.menu-item').update({
    documentId: item.documentId,
    data: { price: 135000 },
    populate: ['category'],
  });
  assert.equal(Number(updatedItem.price), 135000);
  assert.equal(updatedItem.category.documentId, category.documentId);
  const publishedItem = await app.documents('api::menu-item.menu-item').publish({
    documentId: item.documentId,
  });
  assert.equal(publishedItem.entries.length, 1);
  const unpublishedItem = await app.documents('api::menu-item.menu-item').unpublish({
    documentId: item.documentId,
  });
  assert.equal(unpublishedItem.entries.length, 1);

  await assert.rejects(
    app.documents('api::menu-item.menu-item').update({
      documentId: item.documentId,
      data: { category: null },
    }),
    /cannot be saved without a menu category/,
  );

  await assert.rejects(
    app.documents('api::menu-category.menu-category').delete({
      documentId: category.documentId,
    }),
    /Cannot delete this menu category/,
  );
  const itemAfterBlockedCategoryDelete = await app.documents('api::menu-item.menu-item').findOne({
    documentId: item.documentId,
    populate: ['category'],
  });
  assert.equal(itemAfterBlockedCategoryDelete.category.documentId, category.documentId);

  const campaign = await create('api::campaign.campaign', {
    kind: 'event',
    title: `Phase 2 smoke campaign ${suffix}`,
    slug: `phase-2-smoke-campaign-${suffix}`,
    displayOrder: 9999,
    isFeatured: false,
  });
  assert.equal(campaign.kind, 'event');

  console.log('CRUD smoke passed: create, update, required relation, publish, unpublish, protected category delete, and fixture cleanup on PostgreSQL.');
} finally {
  for (const [uid, documentId] of created) {
    await app.documents(uid).delete({ documentId });
  }
  for (const [uid, documentId] of created) {
    assert.equal(
      await app.db.query(uid).count({ where: { documentId } }),
      0,
      `cleanup left ${uid} fixture ${documentId} in PostgreSQL`,
    );
  }
  await app.destroy();
}
