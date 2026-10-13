import assert from 'node:assert/strict';

// TRUST_PROXY lets the script pin a client IP per request (rate-limit test);
// the small limit exercises the 429 path without hundreds of requests.
process.env.TRUST_PROXY = 'true';
process.env.ORDERING_CATALOG_RATE_LIMIT_MAX = '3';
// Trusted visitor-IP forwarding (plugin clientIp config, mapped from FORM_INTAKE_SHARED_SECRET).
process.env.FORM_INTAKE_SHARED_SECRET = 'catalog-api-test-secret';

import { seedBranches, withApp } from './_harness.mjs';

const docs = (app) => ({
  category: app.documents('plugin::ordering.catalog-category'),
  product: app.documents('plugin::ordering.catalog-product'),
  variant: app.documents('plugin::ordering.catalog-variant'),
  price: app.documents('plugin::ordering.catalog-price'),
  group: app.documents('plugin::ordering.catalog-modifier-group'),
  modifier: app.documents('plugin::ordering.catalog-modifier'),
  state: app.db.query('plugin::ordering.catalog-location-state'),
});

const FORBIDDEN_KEYS = new Set([
  'rank', 'metadata', 'availabilityInput', 'documentId', 'parentRef', 'isInternal', 'isActive',
]);

const walkKeys = (value, visit) => {
  if (Array.isArray(value)) {
    value.forEach((item) => walkKeys(item, visit));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      visit(key);
      walkKeys(child, visit);
    }
  }
};

