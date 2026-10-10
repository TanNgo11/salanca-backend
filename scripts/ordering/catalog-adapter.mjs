import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  basicOrderInput,
  seedBranches,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const docs = (app) => ({
  category: app.documents('plugin::ordering.catalog-category'),
  product: app.documents('plugin::ordering.catalog-product'),
  variant: app.documents('plugin::ordering.catalog-variant'),
  price: app.documents('plugin::ordering.catalog-price'),
  group: app.documents('plugin::ordering.catalog-modifier-group'),
  modifier: app.documents('plugin::ordering.catalog-modifier'),
  state: app.db.query('plugin::ordering.catalog-location-state'),
});

const adapterCtx = { now: '2026-10-10T10:00:00.000Z', locationRef: 'Q1' };
const uidOf = {
  group: (ref) => `mg:${ref}`,
  option: (ref) => `mod:${ref}`,
  slot: (key) => `slot:${key}`,
  item: (ref) => `item:${ref}`,
};

withApp(async (app) => {
  const d = docs(app);
  const { order } = services(app);
  await seedBranches(app);

  // --- Seed the mockup catalog ----------------------------------------------------------
  const monChinh = await d.category.create({ data: { name: { vi: 'Món chính', en: 'Mains' }, rank: 0 } });
  const monHue = await d.category.create({
    data: { name: { vi: 'Món Huế' }, parent: monChinh.documentId, rank: 0 },
  });
  const doUong = await d.category.create({ data: { name: { vi: 'Đồ uống' }, rank: 1 } });
  const combo = await d.category.create({ data: { name: { vi: 'Combo' }, rank: 2 } });
  const noiBo = await d.category.create({
    data: { name: { vi: 'Nội bộ: Món test' }, isInternal: true, rank: 3 },
  });
  void noiBo;

  const mkProduct = async (data) =>
    d.product.create({
      data: { productType: 'food', status: 'active', sellOnline: true, fulfillmentKinds: ['pickup', 'delivery'], ...data },
    });
  const mkVariant = async (product, data) =>
    d.variant.create({ data: { product: product.documentId, isDefault: false, rank: 0, ...data } });
  const mkPrice = async (variant, amount) =>
    d.price.create({ data: { variant: variant.documentId, amount, currency: 'VND' } });

  const bunBo = await mkProduct({
    name: { vi: 'Bún bò Huế', en: 'Hue beef noodle' },
    categories: [monChinh.documentId, monHue.documentId],
  });
  const bbStd = await mkVariant(bunBo, { sku: 'BB-STD', name: { vi: 'Tô thường' }, isDefault: true });
  const bbDb = await mkVariant(bunBo, { sku: 'BB-DB', name: { vi: 'Tô đặc biệt' }, rank: 1 });
  await mkPrice(bbStd, 65000);
  await mkPrice(bbDb, 85000);

  const traDao = await mkProduct({ name: { vi: 'Trà đào cam sả' }, categories: [doUong.documentId] });
  const tdStd = await mkVariant(traDao, { sku: 'TD-STD', name: { vi: 'Ly thường' }, isDefault: true });
  await mkPrice(tdStd, 45000);

  const comGa = await mkProduct({ name: { vi: 'Cơm gà xối mỡ' }, categories: [monChinh.documentId] });
  const cgStd = await mkVariant(comGa, { sku: 'CG-STD', name: { vi: 'Phần thường' }, isDefault: true });
  await mkPrice(cgStd, 55000);

  const traDa = await mkProduct({ name: { vi: 'Trà đá' }, categories: [doUong.documentId] });
  const traDaStd = await mkVariant(traDa, { sku: 'TRA-DA', name: { vi: 'Ly' }, isDefault: true });
  await mkPrice(traDaStd, 5000);

  await mkProduct({ name: { vi: 'Lẩu Thái' }, status: 'draft', sellOnline: false });

  // Topping library + attach to Bún bò with a per-product price override (Giò heo 20k → 25k).
  const topping = await d.group.create({
    data: { name: { vi: 'Topping' }, selectionType: 'multiple', rank: 0 },
  });
  const chaCua = await d.modifier.create({
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

  // Combo trưa 1 người 99.000đ — main slot + drink slot with priced alternatives.
  const comboTrua = await mkProduct({
    name: { vi: 'Combo trưa 1 người' },
    categories: [combo.documentId],
    bundleSlots: [
      {
        key: 'main', name: { vi: 'Món chính' }, selection: 'single', required: true,
        min: 1, max: 1, rank: 0,
        items: [
          { variantRef: bbStd.documentId, quantity: 1, isDefault: true, priceDelta: 0 },
          { variantRef: cgStd.documentId, quantity: 1, isDefault: false, priceDelta: 0 },
          { variantRef: bbDb.documentId, quantity: 1, isDefault: false, priceDelta: 20000 },
        ],
      },
      {
        key: 'drink', name: { vi: 'Đồ uống' }, selection: 'single', required: true,
        min: 1, max: 1, rank: 1,
        items: [
          { variantRef: traDaStd.documentId, quantity: 1, isDefault: true, priceDelta: 0 },
          { variantRef: tdStd.documentId, quantity: 1, isDefault: false, priceDelta: 15000 },
        ],
      },
    ],
  });
  const comboStd = await mkVariant(comboTrua, { sku: 'COMBO-TRUA', name: { vi: 'Combo' }, isDefault: true });
  await mkPrice(comboStd, 99000);

  // --- Adapter reads ---------------------------------------------------------------------
  const adapter = app.plugin('ordering').service('registry').catalogAdapter('ordering-catalog');
  const ctx = adapterCtx;

  const sellable = await adapter.getSellable(ctx, { uid: bunBo.documentId }, { locale: 'vi' });
  assert.equal(sellable.title, 'Bún bò Huế');
  assert.equal(sellable.listPrice.amount, 65000);
  assert.equal(sellable.variant.sku, 'BB-STD');
  assert.equal(sellable.purchasable, true);
  const toppingGroup = sellable.options.find((group) => group.uid === uidOf.group(topping.documentId));
  assert.ok(toppingGroup, 'modifier group maps to an OptionGroup');
  const gioOption = toppingGroup.options.find((opt) => opt.uid === uidOf.option(gioHeo.documentId));
  assert.equal(gioOption.unitPriceDelta.amount, 25000, 'product override wins over library price');
  assert.equal(
    toppingGroup.options.find((opt) => opt.uid === uidOf.option(chaCua.documentId)).unitPriceDelta.amount,
    15000,
  );

  // Slug-based resolution (what a storefront line sends).
  const bySlug = await adapter.getSellable(ctx, { uid: 'bun-bo-hue' }, { locale: 'vi' });
  assert.equal(bySlug?.ref.uid, bunBo.documentId);

  // English fallback: Trà đào has no EN name → falls back to vi.
  const enSellable = await adapter.getSellable(ctx, { uid: traDao.documentId }, { locale: 'en' });
  assert.equal(enSellable.title, 'Trà đào cam sả');

  // Combo: slots become option groups; metadata carries normalized components.
  const comboSellable = await adapter.getSellable(ctx, { uid: comboTrua.documentId }, { locale: 'vi' });
  const mainSlot = comboSellable.options.find((group) => group.uid === uidOf.slot('main'));
  const drinkSlot = comboSellable.options.find((group) => group.uid === uidOf.slot('drink'));
  assert.ok(mainSlot && drinkSlot, 'bundle slots map to option groups');
  assert.equal(mainSlot.maxQuantity, 1);
  assert.deepEqual(mainSlot.defaultOptionUids, [uidOf.item(bbStd.documentId)]);
  const special = mainSlot.options.find((opt) => opt.uid === uidOf.item(bbDb.documentId));
  assert.equal(special.unitPriceDelta.amount, 20000);
  const slots = comboSellable.metadata.bundleSlots;
  assert.equal(slots.length, 2);
  assert.equal(slots[0].items[0].productRef, bunBo.documentId);

  // listSellables: drafts and non-online products never leave the catalog.
  const list = await adapter.listSellables(ctx, { locale: 'vi', limit: 50 });
  const titles = list.items.map((item) => item.title);
  assert.ok(titles.includes('Bún bò Huế') && titles.includes('Combo trưa 1 người'));
  assert.ok(!titles.includes('Lẩu Thái'), 'draft product must not be listed');
  // Category filter by slug works.
  const mains = await adapter.listSellables(ctx, { locale: 'vi', categoryRef: 'mon-chinh', limit: 50 });
  const mainTitles = mains.items.map((item) => item.title);
  assert.ok(mainTitles.includes('Bún bò Huế') && mainTitles.includes('Cơm gà xối mỡ'));
  assert.ok(!mainTitles.includes('Trà đào cam sả'), 'category filter must scope products');
  // Cursor pagination walks the whole catalog.
  const first = await adapter.listSellables(ctx, { locale: 'vi', limit: 2 });
  const second = await adapter.listSellables(ctx, { locale: 'vi', limit: 2, cursor: first.nextCursor });
  assert.ok(first.items.length === 2 && first.nextCursor, 'cursor expected for page 1');
  const seen = new Set([...first.items, ...second.items].map((item) => item.ref.uid));
  assert.equal(seen.size, first.items.length + second.items.length, 'pages must not overlap');

  // listCategories: tree with parent refs and localized titles.
  const categories = await adapter.listCategories(ctx, { locale: 'en' });
  const mainsCat = categories.find((row) => row.title === 'Mains');
  assert.ok(mainsCat);
  const hue = categories.find((row) => row.parentRef === monChinh.documentId);
  assert.ok(hue && hue.path.length === 2, 'child category carries its path');

  // --- Availability via catalog-location-state -------------------------------------------
  // Tạm hết Trà đào (a drink choice in the combo): the choice deactivates, combo stays on.
  await d.state.create({
    data: { entityType: 'variant', entityDocumentId: tdStd.documentId, locationRef: 'Q1', selling: false },
  });
  let fresh = await adapter.getSellable(ctx, { uid: comboTrua.documentId }, { locale: 'vi' });
  assert.equal(fresh.purchasable, true, 'combo survives one unavailable choice');
  const drinkAfter = fresh.options.find((group) => group.uid === uidOf.slot('drink'));
  assert.equal(
    drinkAfter.options.find((opt) => opt.uid === uidOf.item(tdStd.documentId)).isActive,
    false,
    'unavailable bundle item deactivates its option',
  );

  // Also tạm hết the remaining drink choice → the required slot is empty → combo hết.
  await d.state.create({
    data: { entityType: 'variant', entityDocumentId: traDaStd.documentId, locationRef: 'Q1', selling: false },
  });
  fresh = await adapter.getSellable(ctx, { uid: comboTrua.documentId }, { locale: 'vi' });
  assert.equal(fresh.purchasable, false, 'required slot with no sellable item disables the combo');
  const availability = await adapter.getAvailability(ctx, fresh, 1);
  assert.equal(availability.available, false);
  assert.equal(availability.reasonCode, 'component-unavailable');

  // Product-level tạm hết blocks the product itself.
  await d.state.create({
    data: { entityType: 'product', entityDocumentId: bunBo.documentId, locationRef: 'Q1', selling: false },
  });
  const blocked = await adapter.getSellable(ctx, { uid: bunBo.documentId }, { locale: 'vi' });
  assert.equal(blocked.purchasable, false);
  assert.equal((await adapter.getAvailability(ctx, blocked, 1)).reasonCode, 'temporarily-unavailable');
  await d.state.delete({ where: { entityType: 'product', entityDocumentId: bunBo.documentId, locationRef: 'Q1' } });

  // --- O1 order pipeline through the real adapter -----------------------------------------
  app.config.set('plugin::ordering.catalog.adapter', 'ordering-catalog');
  const input = basicOrderInput({
    lines: [
      {
        sellableUid: bunBo.documentId,
        quantity: 1,
        selected: [
          { groupUid: uidOf.group(topping.documentId), optionUid: uidOf.option(gioHeo.documentId), quantity: 1 },
        ],
      },
      {
        sellableUid: comboTrua.documentId,
        quantity: 1,
        selected: [
          { groupUid: uidOf.slot('main'), optionUid: uidOf.item(bbDb.documentId), quantity: 1 },
          { groupUid: uidOf.slot('drink'), optionUid: uidOf.item(traDaStd.documentId), quantity: 1 },
        ],
      },
    ],
    adjustments: [],
  });
  // Combo's required drink slot is empty right now (both choices tạm hết) → order must fail.
  await assert.rejects(order.createOrder(input, systemCtx), (error) => error?.code === 'SELLABLE_UNAVAILABLE');
  await d.state.delete({ where: { entityDocumentId: traDaStd.documentId, locationRef: 'Q1' } });

  const created = await order.createOrder(
    { ...input, idempotencyKey: randomUUID() },
    systemCtx,
  );
  const [lineA, lineB] = created.order.lines;
  assert.equal(lineA.unitAmount, 65000);
  assert.equal(lineA.optionAmount, 25000, 'Giò heo override reaches the order line');
  assert.equal(lineB.unitAmount, 99000);
  assert.equal(lineB.optionAmount, 20000, 'Tô đặc biệt +20.000 reaches the order line');
  const components = lineB.componentsSnapshot;
  assert.equal(components.length, 2, 'combo line snapshots both picked components');
  assert.deepEqual(
    components.map((c) => [c.slotKey, c.variantUid]).sort(),
    [['drink', traDaStd.documentId], ['main', bbDb.documentId]].sort(),
  );
  assert.equal(lineA.categoriesSnapshot.length, 2, 'categories snapshot keeps both categories');

  console.log('[ordering-test] catalog-adapter: sellable normalization, overrides, combo, order pipeline verified');
});
