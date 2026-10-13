// O10 step 6: catalog CSV round-trip over real HTTP — export → dry-run → apply → identical
// export; a bad row fails the whole file; dry-run writes nothing; a catalog change between
// validate and apply answers 409 CATALOG_IMPORT_STALE; 5001 rows is rejected outright.
import assert from 'node:assert/strict';

import { PRODUCT_CSV_HEADERS } from '../../src/plugins/ordering/dist/server/src/services/catalog-csv.js';
import { seedAdminHttpStaff, systemCtx, withApp } from './_harness.mjs';

const PRODUCT = 'plugin::ordering.catalog-product';
const VARIANT = 'plugin::ordering.catalog-variant';
const PRICE = 'plugin::ordering.catalog-price';
const GROUP = 'plugin::ordering.catalog-modifier-group';
const MODIFIER = 'plugin::ordering.catalog-modifier';
const CATEGORY = 'plugin::ordering.catalog-category';

const count = async (app, uid) => app.db.query(uid).count();

const seedCatalog = async (app) => {
  const docs = (uid) => app.documents(uid);
  const food = await docs(CATEGORY).create({
    data: { name: { vi: 'Đồ ăn', en: 'Food' }, slug: { vi: 'do-an' } },
  });
  const mains = await docs(CATEGORY).create({
    data: { name: { vi: 'Món chính', en: 'Mains' }, slug: { vi: 'mon-chinh' }, parent: food.documentId },
  });
  const size = await docs(GROUP).create({
    data: {
      code: 'size',
      name: { vi: 'Kích cỡ', en: 'Size' },
      selectionType: 'single',
      minQuantity: 1,
      maxQuantity: 1,
    },
  });
  await docs(MODIFIER).create({
    data: { code: 'nho', name: { vi: 'Nhỏ', en: 'Small' }, priceDelta: 0, rank: 0, group: size.documentId },
  });
  await docs(MODIFIER).create({
    data: { code: 'lon', name: { vi: 'Lớn', en: 'Large' }, priceDelta: 10000, rank: 1, group: size.documentId },
  });
  const pho = await docs(PRODUCT).create({
    data: {
      name: { vi: 'Phở bò', en: 'Beef pho' },
      slug: { vi: 'pho-bo' },
      description: { vi: 'Nước dùng 8 tiếng', en: 'Eight-hour broth' },
      productType: 'food',
      status: 'active',
      sellOnline: true,
      rank: 1,
      categories: [mains.documentId],
      modifierGroups: [
        { groupRef: size.documentId, required: true, min: 1, max: 1, freeQuantity: 0, rank: 0, overrides: {} },
      ],
    },
  });
  const variant = await docs(VARIANT).create({
    data: { product: pho.documentId, sku: 'PB-01', name: { vi: 'Tô thường', en: 'Regular' }, isDefault: true },
  });
  await docs(PRICE).create({
    data: { variant: variant.documentId, amount: 55000, currency: 'VND', minQuantity: 1 },
  });
  return { food, mains, size, pho, variant };
};

