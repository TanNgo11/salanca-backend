// Step 5: staff edit of an open order. Adds keep the new price, old lines keep
// their snapshot, a captured transfer is refunded before cash, and a preview
// rolls the database back. Replay of the same revision is ORDER_CHANGED.
// Step 6: HTTP preview/edit. Missing order.edit is 403. Another branch is 404.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o7 node scripts/ordering/order-edit.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  basicOrderInput,
  cleanupStaff,
  seedAdminHttpStaff,
  seedBranches,
  seedMenu,
  seedStaff,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

if (!process.env.PORT || process.env.PORT === '1337') process.env.PORT = '15110';

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

// Test-only address. Logs in this file must not print it.
const ADDRESS = {
  communeCode: 'XT01002',
  line1: '12 Đường Bí Mật',
  recipientName: 'Người Thử',
  phone: '0901234567',
};

const codeOf = async (fn) => {
  try {
    await fn();
    return { code: 'NO_ERROR', error: null };
  } catch (error) {
    return { code: error?.code ?? 'NO_CODE', error };
  }
};

const paymentIdOf = (refund) =>
  typeof refund.payment === 'object' && refund.payment ? refund.payment.id : refund.payment;

await withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const staff = await seedStaff(app);
  const { order, transition, payment, outbox } = services(app);
  const edit = app.plugin('ordering').service('order-edit');
  const links = app.plugin('ordering').service('payment-link');
  const branches = app.db.query('plugin::ordering.branch');
  const limits = app.db.query('plugin::ordering.catalog-daily-limit');
  let q3user = null;
  const httpCleanups = [];

  const setPickup = async (extra = {}) => {
    const q1 = await branches.findOne({ where: { code: 'Q1' } });
    await branches.update({
      where: { id: q1.id },
      data: {
        fulfillment: {
          pickup: {
            enabled: true,
            paymentTiming: 'pay-on-pickup',
            paymentProviders: ['cash', 'sepay'],
            minOrderAmount: extra.minOrderAmount ?? 0,
            schedule: {
              businessDayPolicy: { cutoffLocalTime: '04:00' },
              capacity: extra.capacity ?? 8,
            },
          },
        },
      },
    });
  };

  const setDelivery = async () => {
    const q1 = await branches.findOne({ where: { code: 'Q1' } });
    await branches.update({
      where: { id: q1.id },
      data: {
        onlineOrdering: true,
        fulfillment: {
          delivery: {
            enabled: true,
            orderTiming: 'both',
            paymentTiming: 'pay-on-pickup',
            paymentProviders: ['cash'],
            minOrderAmount: 0,
            schedule: {
              leadTimeMinutes: 60,
              slotLengthMinutes: 15,
              capacity: 8,
              openingHours: { mode: '24_7' },
            },
            zones: [zone],
          },
        },
      },
    });
  };

  const place = (overrides = {}, ctx = systemCtx) =>
    order.createOrder(basicOrderInput({ adjustments: [], ...overrides }), ctx);

  const capture = async (orderId, providerCode, amount) => {
    const row = await payment.createPayment({ orderId, providerCode, amount }, systemCtx);
    await payment.capturePayment(
      { paymentId: row.id, amount, providerTransactionId: randomUUID() },
      systemCtx,
    );
    return row;
  };

  const counts = async (orderId) => {
    const aggregate = await order.getOrder(orderId, systemCtx);
    const payments = await app.db.query('plugin::ordering.payment').findMany({ where: { order: orderId } });
    const refunds = await app.db.query('plugin::ordering.refund').findMany({ where: { order: orderId } });
    return {
      lines: aggregate.lines.length,
      payments: payments.length,
      refunds: refunds.length,
      revision: aggregate.order.editRevision ?? 0,
      total: aggregate.order.totalAmount,
      fulfillment: aggregate.order.fulfillmentAmount,
    };
  };

  const usage = async (entityDocumentId, businessDate) => {
    const { rows } = await app.db.connection.raw(
      `SELECT COALESCE(reserved, 0) AS reserved
       FROM plugins_ordering_catalog_daily_usage
       WHERE entity_type = 'product' AND entity_document_id = ? AND location_ref = 'Q1'
         AND business_date = ?::date`,
      [entityDocumentId, businessDate],
    );
    return Number(rows[0]?.reserved ?? 0);
  };

  try {
    await setPickup();

    const limit = await limits.create({
      data: {
        entityType: 'product',
        entityDocumentId: 'bun-bo',
        locationRef: 'Q1',
        dailyLimit: 2,
        updatedByRef: 'ordering-test',
      },
    });
    const stock = await place({ lines: [{ sellableUid: 'bun-bo', quantity: 2 }] });
    const stockId = stock.order.order.id;
    const stockLine = stock.order.lines[0].id;
    const stockDate = String(stock.order.order.businessDate).slice(0, 10);
    assert.equal(await usage('bun-bo', stockDate), 2, 'create reserves two portions');
    await edit.edit(
      stockId,
      { revision: 0, reason: 'bot mot suat', reduce: [{ lineId: stockLine, quantity: 1 }] },
      systemCtx,
    );
    assert.equal(await usage('bun-bo', stockDate), 1, 'reducing one returns one');
    const soldOut = await codeOf(() =>
      edit.edit(
        stockId,
        { revision: 1, reason: 'them hai', add: [{ sellableUid: 'bun-bo', quantity: 2 }] },
        systemCtx,
      ),
    );
    assert.equal(soldOut.code, 'ITEM_SOLD_OUT');
    assert.equal(await usage('bun-bo', stockDate), 1, 'a refused add does not reserve');
    assert.equal((await order.getOrder(stockId, systemCtx)).order.editRevision ?? 0, 1);
    await edit.edit(
      stockId,
      { revision: 1, reason: 'them mot', add: [{ sellableUid: 'bun-bo', quantity: 1 }] },
      systemCtx,
    );
    assert.equal(await usage('bun-bo', stockDate), 2, 'the freed portion can be added back');
    await limits.delete({ where: { id: limit.id } });
    console.log('[ordering-test] daily limit delta reserved and released');

    const previewOrder = await place({ lines: [{ sellableUid: 'bun-bo', quantity: 1 }] });
    const previewId = previewOrder.order.order.id;
    const beforePreview = await counts(previewId);
    const preview = await edit.preview(
      previewId,
      { revision: 0, reason: 'xem truoc', add: [{ sellableUid: 'tra-dao', quantity: 1 }] },
      systemCtx,
    );
    assert.equal(preview.totals.after.total, 110000);
    assert.equal(preview.money.paymentLink, false);
    const afterPreview = await counts(previewId);
    assert.deepEqual(afterPreview, beforePreview);
    assert.equal(await links.currentUrl(previewId, new Date()), null);
    console.log('[ordering-test] preview leaves lines, payments, revision, and totals unchanged');

    const cashAdd = await edit.edit(
      previewId,
      { revision: 0, reason: 'them tra dao', add: [{ sellableUid: 'tra-dao', quantity: 1 }] },
      systemCtx,
    );
    assert.equal(cashAdd.preview.money.paymentLink, false);
    assert.equal(cashAdd.preview.money.refunds.length, 0);
    assert.equal(cashAdd.preview.totals.after.total, 110000);
    assert.equal(cashAdd.order.groups[0].status, 'awaiting-acceptance');
    const cashAgg = await order.getOrder(previewId, systemCtx);
    assert.equal(cashAgg.payments.length, 0);
    assert.equal(cashAgg.lines.length, 2);
    assert.equal(cashAgg.order.editRevision, 1);
    const addedLine = cashAgg.lines.find((line) => line.sellableUid === 'tra-dao');
    const keptLine = cashAgg.lines.find((line) => line.sellableUid === 'bun-bo');
    assert.equal(addedLine.addedInRevision, 1);
    assert.equal(addedLine.unitAmount, 45000);
    assert.equal(keptLine.unitAmount, 65000);
    assert.equal(keptLine.canceledQuantity, 0);
    console.log('[ordering-test] pay-on-pickup add raises the total without a payment');

    const sepayOrder = await place({ lines: [{ sellableUid: 'bun-bo', quantity: 2 }] });
    const sepayId = sepayOrder.order.order.id;
    await capture(sepayId, 'sepay', 130000);
    const sepayEdit = await edit.edit(
      sepayId,
      {
        revision: 0,
        reason: 'bot mot',
        reduce: [{ lineId: sepayOrder.order.lines[0].id, quantity: 1 }],
      },
      systemCtx,
    );
    assert.equal(sepayEdit.preview.totals.after.total, 65000);
    assert.equal(sepayEdit.preview.money.refundTransferPending, 65000);
    assert.equal(sepayEdit.preview.money.refundCash, 0);
    assert.equal(sepayEdit.preview.money.paymentLink, false);
    assert.equal(sepayEdit.order.groups[0].status, 'awaiting-acceptance');
    const sepayAgg = await order.getOrder(sepayId, systemCtx);
    assert.equal(sepayAgg.refunds.length, 1);
    assert.equal(sepayAgg.refunds[0].status, 'pending');
    assert.equal(sepayAgg.refunds[0].amount, 65000);
    assert.equal(sepayAgg.payments[0].refundedAmount, 0);
    assert.equal(sepayAgg.order.paymentStatus, 'overpaid');
    assert.equal(sepayAgg.lines[0].canceledQuantity, 1);
    console.log('[ordering-test] captured transfer edit writes a pending refund and keeps the group');

    const top = await place({ lines: [{ sellableUid: 'bun-bo', quantity: 1 }] });
    const topId = top.order.order.id;
    await capture(topId, 'sepay', 65000);
    const topped = await edit.edit(
      topId,
      { revision: 0, reason: 'them mon', add: [{ sellableUid: 'tra-dao', quantity: 1 }] },
      systemCtx,
    );
    assert.equal(topped.preview.money.extraDue, 45000);
    assert.equal(topped.preview.money.paymentLink, true);
    assert.equal(topped.preview.money.refunds.length, 0);
    assert.equal(topped.order.groups[0].status, 'awaiting-acceptance');
    const topAgg = await order.getOrder(topId, systemCtx);
    const balance = topAgg.payments.find((row) => row.capturedAmount === 0);
    assert.equal(balance.providerCode, 'sepay');
    assert.equal(balance.requestedAmount, 45000);
    assert.equal(balance.status, 'pending');
    assert.equal(topAgg.refunds.length, 0);
    const balanceUrl = await links.currentUrl(topId, new Date());
    assert.equal(typeof balanceUrl === 'string' && balanceUrl.includes('#p='), true);
    console.log('[ordering-test] online top-up opens a pending payment and a balance link');

    const mixed = await place({ lines: [{ sellableUid: 'bun-bo', quantity: 2 }] });
    const mixedId = mixed.order.order.id;
    const cashPay = await capture(mixedId, 'cash', 80000);
    const transferPay = await capture(mixedId, 'sepay', 50000);
    assert.ok(cashPay.id < transferPay.id);
    const mixedEdit = await edit.edit(
      mixedId,
      {
        revision: 0,
        reason: 'giam con mot',
        reduce: [{ lineId: mixed.order.lines[0].id, quantity: 1 }],
      },
      systemCtx,
    );
    assert.equal(mixedEdit.preview.totals.after.total, 65000);
    assert.deepEqual(
      mixedEdit.preview.money.refunds.map((refund) => [refund.providerCode, refund.amount, refund.settlement]),
      [
        ['sepay', 50000, 'pending'],
        ['cash', 15000, 'settled'],
      ],
    );
    const mixedAgg = await order.getOrder(mixedId, systemCtx);
    const mixedRefunds = mixedAgg.refunds.slice().sort((left, right) => left.id - right.id);
    assert.equal(mixedRefunds.length, 2);
    assert.equal(paymentIdOf(mixedRefunds[0]), transferPay.id);
    assert.equal(mixedRefunds[0].status, 'pending');
    assert.equal(mixedRefunds[0].amount, 50000);
    assert.equal(paymentIdOf(mixedRefunds[1]), cashPay.id);
    assert.equal(mixedRefunds[1].status, 'settled');
    assert.equal(mixedRefunds[1].amount, 15000);
    assert.ok(mixedRefunds[0].id < mixedRefunds[1].id);
    console.log('[ordering-test] mixed tender refunds the transfer before cash');

    const covered = await place({ lines: [{ sellableUid: 'bun-bo', quantity: 2 }] });
    const coveredId = covered.order.order.id;
    const smallCash = await capture(coveredId, 'cash', 50000);
    await capture(coveredId, 'sepay', 80000);
    const coveredEdit = await edit.edit(
      coveredId,
      {
        revision: 0,
        reason: 'giam vua',
        reduce: [{ lineId: covered.order.lines[0].id, quantity: 1 }],
      },
      systemCtx,
    );
    assert.deepEqual(
      coveredEdit.preview.money.refunds.map((refund) => [refund.providerCode, refund.amount, refund.settlement]),
      [['sepay', 65000, 'pending']],
    );
    const coveredAgg = await order.getOrder(coveredId, systemCtx);
    assert.equal(coveredAgg.refunds.length, 1);
    assert.equal(coveredAgg.refunds[0].status, 'pending');
    assert.equal(coveredAgg.payments.find((row) => row.id === smallCash.id).refundedAmount, 0);
    console.log('[ordering-test] transfer room covers the surplus, so cash stays captured');

    await setPickup({ capacity: 1 });
    const slotNow = new Date('2026-10-20T03:00:00.000Z');
    const slotCtx = { actor: { kind: 'system' }, now: slotNow };
    const branchRow = await branches.findOne({ where: { code: 'Q1' } });
    const pickup = app.plugin('ordering').service('branch').pickupSettings(branchRow);
    const slots = await app.plugin('ordering').service('pickup-scheduling').listSlots({
      branch: branchRow,
      settings: pickup,
      date: '2026-10-24',
      leadTimeMinutes: pickup.schedule.leadTimeMinutes,
      now: slotNow,
    });
    const noon = slots.find((slot) => slot.localStart === '12:00' && slot.available);
    assert.ok(noon, 'saturday noon slot');
    await order.createOrder(
      basicOrderInput({
        lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
        adjustments: [],
        placedAt: slotNow.toISOString(),
        payment: { providerCode: 'cash' },
        pickup: { slot: { startsAt: noon.startsAt } },
      }),
      slotCtx,
    );
    const mover = await order.createOrder(
      basicOrderInput({
        lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
        adjustments: [],
        placedAt: slotNow.toISOString(),
        payment: { providerCode: 'cash' },
        pickup: { asap: true },
      }),
      slotCtx,
    );
    const full = await codeOf(() =>
      edit.edit(
        mover.order.order.id,
        { revision: 0, reason: 'doi sang slot day', timing: { kind: 'scheduled', startsAt: noon.startsAt } },
        slotCtx,
      ),
    );
    assert.equal(full.code, 'SLOT_FULL');
    assert.equal((await order.getOrder(mover.order.order.id, systemCtx)).order.editRevision ?? 0, 0);
    console.log('[ordering-test] moving onto a full slot returns SLOT_FULL');

    await setPickup();
    const readyOrder = await place({ lines: [{ sellableUid: 'bun-bo', quantity: 1 }] });
    await transition.transitionGroup(
      { orderId: readyOrder.order.order.id, groupId: readyOrder.order.groups[0].id, to: 'preparing' },
      systemCtx,
    );
    await transition.transitionGroup(
      { orderId: readyOrder.order.order.id, groupId: readyOrder.order.groups[0].id, to: 'ready' },
      systemCtx,
    );
    const locked = await codeOf(() =>
      edit.edit(
        readyOrder.order.order.id,
        { revision: 0, reason: 'muon sua', add: [{ sellableUid: 'tra-dao', quantity: 1 }] },
        systemCtx,
      ),
    );
    assert.equal(locked.code, 'ORDER_NOT_EDITABLE');
    assert.equal(locked.error.details.status, 'ready');
    console.log('[ordering-test] a pickup order at ready cannot be edited');

    const replay = await place({ lines: [{ sellableUid: 'bun-bo', quantity: 1 }] });
    await edit.edit(
      replay.order.order.id,
      { revision: 0, reason: 'lan mot', add: [{ sellableUid: 'goi-cuon', quantity: 1 }] },
      systemCtx,
    );
    const stale = await codeOf(() =>
      edit.edit(
        replay.order.order.id,
        { revision: 0, reason: 'lan nua', add: [{ sellableUid: 'goi-cuon', quantity: 1 }] },
        systemCtx,
      ),
    );
    assert.equal(stale.code, 'ORDER_CHANGED');
    assert.equal(stale.error.details.revision, 1);
    console.log('[ordering-test] replaying the same revision returns ORDER_CHANGED');

    q3user = await app.admin.services.user.create({
      firstname: 'q3',
      lastname: 'edit',
      email: `q3only-${randomUUID().slice(0, 8)}@example.invalid`,
      isActive: true,
      registrationToken: null,
      roles: [],
    });
    await app.db.query('plugin::ordering.staff-location-scope').create({
      data: { adminUserId: q3user.id, allLocations: false, locationRefs: ['Q3'] },
    });
    const q3actor = await services(app).scope.actorFromAdminUser(q3user);
    const scoped = await place({ lines: [{ sellableUid: 'bun-bo', quantity: 1 }] });
    const denied = await codeOf(() =>
      edit.edit(
        scoped.order.order.id,
        {
          revision: 0,
          reason: 'khong thuoc',
          reduce: [{ lineId: scoped.order.lines[0].id, quantity: 1 }],
        },
        { actor: q3actor },
      ),
    );
    assert.equal(denied.code, 'ORDER_NOT_FOUND');
    console.log('[ordering-test] a Q3 staff edit of a Q1 order is ORDER_NOT_FOUND');

    await setPickup({ minOrderAmount: 200000 });
    const small = await place({ lines: [{ sellableUid: 'bun-bo', quantity: 1 }] });
    const warned = await edit.edit(
      small.order.order.id,
      { revision: 0, reason: 'them van duoi muc', add: [{ sellableUid: 'tra-dao', quantity: 1 }] },
      systemCtx,
    );
    assert.equal(warned.preview.warnings.includes('below-min-order'), true);
    assert.equal(warned.preview.totals.after.total, 110000);
    console.log('[ordering-test] a below-minimum edit warns and still saves');

    await setPickup();
    const promo = await place({
      lines: [{ sellableUid: 'bun-bo', quantity: 2 }],
      adjustments: [
        { kind: 'discount', code: 'test-25k', label: 'Giam test', amount: -25000, ruleSnapshot: { id: 'kept' } },
      ],
    });
    assert.equal(promo.order.order.totalAmount, 105000);
    const kept = await edit.edit(
      promo.order.order.id,
      {
        revision: 0,
        reason: 'bot van giu khuyen mai',
        reduce: [{ lineId: promo.order.lines[0].id, quantity: 1 }],
      },
      systemCtx,
    );
    assert.equal(kept.preview.warnings.includes('promotion-kept'), true);
    assert.equal(kept.preview.totals.after.total, 40000);
    const promoAgg = await order.getOrder(promo.order.order.id, systemCtx);
    assert.equal(promoAgg.adjustments.some((row) => row.code === 'test-25k' && row.amount === -25000), true);
    console.log('[ordering-test] a carried discount stays and is reported');

    const mailed = await place({
      lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
      contact: { name: 'Khách test', phone: '+84900000001', email: 'khach@example.invalid' },
    });
    await edit.edit(
      mailed.order.order.id,
      {
        revision: 0,
        reason: 'bao khach',
        add: [{ sellableUid: 'goi-cuon', quantity: 1 }],
        notifyCustomer: true,
      },
      systemCtx,
    );
    await outbox.dispatch({ owner: 'order-edit-test' });
    const mailedRows = () =>
      app.db.query('plugin::ordering.notification-delivery').findMany({
        where: { template: 'customer.order-updated', orderId: mailed.order.order.id },
      });
    assert.equal((await mailedRows()).length, 1);
    await edit.edit(
      mailed.order.order.id,
      {
        revision: 1,
        reason: 'khong bao',
        add: [{ sellableUid: 'goi-cuon', quantity: 1 }],
        notifyCustomer: false,
      },
      systemCtx,
    );
    await outbox.dispatch({ owner: 'order-edit-test-2' });
    assert.equal((await mailedRows()).length, 1);
    console.log('[ordering-test] customer update mail follows notifyCustomer');

    const cashLogs = await app.db.query('plugin::ordering.admin-change-log').findMany({
      where: { action: 'order.edit', entityId: String(previewId) },
    });
    const cashKeys = Object.keys(cashLogs[0].changes);
    assert.equal(cashKeys.includes('totalAmount'), true);
    for (const banned of ['address', 'line1', 'phone', 'recipientName', 'email']) {
      assert.equal(cashKeys.includes(banned), false, banned);
    }
    const cashEvents = await app.db.query('plugin::ordering.order-event').findMany({
      where: { order: previewId, type: 'order.edited' },
    });
    assert.equal(cashEvents[0].isPublic, true);
    assert.equal(cashEvents[0].payload.summary, 'Đơn đã được cập nhật');

    await setDelivery();
    const deliver = async () =>
      order.createOrder(
        {
          idempotencyKey: randomUUID(),
          locationRef: 'Q1',
          locale: 'vi',
          lines: [{ sellableUid: 'bun-bo', quantity: 2 }],
          receiveMethod: { kind: 'delivery', address: ADDRESS },
          contact: { name: 'Khách test', phone: '+84900000001' },
          consent: { policyVersion: 'v1', channel: 'web-checkout' },
          origin: { kind: 'storefront' },
        },
        systemCtx,
      );
    const deliveryOrder = await deliver();
    assert.equal(deliveryOrder.order.order.totalAmount, 145000);
    assert.equal(deliveryOrder.order.groups[0].workflowName, 'delivery-pay-on-delivery');
    const feeDrop = await edit.edit(
      deliveryOrder.order.order.id,
      { revision: 0, reason: 'them de mien phi ship', add: [{ sellableUid: 'bun-bo', quantity: 3 }] },
      systemCtx,
    );
    assert.equal(feeDrop.preview.fulfillmentAmount.before, 15000);
    assert.equal(feeDrop.preview.fulfillmentAmount.after, 0);
    assert.equal(feeDrop.preview.totals.after.total, 325000);
    assert.equal(feeDrop.order.groups[0].fulfillmentAmount, 0);
    const feeLogs = await app.db.query('plugin::ordering.admin-change-log').findMany({
      where: { action: 'order.edit', entityId: String(deliveryOrder.order.order.id) },
    });
    const feeKeys = Object.keys(feeLogs[0].changes);
    assert.equal(feeKeys.includes('fulfillmentAmount'), true);
    for (const banned of ['address', 'line1', 'phone', 'recipientName']) {
      assert.equal(feeKeys.includes(banned), false, banned);
    }
    const feeEvents = await app.db.query('plugin::ordering.order-event').findMany({
      where: { order: deliveryOrder.order.order.id, type: 'order.edited' },
    });
    for (const banned of ['address', 'phone', 'line1', 'recipientName', 'email', 'name']) {
      assert.equal(Object.prototype.hasOwnProperty.call(feeEvents[0].payload, banned), false, banned);
    }
    console.log('[ordering-test] crossing the free-delivery tier drops the fee');

    const outsideOrder = await deliver();
    const outsideTotal = outsideOrder.order.order.totalAmount;
    const blocked = await codeOf(() =>
      edit.edit(
        outsideOrder.order.order.id,
        { revision: 0, reason: 'doi xa', address: { ...ADDRESS, communeCode: 'XT01003' } },
        systemCtx,
      ),
    );
    assert.equal(blocked.code, 'DELIVERY_UNAVAILABLE');
    assert.equal(blocked.error.details.reason, 'outside');
    assert.equal(blocked.error.details.communeCode, 'XT01003');
    const outsideAfter = await order.getOrder(outsideOrder.order.order.id, systemCtx);
    assert.equal(outsideAfter.order.totalAmount, outsideTotal);
    assert.equal(outsideAfter.order.editRevision ?? 0, 0);
    console.log('[ordering-test] an address outside the zone leaves the order unchanged');

    const readyDelivery = await deliver();
    await transition.transitionGroup(
      { orderId: readyDelivery.order.order.id, groupId: readyDelivery.order.groups[0].id, to: 'preparing' },
      systemCtx,
    );
    await transition.transitionGroup(
      { orderId: readyDelivery.order.order.id, groupId: readyDelivery.order.groups[0].id, to: 'ready' },
      systemCtx,
    );
    const still = await edit.edit(
      readyDelivery.order.order.id,
      { revision: 0, reason: 'them luc san sang', add: [{ sellableUid: 'tra-dao', quantity: 1 }] },
      systemCtx,
    );
    assert.equal(still.order.groups[0].status, 'ready');
    assert.equal(still.preview.totals.after.total, 190000);
    console.log('[ordering-test] a delivery order stays editable at ready');

    await setPickup();
    await app.listen();
    const httpOrder = await place({ lines: [{ sellableUid: 'bun-bo', quantity: 1 }] });
    const httpId = httpOrder.order.order.id;
    const httpLine = httpOrder.order.lines[0].id;
    const editBody = {
      revision: 0,
      reason: 'them tra',
      add: [{ sellableUid: 'tra-dao', quantity: 1 }],
    };
    const reader = await seedAdminHttpStaff(app, {
      actions: ['order.read'],
      scopes: { xem: { allLocations: true, locationRefs: [] } },
    });
    httpCleanups.push(reader);
    const outsider = await seedAdminHttpStaff(app, {
      actions: ['order.read', 'order.edit'],
      scopes: { q3: { allLocations: false, locationRefs: ['Q3'] } },
    });
    httpCleanups.push(outsider);
    const editor = await seedAdminHttpStaff(app, {
      actions: ['order.read', 'order.edit'],
      scopes: { q1: { allLocations: false, locationRefs: ['Q1'] } },
    });
    httpCleanups.push(editor);

    const shown = await reader.as.xem('GET', `/orders/${httpId}`);
    assert.equal(shown.status, 200);
    assert.equal(shown.body.editRevision, 0);
    assert.equal(shown.body.order.editRevision, 0);
    assert.equal(shown.body.editable, true);
    assert.equal(shown.body.editableReason, null);
    const forbiddenPreview = await reader.as.xem('POST', `/orders/${httpId}/edit/preview`, editBody);
    assert.equal(forbiddenPreview.status, 403);
    const forbiddenEdit = await reader.as.xem('POST', `/orders/${httpId}/edit`, editBody);
    assert.equal(forbiddenEdit.status, 403);
    const outside = await outsider.as.q3('POST', `/orders/${httpId}/edit`, editBody);
    assert.equal(outside.status, 404);
    assert.equal(outside.body.error.code, 'ORDER_NOT_FOUND');
    const beforeHttp = await counts(httpId);
    const previewHttp = await editor.as.q1('POST', `/orders/${httpId}/edit/preview`, editBody);
    assert.equal(previewHttp.status, 200, previewHttp.body?.error?.code);
    assert.equal(previewHttp.body.totals.after.total, 110000);
    assert.equal(previewHttp.body.money.paymentLink, false);
    assert.deepEqual(await counts(httpId), beforeHttp);
    const savedHttp = await editor.as.q1('POST', `/orders/${httpId}/edit`, editBody);
    assert.equal(savedHttp.status, 200, savedHttp.body?.error?.code);
    assert.equal(savedHttp.body.preview.revision, 1);
    assert.equal(savedHttp.body.detail.editRevision, 1);
    assert.equal(savedHttp.body.detail.order.editRevision, 1);
    assert.equal(savedHttp.body.detail.editable, true);
    assert.equal(savedHttp.body.detail.lines.some((line) => line.addedInRevision === 1), true);
    const editedEvent = savedHttp.body.detail.timeline.find((event) => event.type === 'order.edited');
    assert.equal(editedEvent.payload.revision, 1);
    assert.equal(editedEvent.payload.summary, 'Đơn đã được cập nhật');
    const replayHttp = await editor.as.q1('POST', `/orders/${httpId}/edit`, editBody);
    assert.equal(replayHttp.status, 409);
    assert.equal(replayHttp.body.error.code, 'ORDER_CHANGED');
    assert.equal(replayHttp.body.error.details.revision, 1);

    const readyPickup = await place({ lines: [{ sellableUid: 'tra-dao', quantity: 1 }] });
    await transition.transitionGroup(
      { orderId: readyPickup.order.order.id, groupId: readyPickup.order.groups[0].id, to: 'preparing' },
      systemCtx,
    );
    await transition.transitionGroup(
      { orderId: readyPickup.order.order.id, groupId: readyPickup.order.groups[0].id, to: 'ready' },
      systemCtx,
    );
    const readyView = await reader.as.xem('GET', `/orders/${readyPickup.order.order.id}`);
    assert.equal(readyView.status, 200);
    assert.equal(readyView.body.editable, false);
    assert.equal(readyView.body.editableReason, 'ready');
    const reduceHttp = await editor.as.q1('POST', `/orders/${httpId}/edit`, {
      revision: 1,
      reason: 'bot bot',
      reduce: [{ lineId: httpLine, quantity: 1 }],
    });
    assert.equal(reduceHttp.status, 200, reduceHttp.body?.error?.code);
    assert.equal(reduceHttp.body.detail.order.editRevision, 2);
    console.log('[ordering-test] edit routes: 403 without order.edit, 404 outside the branch');

    console.log('[ordering-test] order edit checks passed');
  } finally {
    for (const httpStaff of httpCleanups) await httpStaff.cleanup();
    if (q3user) await app.admin.services.user.deleteById(q3user.id).catch(() => undefined);
    await cleanupStaff(app, staff);
  }
});
