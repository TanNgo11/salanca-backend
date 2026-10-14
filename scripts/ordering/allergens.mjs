import assert from 'node:assert/strict';

process.env.FORM_INTAKE_SHARED_SECRET = 'allergens-test-secret';

import { seedBranches, withApp } from './_harness.mjs';

const docs = (app) => ({
  category: app.documents('plugin::ordering.catalog-category'),
  product: app.documents('plugin::ordering.catalog-product'),
  variant: app.documents('plugin::ordering.catalog-variant'),
  price: app.documents('plugin::ordering.catalog-price'),
});

withApp(async (app) => {
  const d = docs(app);
  await seedBranches(app);

  const bepNong = await d.category.create({
    data: { name: { vi: 'Món nóng' }, kitchenStation: 'Bếp nóng', rank: 0 },
  });
  const monXao = await d.category.create({
    data: { name: { vi: 'Món xào' }, parent: bepNong.documentId, rank: 0 },
  });
  const doUong = await d.category.create({ data: { name: { vi: 'Đồ uống' }, rank: 1 } });

  const mkProduct = (data) =>
    d.product.create({
      data: {
        productType: 'food', status: 'active', sellOnline: true,
        fulfillmentKinds: ['pickup'], ...data,
      },
    });
  const mkVariant = (product, data) =>
    d.variant.create({
      data: { product: product.documentId, isDefault: true, name: { vi: 'Phần thường' }, ...data },
    });
  const mkPrice = (variant, amount) =>
    d.price.create({ data: { variant: variant.documentId, amount, currency: 'VND' } });

  const tom = await mkProduct({
    name: { vi: 'Tôm xào', en: 'Stir-fried shrimp' },
    categories: [monXao.documentId],
    allergens: ['crustacean', 'custom:Tôm khô'],
    dietaryTags: ['gluten-free', 'spicy'],
  });
  const tomStd = await mkVariant(tom, { sku: 'TOM-STD' });
  await mkPrice(tomStd, 90000);

  const rau = await mkProduct({
    name: { vi: 'Rau xào chay', en: 'Vegan greens' },
    categories: [monXao.documentId],
    allergens: [],
    dietaryTags: ['vegan', 'gluten-free'],
  });
  const rauStd = await mkVariant(rau, { sku: 'RAU-STD' });
  await mkPrice(rauStd, 45000);

  const sua = await mkProduct({
    name: { vi: 'Sữa chua' },
    categories: [doUong.documentId],
    allergens: ['milk'],
  });
  const suaStd = await mkVariant(sua, { sku: 'SUA-STD' });
  await mkPrice(suaStd, 20000);

  // Document-service writes run the catalog-integrity middleware — bad codes must fail.
  await assert.rejects(
    d.product.create({
      data: {
        productType: 'food', status: 'active', name: { vi: 'X' },
        allergens: ['shellfish'],
      },
    }),
    (error) => error.code === 'VALIDATION_ERROR' || /unknown code/.test(error.message),
  );
  await assert.rejects(
    d.product.update({ documentId: sua.documentId, data: { dietaryTags: ['keto'] } }),
    (error) => error.code === 'VALIDATION_ERROR' || /unknown code/.test(error.message),
  );
  // kitchenStation trims/bounds; empty normalizes to inherit (null).
  await d.category.update({ documentId: doUong.documentId, data: { kitchenStation: '  Quầy nước  ' } });

  // kitchenStation inheritance: products under monXao resolve the grandparent's station
  // via the sellable metadata (adapter path — same one KDS reads).
  const registry = app.plugin('ordering').service('registry');
  const adapter = registry.catalogAdapter('ordering-catalog');
  const { items: sellables } = await adapter.listSellables(
    { now: new Date().toISOString() },
    { locale: 'vi', limit: 10 },
  );
  const tomSellable = sellables.find((s) => s.ref.uid === tom.documentId);
  assert.equal(tomSellable?.metadata?.catalog?.kitchenStation, 'Bếp nóng');
  const suaSellable = sellables.find((s) => s.ref.uid === sua.documentId);
  assert.equal(suaSellable?.metadata?.catalog?.kitchenStation, 'Quầy nước');

  // Admin categories tree carries the normalized station for the form datalist.
  const categories = app.plugin('ordering').service('catalog-category');
  const tree = await categories.tree('vi');
  const find = (nodes, ref) => {
    for (const node of nodes) {
      if (node.item.ref === ref) return node.item;
      const hit = find(node.children ?? [], ref);
      if (hit) return hit;
    }
    return null;
  };
  assert.equal(find(tree, bepNong.documentId)?.kitchenStation, 'Bếp nóng');
  assert.equal(find(tree, doUong.documentId)?.kitchenStation, 'Quầy nước');
  assert.equal(find(tree, monXao.documentId)?.kitchenStation, null);

  app.config.set('plugin::ordering.catalog.adapter', 'ordering-catalog');
  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}`;
  const get = (path) => fetch(`${base}/api/v1/ordering${path}`);
  const json = async (path) => (await get(path)).json();

  // --- Public product payload ---------------------------------------------------------
  const { items } = await json('/catalog/products?locale=vi');
  const tomItem = items.find((item) => item.id === tom.documentId);
  assert.deepEqual(tomItem.allergens, [
    { code: 'crustacean', label: 'Giáp xác' },
    { code: 'custom:Tôm khô', label: 'Tôm khô' },
  ]);
  assert.deepEqual(tomItem.dietaryTags, [
    { code: 'gluten-free', label: 'Không gluten' },
    { code: 'spicy', label: 'Cay' },
  ]);
  const suaItem = items.find((item) => item.id === sua.documentId);
  assert.deepEqual(suaItem.allergens, [{ code: 'milk', label: 'Sữa' }]);
  assert.deepEqual(suaItem.dietaryTags, []);

  // Detail endpoint labels in English.
  const detail = await json(`/catalog/products/${tom.documentId}?locale=en`);
  assert.deepEqual(detail.item.allergens, [
    { code: 'crustacean', label: 'Crustaceans' },
    { code: 'custom:Tôm khô', label: 'Tôm khô' },
  ]);
  assert.deepEqual(detail.item.dietaryTags, [
    { code: 'gluten-free', label: 'Gluten-free' },
    { code: 'spicy', label: 'Spicy' },
  ]);

  // --- Filters ------------------------------------------------------------------------
  const names = (body) => body.items.map((item) => item.id).sort();
  const all = await json('/catalog/products');
  assert.equal(all.items.length, 3);

  const noMilk = await json('/catalog/products?excludeAllergens=milk');
  assert.deepEqual(names(noMilk), [rau.documentId, tom.documentId].sort());
  const noCrust = await json('/catalog/products?excludeAllergens=crustacean,milk');
  assert.deepEqual(names(noCrust), [rau.documentId]);
  // Custom codes compare case-insensitively.
  const noCustom = await json(`/catalog/products?excludeAllergens=${encodeURIComponent('custom:tôm khô')}`);
  assert.deepEqual(names(noCustom), [rau.documentId, sua.documentId].sort());
  const none = await json('/catalog/products?excludeAllergens=milk,crustacean,custom%3At%C3%B4m%20kh%C3%B4');
  assert.deepEqual(names(none), [rau.documentId]);

  const vegan = await json('/catalog/products?dietary=vegan');
  assert.deepEqual(names(vegan), [rau.documentId]);
  const gf = await json('/catalog/products?dietary=gluten-free');
  assert.deepEqual(names(gf), [rau.documentId, tom.documentId].sort());
  // Multiple dietary tags are AND-ed.
  const veganGf = await json('/catalog/products?dietary=vegan,gluten-free');
  assert.deepEqual(names(veganGf), [rau.documentId]);
  const combined = await json('/catalog/products?dietary=gluten-free&excludeAllergens=crustacean');
  assert.deepEqual(names(combined), [rau.documentId]);

  console.log('[ordering-test] allergens: payload, labels, filters, station inheritance, validation verified');
});