const postCsv = async (base, token, path, csv, contentType = 'text/csv') => {
  const res = await fetch(`${base}/ordering${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: csv,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
};

const getCsv = async (base, token, path) => {
  const res = await fetch(`${base}/ordering${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.text() };
};

withApp(async (app) => {
  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}`;
  const staff = await seedAdminHttpStaff(app, {
    scopes: { quanly: { allLocations: true, locationRefs: [] } },
  });
  const token = await staff.tokenOf('quanly');
  const noCatalog = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { nv: { allLocations: true, locationRefs: [] } },
  });
  const seeded = await seedCatalog(app);

  try {
    // ── Permission gate: catalog.manage (+export) on every route ───────────────────────
    assert.equal((await noCatalog.as.nv('GET', '/catalog/imports')).status, 403, 'imports denied');
    assert.equal((await noCatalog.as.nv('GET', '/catalog/export?kind=products')).status, 403, 'export denied');
    assert.equal(
      (await postCsv(base, await noCatalog.tokenOf('nv'), '/catalog/import?kind=products', 'a,b\n')).status,
      403,
      'import denied',
    );
    assert.equal(
      (await noCatalog.as.nv('POST', '/catalog/import/abc/apply')).status,
      403,
      'apply denied',
    );

    // ── Export → dry-run → apply → byte-identical export ─────────────────────────────
    const productsCsv = (await getCsv(base, token, '/catalog/export?kind=products')).body;
    const modifiersCsv = (await getCsv(base, token, '/catalog/export?kind=modifiers')).body;
    assert.match(productsCsv, /Phở bò/, 'products export carries the seeded dish');
    assert.match(productsCsv, /PB-01/, 'products export carries the variant SKU');
    assert.match(modifiersCsv, /Kích cỡ/, 'modifiers export carries the group');

    const before = {
      products: await count(app, PRODUCT),
      variants: await count(app, VARIANT),
      prices: await count(app, PRICE),
      groups: await count(app, GROUP),
      modifiers: await count(app, MODIFIER),
    };

    const dry = await postCsv(
      base,
      token,
      '/catalog/import?kind=products&dryRun=true&filename=products.csv',
      productsCsv,
    );
    assert.equal(dry.status, 200, JSON.stringify(dry.body));
    assert.equal(dry.body.import.status, 'validated', 'dry run validates the file');
    assert.deepEqual(dry.body.report.errors, [], 'seeded export validates clean');

    // Dry run wrote no catalog rows.
    assert.equal(await count(app, PRODUCT), before.products, 'dry run creates no products');
    assert.equal(await count(app, VARIANT), before.variants, 'dry run creates no variants');
    assert.equal(await count(app, PRICE), before.prices, 'dry run creates no prices');
    assert.equal(await count(app, GROUP), before.groups, 'dry run creates no groups');
    assert.equal(await count(app, MODIFIER), before.modifiers, 'dry run creates no modifiers');

    const applied = await staff.as.quanly('POST', `/catalog/import/${dry.body.import.documentId}/apply`);
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(applied.body.status, 'applied');
    assert.equal(applied.body.report.updated.products, 1, 'round trip updates, never duplicates');
    assert.equal(await count(app, PRODUCT), before.products, 'round trip adds no product');

    const reExport = (await getCsv(base, token, '/catalog/export?kind=products')).body;
    assert.equal(reExport, productsCsv, 'export → import → export is byte-identical');

    // ── modifiers.csv applies via the raw octet-stream body (koa-body skips it) ────────
    const modApply = await postCsv(
      base,
      token,
      '/catalog/import?kind=modifiers&dryRun=false&filename=modifiers.csv',
      modifiersCsv,
      'application/octet-stream',
    );
    assert.equal(modApply.status, 200, JSON.stringify(modApply.body));
    assert.equal(modApply.body.import.status, 'applied', 'octet-stream import applies');
    assert.equal(await count(app, GROUP), before.groups, 'modifier round trip adds no group');

    // ── One bad row fails the file; nothing applies ──────────────────────────────────
    const badCsv = productsCsv.replace('55000', 'không-phải-số');
    assert.notEqual(badCsv, productsCsv, 'fixture mutation landed');
    const bad = await postCsv(base, token, '/catalog/import?kind=products&dryRun=true', badCsv);
    assert.equal(bad.status, 200, JSON.stringify(bad.body));
    assert.equal(bad.body.import.status, 'failed', 'a bad row marks the run failed');
    assert.ok(bad.body.report.errors.length > 0, 'failed run lists row errors');
    const badApply = await staff.as.quanly(
      'POST',
      `/catalog/import/${bad.body.import.documentId}/apply`,
    );
    assert.equal(badApply.status, 400, 'a failed run cannot be applied');

    // ── Stale: catalog moved between validate and apply → 409 ────────────────────────
    const staleDry = await postCsv(base, token, '/catalog/import?kind=products&dryRun=true', productsCsv);
    assert.equal(staleDry.body.import.status, 'validated');
    await app.documents(PRODUCT).update({
      documentId: seeded.pho.documentId,
      data: { rank: 2 },
    });
    const stale = await staff.as.quanly(
      'POST',
      `/catalog/import/${staleDry.body.import.documentId}/apply`,
    );
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.error.code, 'CATALOG_IMPORT_STALE');

    // ── 5001 data rows → CSV_INVALID, no import row (octet-stream carries >256KB files) ──
    const huge = [PRODUCT_CSV_HEADERS.join(','), ...Array.from({ length: 5001 }, (_, i) =>
      `cat,slug-${i},Món ${i},Name ${i},,,food,true,0,,SKU-${i},N,EN,true,1000,`,
    )].join('\n');
    const over = await postCsv(
      base,
      token,
      '/catalog/import?kind=products&dryRun=true',
      huge,
      'application/octet-stream',
    );
    assert.equal(over.status, 400, JSON.stringify(over.body?.error ?? over.body));
    assert.equal(over.body.error.code, 'CSV_INVALID');

    console.log('[ordering-test] catalog-csv: round-trip, dry-run, stale, limits');
  } finally {
    await Promise.all([staff.cleanup(), noCatalog.cleanup()]);
  }
});
