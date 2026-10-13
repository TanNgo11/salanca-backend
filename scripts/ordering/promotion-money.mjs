// O8 step 4 money paths around promotions: a staff edit keeps a whole-order percent code and
// reprices it on the remaining lines (warning promotion-kept); cancelling a line that carries a
// line-targeted discount refunds that line's net amount; a free-delivery order keeps the fee at 0
// and refunds only the canceled line. Totals always equal Σ lines + fee.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o8 node scripts/ordering/promotion-money.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { basicOrderInput, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const zone = {
  code: 'near',
  label: 'Gần',
  priority: 10,
  match: { kind: 'commune', communeCodes: ['XT01001', 'XT01002'] },
  rules: [
    { when: 'subtotal-lt', subtotal: 100000, fee: 'unavailable' },
    { when: 'subtotal-lt', subtotal: 300000, fee: 15000 },
    { when: 'any', fee: 0 },
  ],
  minOrderAmount: 100000,
  extraLeadTimeMinutes: 30,
};

// Test-only address; never printed.
const ADDRESS = { communeCode: 'XT01002', line1: '12 Đường Bí Mật', recipientName: 'Người Thử', phone: '0901234567' };

const promotion = (overrides) => ({
  name: { vi: 'Giảm' },
  kind: 'code',
  discountType: 'percent',
  value: 10,
  maxDiscount: null,
  target: { kind: 'order', refs: [] },
  minSubtotal: 0,
  locationRefs: null,
  receiveKinds: ['pickup', 'delivery'],
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: null,
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
  await seedBranches(app);
  seedMenu(app);
  const { order, payment, lineCancel } = services(app);
  const edit = app.plugin('ordering').service('order-edit');
  const promotions = app.db.query('plugin::ordering.promotion');
  const codes = app.db.query('plugin::ordering.promotion-code');
  const addCode = async (data, code) => {
    const row = await promotions.create({ data: promotion(data) });
    await codes.create({ data: { promotionId: row.id, code, usedCount: 0, active: true } });
    return row;
  };
  const place = (code, overrides = {}) =>
    order.createOrder(
      basicOrderInput({ adjustments: [], promotionCode: code, contact: { name: 'Khách', phone: `+849011${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}` }, ...overrides }),
      systemCtx,
    );
  const capture = async (orderId, amount) => {
    const row = await payment.createPayment({ orderId, providerCode: 'sepay', amount }, systemCtx);
    await payment.capturePayment({ paymentId: row.id, amount, providerTransactionId: randomUUID() }, systemCtx);
  };
  const sumLines = (aggregate) => aggregate.lines.reduce((sum, line) => sum + Number(line.lineTotalAmount), 0);

  // ── A. Whole-order 10% code kept and repriced on a staff edit ─────────────────────────
  // bún bò 2 × 65.000 + trà đào 45.000 + gỏi cuốn 3 × 15.000 = 220.000 → −22.000.
  await addCode({ name: { vi: 'Giảm 10% cả đơn' } }, 'EDIT10');
  const a = await place('EDIT10');
  assert.equal(a.order.order.totalAmount, 198000);
  const bunBo = a.order.lines.find((line) => line.sellableUid === 'bun-bo');
  const edited = await edit.edit(
    a.order.order.id,
    { revision: 0, reason: 'bot mot bun bo', reduce: [{ lineId: bunBo.id, quantity: 1 }] },
    systemCtx,
  );
  // 155.000 left → 10% = 15.500, not 0 and not the old 22.000.
  assert.equal(edited.preview.totals.after.total, 139500);
  assert.ok(edited.preview.warnings.includes('promotion-kept'), 'the edit warns the promotion was kept');
  const aAfter = await order.getOrder(a.order.order.id, systemCtx);
  const kept = aAfter.adjustments.find((row) => row.sourceRef?.startsWith('promotion:'));
  assert.equal(Number(kept.amount), -15500);
  assert.equal(aAfter.order.totalAmount, sumLines(aAfter) + Number(aAfter.order.fulfillmentAmount));
  console.log('[ordering-test] edit keeps a whole-order 10% code and reprices it to 15.500 on what is left');

  // ── B. Line-targeted 20% on trà đào, the line is canceled after payment ────────────────
  await addCode({ name: { vi: 'Trà đào −20%' }, value: 20, target: { kind: 'products', refs: ['tra-dao'] } }, 'TRA20');
  const b = await place('TRA20');
  assert.equal(b.order.order.totalAmount, 211000, '45.000 × 20% = 9.000 off the tea only');
  await capture(b.order.order.id, 211000);
  const tea = b.order.lines.find((line) => line.sellableUid === 'tra-dao');
  assert.equal(Number(tea.lineTotalAmount), 36000);
  const canceled = await lineCancel.cancelLineQuantity(
    { orderId: b.order.order.id, lineId: tea.id, quantity: 1, reason: 'het tra dao' },
    systemCtx,
  );
  assert.equal(canceled.refundAmount, 36000, 'the refund is the line net of its own discount');
  console.log('[ordering-test] canceling a line-discounted item refunds 36.000 (45.000 − 9.000)');

  // ── C. Free delivery: fee 15.000 waived; canceling a line refunds only that line ─────────
  const q1 = await app.db.query('plugin::ordering.branch').findOne({ where: { code: 'Q1' } });
  await app.db.query('plugin::ordering.branch').update({
    where: { id: q1.id },
    data: {
      onlineOrdering: true,
      fulfillment: {
        delivery: {
          enabled: true,
          orderTiming: 'both',
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash', 'sepay'],
          minOrderAmount: 0,
          schedule: { leadTimeMinutes: 60, slotLengthMinutes: 15, capacity: 8, openingHours: { mode: '24_7' } },
          zones: [zone],
        },
      },
    },
  });
  await addCode({ name: { vi: 'Miễn phí giao' }, discountType: 'free-delivery', value: null, receiveKinds: ['delivery'] }, 'FREESHIP');
  const c = await place('FREESHIP', {
    receiveMethod: { kind: 'delivery', address: ADDRESS },
    fulfillmentAmount: undefined,
  });
  assert.equal(Number(c.order.order.fulfillmentAmount), 0, 'the 15.000 fee is waived');
  assert.equal(c.order.order.totalAmount, 220000);
  const freeAdj = c.order.adjustments.find((row) => row.sourceRef?.startsWith('promotion:'));
  assert.equal(Number(freeAdj.amount), -15000);
  await capture(c.order.order.id, 220000);
  const rolls = c.order.lines.find((line) => line.sellableUid === 'goi-cuon');
  const cut = await lineCancel.cancelLineQuantity(
    { orderId: c.order.order.id, lineId: rolls.id, quantity: 3, reason: 'het goi cuon' },
    systemCtx,
  );
  assert.equal(cut.refundAmount, 45000, 'only the canceled line comes back, the waived fee is not refunded');
  const cAfter = await order.getOrder(c.order.order.id, systemCtx);
  assert.equal(Number(cAfter.order.fulfillmentAmount), 0);
  console.log('[ordering-test] free delivery: fee 0, canceling gỏi cuốn refunds 45.000 only');
});
