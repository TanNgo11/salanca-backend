import assert from 'node:assert/strict';

import { withApp } from './_harness.mjs';

const PRODUCT = 'plugin::ordering.catalog-product';
const GROUP = 'plugin::ordering.catalog-modifier-group';
const MODIFIER = 'plugin::ordering.catalog-modifier';
const VARIANT = 'plugin::ordering.catalog-variant';

withApp(async (app) => {
  const docs = (uid) => app.documents(uid);

  // Seed a topping library group with two modifiers and one variant for bundle items.
  const group = await docs(GROUP).create({
    data: { name: { vi: 'Topping' }, selectionType: 'multiple', rank: 0 },
  });
  const gioHeo = await docs(MODIFIER).create({
    data: { name: { vi: 'Giò heo' }, priceDelta: 20000, group: group.documentId, rank: 0 },
  });
  const chaLua = await docs(MODIFIER).create({
    data: { name: { vi: 'Chả lụa' }, priceDelta: 15000, group: group.documentId, rank: 1 },
  });
  const otherGroup = await docs(GROUP).create({
    data: { name: { vi: 'Sốt' }, selectionType: 'multiple', rank: 1 },
  });
  const outsider = await docs(MODIFIER).create({
    data: { name: { vi: 'Sốt đặc biệt' }, priceDelta: 5000, group: otherGroup.documentId, rank: 0 },
  });
  const baseProduct = await docs(PRODUCT).create({
    data: { productType: 'food', name: { vi: 'Bún bò' }, status: 'active', sellOnline: true },
  });
  const variant = await docs(VARIANT).create({
    data: { product: baseProduct.documentId, sku: 'BB-STD', name: { vi: 'Tô thường' }, isDefault: true },
  });

  const createWith = (extra) =>
    docs(PRODUCT).create({
      data: {
        productType: 'food',
        name: { vi: `Món ${Math.random().toString(36).slice(2, 8)}` },
        status: 'draft',
        ...extra,
      },
    });

  // Happy path: attach the group with a price override on a member modifier.
  const ok = await createWith({
    modifierGroups: [
      {
        groupRef: group.documentId,
        required: false,
        min: 0,
        max: 0,
        freeQuantity: 0,
        rank: 0,
        overrides: { [gioHeo.documentId]: { priceDelta: 25000 } },
      },
    ],
    bundleSlots: [
      {
        key: 'main',
        name: { vi: 'Món chính' },
        selection: 'single',
        required: true,
        min: 1,
        max: 1,
        rank: 0,
        items: [{ variantRef: variant.documentId, quantity: 1, isDefault: true, priceDelta: 0 }],
      },
    ],
  });
  assert.ok(ok.documentId, 'valid modifierGroups + bundleSlots must save');
  assert.equal(ok.modifierGroups[0].overrides[gioHeo.documentId].priceDelta, 25000);
  void chaLua;

  // min > max rejected.
  await assert.rejects(
    createWith({
      modifierGroups: [
        {
          groupRef: group.documentId, required: false, min: 3, max: 2,
          freeQuantity: 0, rank: 0, overrides: {},
        },
      ],
    }),
    (error) => error?.code === 'VALIDATION_ERROR',
  );

  // Unknown group rejected.
  await assert.rejects(
    createWith({
      modifierGroups: [
        {
          groupRef: 'does-not-exist', required: false, min: 0, max: 0,
          freeQuantity: 0, rank: 0, overrides: {},
        },
      ],
    }),
    (error) =>
      error?.code === 'VALIDATION_ERROR' &&
      String(error?.message).includes('modifier group'),
  );

  // Override on a modifier outside the group rejected.
  await assert.rejects(
    createWith({
      modifierGroups: [
        {
          groupRef: group.documentId, required: false, min: 0, max: 0,
          freeQuantity: 0, rank: 0, overrides: { [outsider.documentId]: { hidden: true } },
        },
      ],
    }),
    (error) =>
      error?.code === 'VALIDATION_ERROR' &&
      String(error?.message).includes('outside the group'),
  );

  // Unknown variant ref rejected.
  await assert.rejects(
    createWith({
      bundleSlots: [
        {
          key: 'main', name: {}, selection: 'single', required: true, min: 1, max: 1,
          rank: 0,
          items: [{ variantRef: 'missing-variant', quantity: 1, isDefault: true, priceDelta: 0 }],
        },
      ],
    }),
    (error) =>
      error?.code === 'VALIDATION_ERROR' &&
      String(error?.message).includes('variant'),
  );

  // Malformed structure (missing keys / wrong types) rejected.
  await assert.rejects(
    createWith({ modifierGroups: [{ groupRef: group.documentId }] }),
    (error) => error?.code === 'VALIDATION_ERROR',
  );
  await assert.rejects(
    createWith({ bundleSlots: 'not-an-array' }),
    (error) => error?.code === 'VALIDATION_ERROR',
  );

  // Single-choice slot with max > 1 rejected.
  await assert.rejects(
    createWith({
      bundleSlots: [
        {
          key: 'x', name: {}, selection: 'single', required: false, min: 0, max: 3,
          rank: 0, items: [],
        },
      ],
    }),
    (error) => error?.code === 'VALIDATION_ERROR',
  );

  // Update path enforces the same rules.
  await assert.rejects(
    docs(PRODUCT).update({
      documentId: ok.documentId,
      data: { bundleSlots: [{ key: 'x', selection: 'nope' }] },
    }),
    (error) => error?.code === 'VALIDATION_ERROR',
  );

  // Step 11: Document Service writes append admin-change-log rows (system actor here;
  // admin actors come from the request context in real CM edits). Rejected writes don't log.
  await docs(PRODUCT).update({ documentId: ok.documentId, data: { rank: 3 } });
  const logs = await app.db
    .query('plugin::ordering.admin-change-log')
    .findMany({ where: { entityType: 'catalog-product', entityId: ok.documentId } });
  const actions = logs.map((row) => row.action);
  assert.deepEqual(
    actions.sort(),
    ['catalog-product.create', 'catalog-product.update'],
    'create + update are change-logged, the rejected update is not',
  );
  assert.ok(
    logs.every((row) => row.actorRef === 'system'),
    'service-context writes log with the system actor',
  );

  console.log('[ordering-test] catalog-json: modifierGroups/bundleSlots structure + refs + change-log verified');
});