withApp(async (app) => {
  const d = docs(app);
  await seedBranches(app);

  const monChinh = await d.category.create({
    data: { name: { vi: 'Món chính', en: 'Mains' }, rank: 0 },
  });
  const monHue = await d.category.create({
    data: { name: { vi: 'Món Huế' }, parent: monChinh.documentId, rank: 0 },
  });
  const doUong = await d.category.create({ data: { name: { vi: 'Đồ uống' }, rank: 1 } });
  await d.category.create({
    data: { name: { vi: 'Nội bộ' }, isInternal: true, parent: monChinh.documentId, rank: 1 },
  });

  const mkProduct = (data) =>
    d.product.create({
      data: {
        productType: 'food', status: 'active', sellOnline: true,
        fulfillmentKinds: ['pickup', 'delivery'], ...data,
      },
    });
  const mkVariant = (product, data) =>
    d.variant.create({ data: { product: product.documentId, isDefault: false, rank: 0, ...data } });
  const mkPrice = (variant, amount) =>
    d.price.create({ data: { variant: variant.documentId, amount, currency: 'VND' } });

  const bunBo = await mkProduct({
    name: { vi: 'Bún bò Huế', en: 'Hue beef noodle' },
    categories: [monChinh.documentId, monHue.documentId],
    // O12: allergen/dietary codes round-trip through the public product payload.
    allergens: ['fish', 'custom:Sate'],
    dietaryTags: ['spicy'],
  });
  const bbStd = await mkVariant(bunBo, { sku: 'BB-STD', name: { vi: 'Tô thường' }, isDefault: true });
  const bbDb = await mkVariant(bunBo, { sku: 'BB-DB', name: { vi: 'Tô đặc biệt' }, rank: 1 });
  await mkPrice(bbStd, 65000);
  await mkPrice(bbDb, 85000);

  const traDao = await mkProduct({ name: { vi: 'Trà đào cam sả' }, categories: [doUong.documentId] });
  const tdStd = await mkVariant(traDao, { sku: 'TD-STD', name: { vi: 'Ly thường' }, isDefault: true });
  await mkPrice(tdStd, 45000);

  const lauThai = await d.product.create({
    data: {
      productType: 'food', status: 'draft', sellOnline: false, name: { vi: 'Lẩu Thái' },
      fulfillmentKinds: [],
    },
  });

  const topping = await d.group.create({
    data: { name: { vi: 'Topping' }, selectionType: 'multiple', rank: 0 },
  });
  await d.modifier.create({
    data: { name: { vi: 'Chả cua' }, priceDelta: 15000, group: topping.documentId, rank: 0 },
  });
  const gioHeo = await d.modifier.create({
    data: { name: { vi: 'Giò heo' }, priceDelta: 20000, group: topping.documentId, rank: 1 },
  });
  await d.product.update({
    documentId: bunBo.documentId,
    data: {
      modifierGroups: [
        {
          groupRef: topping.documentId, required: false, min: 0, max: 3,
          freeQuantity: 0, rank: 0, overrides: { [gioHeo.documentId]: { priceDelta: 25000 } },
        },
      ],
    },
  });

  // The public routes read the adapter from config; ORDERING_TEST_BUILTINS points it at the
  // in-memory test catalog — put the real one back for these HTTP assertions.
  app.config.set('plugin::ordering.catalog.adapter', 'ordering-catalog');

  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}`;
  // Each normal assertion sends a distinct forwarded IP — the rate limit is per-IP and the
  // test caps it at 3, so sharing one IP would throttle the assertions themselves.
  let requestIp = 0;
  const get = (path, headers) =>
    fetch(`${base}/api/v1/ordering${path}`, {
      headers: { 'x-forwarded-for': `10.99.${requestIp++ >> 8}.${requestIp % 256}`, ...headers },
    });

  // --- Product list ---------------------------------------------------------------------
  const list = await get('/catalog/products?locale=vi&location=Q1');
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'public, max-age=30');
  const listBody = await list.json();
  const names = listBody.items.map((item) => item.name);
  assert.ok(names.includes('Bún bò Huế') && names.includes('Trà đào cam sả'));
  assert.ok(!names.includes('Lẩu Thái'), 'draft/not-online product must not be listed');
  const seenKeys = [];
  walkKeys(listBody, (key) => seenKeys.push(key));
  for (const key of FORBIDDEN_KEYS) assert.ok(!seenKeys.includes(key), `internal key leaked: ${key}`);

  // Category filter accepts the public slug.
  const mains = await (await get('/catalog/products?locale=vi&category=mon-chinh&location=Q1')).json();
  assert.deepEqual(mains.items.map((item) => item.slug), ['bun-bo-hue']);

  // Cursor pagination.
  const page1 = await (await get('/catalog/products?locale=vi&limit=1')).json();
  assert.ok(page1.nextCursor, 'first page must emit nextCursor');
  const page2 = await (await get(`/catalog/products?locale=vi&limit=1&cursor=${page1.nextCursor}`)).json();
  assert.notDeepEqual(page2.items.map((i) => i.id), page1.items.map((i) => i.id));

  // --- Product detail -------------------------------------------------------------------
  const detail = await get('/catalog/products/bun-bo-hue?locale=vi&location=Q1');
  assert.equal(detail.status, 200);
  const { item } = await detail.json();
  assert.equal(item.slug, 'bun-bo-hue');
  assert.equal(item.name, 'Bún bò Huế');
  assert.equal(item.price, 65000);
  assert.equal(item.available, true);
  assert.deepEqual(item.categories, ['Món chính', 'Món Huế']);
  assert.equal(item.variants.length, 2);
  assert.deepEqual(
    item.variants.map((v) => [v.name, v.price]),
    [['Tô thường', 65000], ['Tô đặc biệt', 85000]],
  );
  const gioChoice = item.options[0].choices.find((c) => c.name === 'Giò heo');
  assert.equal(gioChoice.price, 25000, 'per-product override must reach the public API');
  // O12: codes + localized labels; `custom:` labels are the stored name.
  assert.deepEqual(item.allergens, [
    { code: 'fish', label: 'Cá' },
    { code: 'custom:Sate', label: 'Sate' },
  ]);
  assert.deepEqual(item.dietaryTags, [{ code: 'spicy', label: 'Cay' }]);

  // O12: excludeAllergens drops matching products; dietary keeps only tagged ones.
  const noFish = await (await get('/catalog/products?excludeAllergens=fish')).json();
  assert.ok(!noFish.items.some((i) => i.id === bunBo.documentId));
  const onlySpicy = await (await get('/catalog/products?dietary=spicy')).json();
  assert.deepEqual(onlySpicy.items.map((i) => i.id), [bunBo.documentId]);

  // Slug resolution honours the requested locale; drafts are invisible.
  const enDetail = await (await get(`/catalog/products/${bunBo.documentId}?locale=en`)).json();
  assert.equal(enDetail.item.name, 'Hue beef noodle');
  assert.equal((await get(`/catalog/products/${lauThai.documentId}`)).status, 404);
  assert.equal((await get('/catalog/products/khong-ton-tai')).status, 404);

  // Locale fallback: Trà đào has no EN name → vi.
  const enFallback = await (await get(`/catalog/products/${traDao.documentId}?locale=en`)).json();
  assert.equal(enFallback.item.name, 'Trà đào cam sả');

  // --- Categories tree ------------------------------------------------------------------
  const cats = await get('/catalog/categories?locale=vi');
  assert.equal(cats.status, 200);
  assert.equal(cats.headers.get('cache-control'), 'public, max-age=30');
  const catBody = await cats.json();
  const root = catBody.items.find((c) => c.name === 'Món chính');
  assert.ok(root && root.slug === 'mon-chinh');
  assert.ok(root.children.some((c) => c.name === 'Món Huế'));
  assert.ok(!root.children.some((c) => c.name === 'Nội bộ'), 'internal category must not leak');
  const catKeys = [];
  walkKeys(catBody, (key) => catKeys.push(key));
  for (const key of FORBIDDEN_KEYS) assert.ok(!catKeys.includes(key), `internal key leaked: ${key}`);

  // --- Per-location availability ---------------------------------------------------------
  await d.state.create({
    data: {
      entityType: 'product', entityDocumentId: bunBo.documentId, locationRef: 'Q1', selling: false,
    },
  });
  const atQ1 = await (await get('/catalog/products/bun-bo-hue?location=Q1')).json();
  assert.equal(atQ1.item.available, false, 'tạm hết at Q1 must flip available');
  assert.ok(atQ1.item.reasons.includes('temporarily-unavailable'));
  const atQ3 = await (await get('/catalog/products/bun-bo-hue?location=Q3')).json();
  assert.equal(atQ3.item.available, true, 'Q1 toggle must not leak into Q3');
  await d.state.delete({
    where: { entityDocumentId: bunBo.documentId, locationRef: 'Q1' },
  });

  // --- Rate limit (ORDERING_CATALOG_RATE_LIMIT_MAX=3, unique forwarded IP) ----------------
  const ip = { 'x-forwarded-for': '203.0.113.9' };
  for (const expected of [200, 200, 200, 429]) {
    const res = await get('/catalog/categories', ip);
    assert.equal(res.status, expected, `rate-limit sequence expected ${expected}`);
    if (expected === 429) assert.ok(res.headers.get('retry-after'));
  }

  // --- Trusted forwarding: one socket IP, two visitors -> two buckets -------------------
  // Same x-forwarded-for for every call (one "web server"); the visitor IP rides in
  // x-salanca-visitor-ip and only counts when the shared secret matches.
  const web = { 'x-forwarded-for': '198.51.100.7' };
  const visitor = (ipAddress, secret = 'catalog-api-test-secret') => ({
    ...web,
    'x-salanca-intake-secret': secret,
    'x-salanca-visitor-ip': ipAddress,
  });
  for (const expected of [200, 200, 200, 429]) {
    assert.equal((await get('/catalog/categories', visitor('192.0.2.10'))).status, expected);
  }
  assert.equal(
    (await get('/catalog/categories', visitor('192.0.2.11'))).status,
    200,
    'a second visitor behind the same web server gets its own bucket',
  );
  // A wrong secret falls back to the socket IP (the web server's bucket), never an error.
  for (const expected of [200, 200, 200, 429]) {
    assert.equal(
      (await get('/catalog/categories', visitor('192.0.2.12', 'wrong'))).status,
      expected,
    );
  }

  console.log('[ordering-test] catalog-api: public routes, sanitization, availability, rate limit, trusted client IP verified');
});
