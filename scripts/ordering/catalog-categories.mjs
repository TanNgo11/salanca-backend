import assert from 'node:assert/strict';

import { seedBranches, services, systemCtx, withApp } from './_harness.mjs';

const docs = (app) => ({
  category: app.documents('plugin::ordering.catalog-category'),
  product: app.documents('plugin::ordering.catalog-product'),
  variant: app.documents('plugin::ordering.catalog-variant'),
  price: app.documents('plugin::ordering.catalog-price'),
});

/** Flatten the admin tree into [ref, depth, name, productCount] rows for assertions. */
const flatten = (nodes, depth = 0) =>
  nodes.flatMap((node) => [
    { ref: node.item.ref, depth, name: node.item.name, productCount: node.item.productCount },
    ...flatten(node.children, depth + 1),
  ]);

withApp(async (app) => {
  const d = docs(app);
  await seedBranches(app);
  const svc = app.plugin('ordering').service('catalog-category');
  const changeLog = services(app).changeLog;

  // --- Seed: two roots, a child, products -----------------------------------------------
  const monChinh = await svc.create(
    { name: { vi: 'Món chính', en: 'Mains' }, parent: null },
    systemCtx,
  );
  const monHue = await svc.create(
    { name: { vi: 'Món Huế' }, parent: monChinh.documentId },
    systemCtx,
  );
  const com = await svc.create({ name: { vi: 'Cơm' }, parent: monChinh.documentId }, systemCtx);
  const doUong = await svc.create({ name: { vi: 'Đồ uống' }, parent: null }, systemCtx);

  const mkProduct = (data) =>
    d.product.create({
      data: {
        productType: 'food', status: 'active', sellOnline: true,
        fulfillmentKinds: ['pickup'], ...data,
      },
    });
  const traDao = await mkProduct({ name: { vi: 'Trà đào' }, categories: [doUong.documentId] });
  const nuocSam = await mkProduct({ name: { vi: 'Nước sâm' }, categories: [doUong.documentId] });
  const caPhe = await mkProduct({
    name: { vi: 'Cà phê' },
    categories: [doUong.documentId, monChinh.documentId],
  });

  // --- Tree ------------------------------------------------------------------------------
  let tree = await svc.tree('vi');
  const flat = flatten(tree);
  assert.deepEqual(
    flat.map((row) => [row.name, row.depth]),
    [['Món chính', 0], ['Món Huế', 1], ['Cơm', 1], ['Đồ uống', 0]],
  );
  const drinks = flat.find((row) => row.name === 'Đồ uống');
  assert.equal(drinks.productCount, 3, 'product count rides the tree');

  // --- Move: reorder + reparent in one transaction ---------------------------------------
  // Cơm before Món Huế inside the same parent.
  await svc.move(com.documentId, { index: 0 }, systemCtx);
  tree = await svc.tree();
  let mains = tree.find((node) => node.item.name === 'Món chính');
  assert.deepEqual(
    mains.children.map((node) => node.item.name),
    ['Cơm', 'Món Huế'],
    'move index=0 reorders siblings',
  );

  // Reparent Đồ uống under Món Huế, appended last.
  await svc.move(doUong.documentId, { parentId: monHue.documentId }, systemCtx);
  tree = await svc.tree();
  mains = tree.find((node) => node.item.name === 'Món chính');
  const hue = mains.children.find((node) => node.item.name === 'Món Huế');
  assert.equal(hue.children[0].item.name, 'Đồ uống');
  assert.equal(tree.length, 1, 'only one root remains after reparenting');

  // Ranks normalized: siblings are dense 0..n-1.
  const allCats = await app.db
    .query('plugin::ordering.catalog-category')
    .findMany({ populate: { parent: true } });
  const siblingRanksOf = (parentId) =>
    allCats
      .filter((row) => (row.parent?.documentId ?? null) === parentId)
      .sort((a, b) => a.rank - b.rank)
      .map((row) => row.rank);
  assert.deepEqual(siblingRanksOf(monHue.documentId), [0], 'new parent ranks dense');
  assert.deepEqual(siblingRanksOf(null), [0], 'root ranks dense after move');

  // --- Cycle prevention ------------------------------------------------------------------
  await assert.rejects(
    svc.move(monChinh.documentId, { parentId: monHue.documentId }, systemCtx),
    (error) => error?.code === 'CATEGORY_MOVE_CYCLE',
  );
  await assert.rejects(
    svc.move(monChinh.documentId, { parentId: monChinh.documentId }, systemCtx),
    (error) => error?.code === 'CATEGORY_MOVE_CYCLE',
  );
  await assert.rejects(
    svc.move(monHue.documentId, { parentId: doUong.documentId }, systemCtx),
    (error) => error?.code === 'CATEGORY_MOVE_CYCLE',
    'moving under a descendant must cycle',
  );

  // --- Delete guards ----------------------------------------------------------------------
  // Món chính still has children → blocked.
  await assert.rejects(
    svc.remove(monChinh.documentId, {}, systemCtx),
    (error) => error?.code === 'CATEGORY_HAS_CHILDREN',
  );

  // Đồ uống has 3 products → requires confirm.
  let blocked = null;
  try {
    await svc.remove(doUong.documentId, {}, systemCtx);
  } catch (error) {
    blocked = error;
  }
  assert.equal(blocked?.code, 'CATEGORY_HAS_PRODUCTS');
  assert.equal(blocked.details.productCount, 3);
  assert.ok(
    blocked.details.products.some((p) => p.name === 'Trà đào'),
    'guard reports linked product names',
  );

  // Confirmed: products are unlinked, not deleted; orphans are reported.
  const result = await svc.remove(doUong.documentId, { confirm: true }, systemCtx);
  assert.equal(result.deleted, true);
  assert.equal(result.unlinkedProducts.length, 3);
  assert.deepEqual(
    result.productsWithoutCategory.map((p) => p.name).sort(),
    ['Nước sâm', 'Trà đào'].sort(),
    'Cà phê keeps Món chính — only the other two are orphaned',
  );
  const traDaoAfter = await d.product.findOne({ documentId: traDao.documentId });
  assert.ok(traDaoAfter, 'product row survives the category delete');
  const traDaoCats = await app.db
    .query('plugin::ordering.catalog-product')
    .findOne({
      where: { documentId: traDao.documentId },
      populate: { categories: { select: ['documentId'] } },
    });
  assert.equal(traDaoCats.categories.length, 0, 'links removed on confirmed delete');
  const caPheCats = await app.db
    .query('plugin::ordering.catalog-product')
    .findOne({
      where: { documentId: caPhe.documentId },
      populate: { categories: { select: ['documentId'] } },
    });
  assert.equal(caPheCats.categories.length, 1, 'other category links are untouched');

  // Slug rows release with the category.
  const leftoverSlugs = await app.db
    .query('plugin::ordering.catalog-slug')
    .findMany({ where: { entityType: 'catalog-category', entityDocumentId: doUong.documentId } });
  assert.equal(leftoverSlugs.length, 0, 'category slugs released on delete');

  // --- Change log -------------------------------------------------------------------------
  const logs = await changeLog.list({ entityType: 'catalog-category', limit: 50 });
  const actions = logs.map((row) => row.action);
  for (const expected of [
    'catalog-category.create',
    'catalog-category.move',
    'catalog-category.delete',
  ]) {
    assert.ok(actions.includes(expected), `change-log records ${expected}`);
  }
  const actorKinds = new Set(logs.map((row) => row.actorRef));
  assert.ok(actorKinds.has('system'), 'system actor recorded');

  // --- Admin route is mounted + guarded (no token → 401) -----------------------------------
  await app.listen();
  // Plugin admin routers mount at `/<plugin>` (like `/content-manager/...`), not under /admin.
  const res = await fetch(`http://127.0.0.1:${process.env.PORT}/ordering/categories`);
  assert.equal(res.status, 401, 'unauthenticated admin call must be rejected');

  console.log('[ordering-test] catalog-categories: tree, move, cycle guard, delete rules, audit verified');
});
