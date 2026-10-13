// Promotion quote/create: same total, per-customer, first order, cancel returns a use,
// a line-targeted percent, and a code that does not exist.
import assert from 'node:assert/strict';

import { basicOrderInput, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const PHONE = '+84901110001';

const createPromotion = async (app, data, code) => {
  const row = await app.db.query('plugin::ordering.promotion').create({ data });
  if (code) {
    await app.db.query('plugin::ordering.promotion-code').create({
      data: {
        promotionId: row.id,
        code: code.code,
        usageLimit: code.usageLimit ?? null,
        usedCount: 0,
        active: true,
      },
    });
  }
  return row;
};

const basePromotion = (overrides) => ({
  name: { vi: 'Giảm', en: 'Off' },
  kind: 'code',
  discountType: 'percent',
  value: 10,
  maxDiscount: null,
  target: { kind: 'order', refs: [] },
  minSubtotal: 0,
  locationRefs: ['Q1'],
  receiveKinds: ['pickup'],
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-12-01T00:00:00.000Z',
  weekdays: [],
  timeRanges: [],
  firstOrderOnly: false,
  usageLimit: null,
  perCustomerLimit: null,
  stackable: false,
  priority: 1,
  active: true,
  usedCount: 0,
  ...overrides,
});

withApp(async (app) => {
  const { order, transition } = services(app);
  await seedBranches(app);
  seedMenu(app);

  await createPromotion(
    app,
    basePromotion({ name: { vi: 'Giảm 10%' }, maxDiscount: 30000, perCustomerLimit: 1, stackable: true }),
    { code: 'GIAM10', usageLimit: null },
  );

  const inputFor = (phone, code, extra = {}) =>
    basicOrderInput({
      adjustments: [],
      promotionCode: code,
      contact: { name: 'Khách test', phone },
      placedAt: '2026-10-13T04:30:00.000Z',
      ...extra,
    });

  const first = inputFor(PHONE, 'giam10');
  const { idempotencyKey: _key, ...draft } = first;
  const quoted = await order.quote(draft, systemCtx);
  const created = await order.createOrder(first, systemCtx);
  assert.equal(quoted.totals.grandTotal, 198000);
  assert.equal(created.order.order.totalAmount, quoted.totals.grandTotal);
  assert.equal(created.order.order.adjustmentAmount, -22000);
  assert.equal(quoted.promotions[0].code, 'GIAM10');
  assert.equal(quoted.rejectedPromotions.length, 0);
  console.log('[ordering-test] quote matches create for GIAM10, total', created.order.order.totalAmount);

  await assert.rejects(
    () => order.createOrder(inputFor(PHONE, 'GIAM10'), systemCtx),
    (error) => error.code === 'PROMOTION_NOT_ELIGIBLE' && error.details?.reason === 'per-customer',
  );
  console.log('[ordering-test] second order for the same phone is per-customer');

  const other = await order.createOrder(inputFor('+84901110002', 'GIAM10'), systemCtx);
  assert.equal(other.order.order.totalAmount, 198000);
  await transition.cancelOrder({ orderId: other.order.order.id, reason: 'test' }, systemCtx);
  const promo = await app.db.query('plugin::ordering.promotion').findOne({ where: { id: { $gt: 0 } } });
  assert.equal(promo.usedCount, 1);
  console.log('[ordering-test] cancel releases the use; one redemption remains');

  await createPromotion(
    app,
    basePromotion({
      name: { vi: 'Bún bò' },
      kind: 'auto',
      discountType: 'percent',
      value: 10,
      target: { kind: 'products', refs: ['bun-bo'] },
      stackable: false,
      priority: 0,
    }),
  );
  const linePromo = await order.quote(
    basicOrderInput({
      adjustments: [],
      contact: { name: 'Khách', phone: '+84901110003' },
      placedAt: '2026-10-13T04:30:00.000Z',
    }),
    systemCtx,
  );
  // Bún bò 130000 × 10% = 13000. No code, so only the automatic promotion applies.
  assert.equal(linePromo.totals.grandTotal, 220000 - 13000);
  assert.equal(linePromo.promotions[0].target, 'lines');
  console.log('[ordering-test] product promotion discounts only the matching line');

  const badQuote = await order.quote(
    basicOrderInput({
      adjustments: [],
      promotionCode: 'NOPE1',
      contact: { name: 'Khách', phone: '+84901110004' },
      placedAt: '2026-10-13T04:30:00.000Z',
    }),
    systemCtx,
  );
  assert.equal(badQuote.rejectedPromotions[0].reason, 'invalid');
  await assert.rejects(
    () =>
      order.createOrder(
        basicOrderInput({
          adjustments: [],
          promotionCode: 'NOPE1',
          contact: { name: 'Khách', phone: '+84901110004' },
          placedAt: '2026-10-13T04:30:00.000Z',
        }),
        systemCtx,
      ),
    (error) => error.code === 'PROMOTION_INVALID',
  );
  console.log('[ordering-test] an unknown code is rejected on the quote and refused on create');
});
