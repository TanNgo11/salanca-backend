import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  basicOrderInput,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

// O12 step 3: branch service/packaging fees ride the pricing pipeline — quote equals create,
// a percent fee prices on the discounted merchandise subtotal, receiveKinds scope the fee,
// minSubtotal gates it, and an order edit reprices the stored snapshot.
withApp(async (app) => {
  const { order } = services(app);
  const edit = app.plugin('ordering').service('order-edit');
  await seedBranches(app);
  seedMenu(app);
  const branchRows = app.db.query('plugin::ordering.branch');
  const q1 = await branchRows.findOne({ where: { code: 'Q1' } });
  await branchRows.update({
    where: { id: q1.id },
    data: {
      fees: [
        {
          code: 'phuc-vu',
          label: { vi: 'Phí phục vụ', en: 'Service fee' },
          kind: 'service',
          percent: 5,
          receiveKinds: ['pickup', 'delivery', 'dine-in'],
          taxable: true,
        },
        {
          code: 'dong-goi',
          label: { vi: 'Phí đóng gói', en: 'Packaging fee' },
          kind: 'packaging',
          amount: 10000,
          receiveKinds: ['pickup'],
          taxable: true,
        },
        {
          code: 'giao-hang',
          label: { vi: 'Phí giao hàng', en: 'Delivery handling' },
          kind: 'service',
          amount: 20000,
          receiveKinds: ['delivery'],
          taxable: true,
        },
        {
          code: 'lon-hon',
          label: { vi: 'Phí đơn lớn', en: 'Large-order fee' },
          kind: 'service',
          percent: 10,
          receiveKinds: ['pickup'],
          taxable: true,
          minSubtotal: 200000,
        },
        {
          code: 'tai-ban',
          label: { vi: 'Phí tại bàn', en: 'Table fee' },
          kind: 'service',
          amount: 15000,
          receiveKinds: ['dine-in'],
          taxable: true,
        },
      ],
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          schedule: { openingHours: { mode: '24_7' } },
        },
        dineIn: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          schedule: { openingHours: { mode: '24_7' } },
        },
        delivery: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          schedule: { openingHours: { mode: '24_7' } },
          zones: [
            {
              code: 'xt-zone',
              label: 'Xã test',
              priority: 0,
              match: { kind: 'commune', communeCodes: ['XT01002'] },
              rules: [{ when: 'any', fee: 0 }],
            },
          ],
        },
      },
    },
  });

  const cart = { lines: [{ sellableUid: 'bun-bo', quantity: 2 }, { sellableUid: 'tra-dao', quantity: 1 }] };
  const merchandise = 175_000;

  // ── Quote: percent on merchandise + flat packaging; the minSubtotal fee stays out ──────
  const quote = await order.quote(
    basicOrderInput({ adjustments: [], lines: cart.lines }),
    systemCtx,
  );
  const feeRows = quote.adjustments.filter((a) => a.kind === 'fee');
  assert.deepEqual(
    feeRows.map((a) => [a.code, a.amount]),
    [
      ['phuc-vu', 8750],
      ['dong-goi', 10000],
    ],
    '5% service + flat packaging on pickup; lon-hon below its minimum',
  );
  assert.equal(quote.totals.subtotal, merchandise);
  assert.equal(quote.totals.adjustmentTotal, 18_750);
  assert.equal(quote.totals.grandTotal, 193_750);

  // ── Create: same totals, snapshot persisted for later repricing ───────────────────────
  const created = await order.createOrder(
    basicOrderInput({ adjustments: [], lines: cart.lines }),
    systemCtx,
  );
  const orderId = created.order.order.id;
  assert.equal(created.order.order.totalAmount, quote.totals.grandTotal, 'quote = create');
  const stored = await app.db.query('plugin::ordering.order-adjustment').findMany({
    where: { order: orderId, kind: 'fee' },
  });
  assert.equal(stored.length, 2);
  const phucVu = stored.find((row) => row.code === 'phuc-vu');
  assert.equal(phucVu.sourceRef, 'fee:phuc-vu');
  assert.equal(phucVu.ruleSnapshot.branchFee.percent, 5);

  // ── Discount first: the percent fee prices on the discounted subtotal ─────────────────
  const discounted = await order.createOrder(
    basicOrderInput({
      lines: cart.lines,
      adjustments: [{ kind: 'discount', code: 'test-25k', label: 'Giảm test', amount: -25000 }],
    }),
    systemCtx,
  );
  // 175_000 − 25_000 → 5% = 7_500; packaging still 10_000 → grand 167_500.
  assert.equal(discounted.order.order.adjustmentAmount, -7_500);
  assert.equal(discounted.order.order.totalAmount, 167_500);

  // ── Receive-kind scoping: delivery gets phuc-vu + giao-hang, never dong-goi ───────────
  const delivery = await order.createOrder(
    basicOrderInput({
      adjustments: [],
      lines: cart.lines,
      receiveMethod: {
        kind: 'delivery',
        locationRef: 'Q1',
        address: {
          communeCode: 'xt01002',
          line1: '1 Đường test',
          recipientName: 'Khách test',
          phone: '+84900000001',
        },
      },
    }),
    systemCtx,
  );
  const deliveryFees = await app.db.query('plugin::ordering.order-adjustment').findMany({
    where: { order: delivery.order.order.id, kind: 'fee' },
  });
  assert.deepEqual(
    deliveryFees.map((row) => row.code).sort(),
    ['giao-hang', 'phuc-vu'],
    'packaging does not apply to delivery, handling does',
  );
  // 175_000 × 5% + 20_000 → grand 203_750 (delivery zone fee is 0).
  assert.equal(delivery.order.order.totalAmount, 203_750);

  // ── Edit repricing: removing trà đào shrinks the percent fee with the subtotal ────────
  const agg = await order.getOrder(orderId, systemCtx);
  const traDao = agg.lines.find((line) => line.sellableUid === 'tra-dao');
  await edit.edit(
    orderId,
    { revision: 0, reason: 'bot tra dao', reduce: [{ lineId: traDao.id, quantity: 1 }] },
    systemCtx,
  );
  const after = await order.getOrder(orderId, systemCtx);
  // 130_000 → 5% = 6_500 + 10_000 → grand 146_500.
  assert.equal(after.order.totalAmount, 146_500);
  const editedFee = (await app.db.query('plugin::ordering.order-adjustment').findMany({
    where: { order: orderId, code: 'phuc-vu' },
    orderBy: { id: 'desc' },
  }))[0];
  assert.equal(Number(editedFee.amount), 6_500, 'percent fee repriced on the edited subtotal');

  // ── Dine-in edit keeps its dine-in-only fee (edit prices the order as dine-in, not pickup) ──
  const table = await app.plugin('ordering').service('table').create(
    { locationRef: 'Q1', code: 'F1', name: 'Bàn phí' },
    systemCtx,
  );
  const tableToken = table.item.qrUrl.match(/[?&]t=([^&]+)/)[1];
  const dineIn = await order.createOrder(
    basicOrderInput({
      adjustments: [],
      lines: cart.lines,
      receiveMethod: { kind: 'dine-in', locationRef: 'Q1', tableToken },
    }),
    systemCtx,
  );
  const dineInId = dineIn.order.order.id;
  const dineInFees = async () =>
    (await app.db.query('plugin::ordering.order-adjustment').findMany({
      where: { order: dineInId, kind: 'fee' },
      orderBy: { id: 'desc' },
    }));
  assert.deepEqual(
    [...new Set((await dineInFees()).map((row) => row.code))].sort(),
    ['phuc-vu', 'tai-ban'],
    'dine-in gets the service fee and the table fee, never packaging',
  );
  const dineAgg = await order.getOrder(dineInId, systemCtx);
  await edit.edit(
    dineInId,
    {
      revision: 0,
      reason: 'bot tra dao',
      reduce: [{ lineId: dineAgg.lines.find((line) => line.sellableUid === 'tra-dao').id, quantity: 1 }],
    },
    systemCtx,
  );
  const dineAfter = await order.getOrder(dineInId, systemCtx);
  // 130_000 → 5% = 6_500 + table fee 15_000 → grand 151_500.
  assert.equal(dineAfter.order.totalAmount, 151_500, 'table fee survives the edit');
  assert.equal(
    Number((await dineInFees()).find((row) => row.code === 'tai-ban').amount),
    15_000,
  );

  console.log(
    '[ordering-test] fees: quote=create, percent-on-discounted, kind scoping, minSubtotal, edit reprice, dine-in edit keeps table fee verified',
  );
});
