// O5 step 5: the three delivery workflows share one delivery leg
// (ready → out-for-delivery → delivered | failed → ready | canceled) and the
// delivery-assignment service owns it: staff or external-vehicle dispatch, a failure
// needs a reason, a retry clears the assignee, cancel refunds captured cash at once
// and a captured transfer as a pending refund. SePay prepay still auto-advances.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

import {
  seedBranches,
  seedMenu,
  seedStaff,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

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

// Test-only address; logs never print it (harness rule).
const ADDRESS = {
  communeCode: 'XT01002',
  line1: '12 Đường Bí Mật',
  recipientName: 'Người Thử',
  phone: '0901234567',
};

const sign = (secret, timestamp, rawBody) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

await withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const plugin = app.plugin('ordering');
  const { order, transition, payment: paymentService } = services(app);
  const adminOrders = plugin.service('admin-orders');
  const delivery = plugin.service('delivery-assignment');

  const branches = app.db.query('plugin::ordering.branch');
  const setDelivery = async (paymentTiming, paymentProviders) => {
    const q1 = await branches.findOne({ where: { code: 'Q1' } });
    await branches.update({
      where: { id: q1.id },
      data: {
        onlineOrdering: true,
        fulfillment: {
          delivery: {
            enabled: true,
            orderTiming: 'both',
            paymentTiming,
            paymentProviders,
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

  const staff = await seedStaff(app);
  const lanCtx = { actor: staff.lan.actor };
  const minhCtx = { actor: staff.minh.actor };
  const lanRef = `admin:${staff.lan.user.id}`;
  const minhRef = `admin:${staff.minh.user.id}`;
  // A staff member scoped to another branch cannot manage a Q1 delivery at all.
  const q3only = await app.admin.services.user.create({
    firstname: 'q3',
    lastname: 'test',
    email: `q3only-${randomUUID().slice(0, 8)}@example.invalid`,
    isActive: true,
    registrationToken: null,
    roles: [],
  });
  await app.db
    .query('plugin::ordering.staff-location-scope')
    .create({ data: { adminUserId: q3only.id, allLocations: false, locationRefs: ['Q3'] } });
  const q3actor = await services(app).scope.actorFromAdminUser(q3only);
  const q3Ctx = { actor: q3actor };

  const place = (overrides = {}) =>
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
        ...overrides,
      },
      systemCtx,
    );
  const legOf = (groupId) =>
    app.db.query('plugin::ordering.fulfillment').findOne({ where: { group: groupId } });
  const groupOf = async (orderId) => (await order.getOrder(orderId, systemCtx)).groups[0];
  const codeOf = (error) => error?.code ?? error?.name ?? 'NO_ERROR';
  const errorOf = async (fn) => {
    try {
      await fn();
      return 'NO_ERROR';
    } catch (error) {
      return codeOf(error);
    }
  };

  await setDelivery('pay-on-pickup', ['cash']);

  // ── Workflow selection ─────────────────────────────────────────────────────
  const cod = await place();
  const codId = cod.order.order.id;
  const codGroup = cod.order.groups[0];
  assert.equal(codGroup.workflowName, 'delivery-pay-on-delivery');
  assert.equal(codGroup.status, 'awaiting-acceptance');
  const codTotal = cod.order.order.totalAmount;
  assert.equal(codTotal, 145000); // 130000 + 15000 delivery fee

  // Out of scope staff gets 404 before touching anything.
  assert.equal(
    await errorOf(() => adminOrders.transition(codId, { to: 'preparing' }, { actor: q3actor })),
    'ORDER_NOT_FOUND',
  );

  // ── Ready → out-for-delivery: validation ───────────────────────────────────
  await transition.transitionGroup(
    { orderId: codId, groupId: codGroup.id, to: 'preparing' },
    systemCtx,
  );
  await transition.transitionGroup({ orderId: codId, groupId: codGroup.id, to: 'ready' }, systemCtx);

  assert.equal(
    await errorOf(() => adminOrders.transition(codId, { to: 'out-for-delivery' }, lanCtx)),
    'VALIDATION_ERROR',
    'dispatch needs a staff driver or an external vehicle',
  );
  assert.equal(
    await errorOf(() =>
      adminOrders.transition(codId, { to: 'out-for-delivery', assigneeRef: 'driver:1' }, lanCtx),
    ),
    'VALIDATION_ERROR',
    'assigneeRef must be admin:<id>',
  );
  assert.equal(
    await errorOf(() =>
      adminOrders.transition(
        codId,
        { to: 'out-for-delivery', assigneeRef: `admin:${q3only.id}` },
        lanCtx,
      ),
    ),
    'VALIDATION_ERROR',
    'an assignee outside the branch scope is rejected',
  );

  // ── Concurrent dispatch: exactly one wins ──────────────────────────────────
  const [first, second] = await Promise.allSettled([
    adminOrders.transition(codId, { to: 'out-for-delivery', assigneeRef: lanRef }, lanCtx),
    adminOrders.transition(codId, { to: 'out-for-delivery', assigneeRef: minhRef }, minhCtx),
  ]);
  const winner = [first, second].find((result) => result.status === 'fulfilled');
  const loser = [first, second].find((result) => result.status === 'rejected');
  assert.ok(winner, 'one dispatch must win');
  assert.equal(winner.value.to, 'out-for-delivery');
  assert.equal(codeOf(loser.reason), 'INVALID_TRANSITION', 'the losing dispatch sees the group lock');
  let leg = await legOf(codGroup.id);
  assert.equal(leg.status, 'out-for-delivery');
  assert.ok(leg.assigneeRef === lanRef || leg.assigneeRef === minhRef);
  const assignedRef = leg.assigneeRef;
  assert.ok(leg.shippedAt);

  const detail = await adminOrders.detail(codId, lanCtx);
  assert.equal(detail.delivery.assigneeRef, assignedRef);
  assert.equal(detail.delivery.status, 'out-for-delivery');
  assert.equal(detail.delivery.address.wardCode, 'XT01002');
  const next = Object.fromEntries(detail.nextTransitions.map((item) => [item.to, item]));
  assert.equal(next.delivered.kind, 'primary');
  assert.deepEqual(next.delivered.requires, ['cash']);
  assert.equal(next.failed.kind, 'danger');
  assert.deepEqual(next.failed.requires, ['reason']);

  // Success with money due is refused until the cash handover collects it.
  assert.equal(
    await errorOf(() => adminOrders.transition(codId, { to: 'delivered' }, lanCtx)),
    'PAYMENT_REQUIRED',
  );

  // ── Thu tiền và giao: the payment names the courier, not the acting staff ──
  const handover = await adminOrders.cashHandover(codId, {}, minhCtx);
  assert.equal(handover.collected, codTotal);
  leg = await legOf(codGroup.id);
  assert.equal(leg.status, 'delivered');
  assert.ok(leg.deliveredAt);
  const cashPayment = (await order.getOrder(codId, systemCtx)).payments.find(
    (row) => row.providerCode === 'cash',
  );
  assert.equal(cashPayment.actorRef, assignedRef, 'the courier collects at the door');
  const finished = await order.getOrder(codId, systemCtx);
  assert.equal(finished.order.status, 'completed');

  // ── External vehicle: tracking only, cash names the acting staff ──────────
  const external = await place();
  const extId = external.order.order.id;
  const extGroup = external.order.groups[0];
  await transition.transitionGroup({ orderId: extId, groupId: extGroup.id, to: 'preparing' }, systemCtx);
  await transition.transitionGroup({ orderId: extId, groupId: extGroup.id, to: 'ready' }, systemCtx);
  const extDispatch = await adminOrders.transition(
    extId,
    {
      to: 'out-for-delivery',
      tracking: { carrier: 'Hãng Xe Thử', number: 'TX-123', url: 'https://tracking.example/t/TX-123' },
    },
    lanCtx,
  );
  assert.equal(extDispatch.to, 'out-for-delivery');
  leg = await legOf(extGroup.id);
  assert.equal(leg.assigneeRef, null);
  assert.equal(leg.trackingNumber, 'TX-123');
  assert.equal(leg.metadata.carrier, 'Hãng Xe Thử');
  const extHandover = await adminOrders.cashHandover(extId, {}, minhCtx);
  assert.equal(extHandover.collected, external.order.order.totalAmount);
  const extPayment = (await order.getOrder(extId, systemCtx)).payments[0];
  assert.equal(extPayment.actorRef, minhRef, 'no assignee → the acting staff is the cash actor');

  // ── Failed delivery: reason required, retry re-assigns ─────────────────────
  const failing = await place();
  const failId = failing.order.order.id;
  const failGroup = failing.order.groups[0];
  await transition.transitionGroup({ orderId: failId, groupId: failGroup.id, to: 'preparing' }, systemCtx);
  await transition.transitionGroup({ orderId: failId, groupId: failGroup.id, to: 'ready' }, systemCtx);
  await adminOrders.transition(failId, { to: 'out-for-delivery', assigneeRef: lanRef }, lanCtx);

  assert.equal(
    await errorOf(() => adminOrders.transition(failId, { to: 'failed' }, lanCtx)),
    'VALIDATION_ERROR',
    'a failure needs a reason code',
  );
  assert.equal(
    await errorOf(() =>
      adminOrders.transition(failId, { to: 'failed', reasonCode: 'other' }, lanCtx),
    ),
    'VALIDATION_ERROR',
    '"other" needs a note',
  );
  assert.equal(
    await errorOf(() =>
      adminOrders.transition(failId, { to: 'failed', reasonCode: 'sold-out' }, lanCtx),
    ),
    'VALIDATION_ERROR',
    'reject reasons do not apply to delivery failures',
  );
  const failed = await adminOrders.transition(
    failId,
    { to: 'failed', reasonCode: 'unreachable' },
    lanCtx,
  );
  assert.equal(failed.to, 'failed');
  leg = await legOf(failGroup.id);
  assert.equal(leg.status, 'failed');
  assert.equal(leg.metadata.lastFailure.reasonCode, 'unreachable');

  // Retry: failed → ready clears the leg; a new dispatch re-assigns.
  const retry = await adminOrders.transition(failId, { to: 'ready' }, lanCtx);
  assert.equal(retry.to, 'ready');
  leg = await legOf(failGroup.id);
  assert.equal(leg.status, 'pending');
  assert.equal(leg.assigneeRef, null);
  assert.equal(leg.trackingNumber, null);
  assert.equal(leg.shippedAt, null);
  assert.equal(leg.metadata.attempts, 1);
  await adminOrders.transition(failId, { to: 'out-for-delivery', assigneeRef: minhRef }, lanCtx);
  leg = await legOf(failGroup.id);
  assert.equal(leg.assigneeRef, minhRef);

  // Failed again → cancel refunds: this leg carried captured cash (driver collected at
  // the door before the attempt went wrong) and the refund settles at once.
  await paymentService.capturePayment(
    {
      paymentId: (
        await paymentService.createPayment(
          { orderId: failId, providerCode: 'cash', amount: failing.order.order.totalAmount },
          systemCtx,
        )
      ).id,
      amount: failing.order.order.totalAmount,
      providerTransactionId: `cash-door:${failId}`,
    },
    systemCtx,
  );
  await adminOrders.transition(failId, { to: 'failed', reasonCode: 'refused' }, lanCtx);
  const canceled = await adminOrders.cancel(failId, { reasonCode: 'other', note: 'hủy sau giao thất bại' }, lanCtx);
  assert.equal(canceled.refunded, failing.order.order.totalAmount);
  assert.equal(canceled.refundPending, 0);
  leg = await legOf(failGroup.id);
  assert.equal(leg.status, 'canceled');
  assert.ok(leg.canceledAt);
  const failDetail = await adminOrders.detail(failId, lanCtx);
  assert.equal(failDetail.refunds.length, 1);
  assert.equal(failDetail.refunds[0].status, 'settled');

  // ── SePay prepay: a matching transfer still auto-advances the delivery ────
  await setDelivery('prepay', ['sepay']);
  await app.listen();
  const secret = app.config.get('plugin::ordering').providers.payment.sepay.webhookSecret;
  const webhookUrl = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering/webhooks/sepay`;
  const transfer = async (id, orderCode, amount) => {
    const body = JSON.stringify({
      id,
      transferType: 'in',
      transferAmount: amount,
      accountNumber: '0123456789',
      content: `SLC${orderCode}`,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SePay-Timestamp': timestamp,
        'X-SePay-Signature': `sha256=${sign(secret, timestamp, body)}`,
      },
      body,
    });
    assert.equal(res.status, 200);
    return res;
  };

  const prepaid = await place({ payment: { providerCode: 'sepay' } });
  const preId = prepaid.order.order.id;
  const preGroup = prepaid.order.groups[0];
  assert.equal(preGroup.workflowName, 'delivery-prepay');
  assert.equal(preGroup.status, 'awaiting-payment');
  await transfer(9001, prepaid.order.order.code, prepaid.order.order.totalAmount);
  assert.equal((await groupOf(preId)).status, 'awaiting-acceptance', 'matched transfer moves prepay');

  await adminOrders.transition(preId, { to: 'preparing' }, lanCtx);
  await transition.transitionGroup({ orderId: preId, groupId: preGroup.id, to: 'ready' }, systemCtx);
  const preDetail = await adminOrders.detail(preId, lanCtx);
  const preDispatch = preDetail.nextTransitions.find((item) => item.to === 'out-for-delivery');
  assert.equal(preDispatch.kind, 'primary');
  assert.deepEqual(preDispatch.requires, ['assignee']);
  await adminOrders.transition(preId, { to: 'out-for-delivery', assigneeRef: lanRef }, lanCtx);
  // Prepaid: nothing due, so staff can mark the leg delivered without collecting.
  const delivered = await adminOrders.transition(preId, { to: 'delivered' }, lanCtx);
  assert.equal(delivered.to, 'delivered');
  leg = await legOf(preGroup.id);
  assert.equal(leg.status, 'delivered');
  assert.ok(leg.deliveredAt);
  assert.equal((await order.getOrder(preId, systemCtx)).order.status, 'completed');

  // Prepay gone wrong: failed → cancel writes a pending refund for the settlement flow.
  const doomed = await place({ payment: { providerCode: 'sepay' } });
  const doomedId = doomed.order.order.id;
  const doomedGroup = doomed.order.groups[0];
  await transfer(9002, doomed.order.order.code, doomed.order.order.totalAmount);
  await adminOrders.transition(doomedId, { to: 'preparing' }, lanCtx);
  await transition.transitionGroup({ orderId: doomedId, groupId: doomedGroup.id, to: 'ready' }, systemCtx);
  await adminOrders.transition(doomedId, { to: 'out-for-delivery', assigneeRef: lanRef }, lanCtx);
  await adminOrders.transition(doomedId, { to: 'failed', reasonCode: 'wrong-address' }, lanCtx);
  const doomedCancel = await adminOrders.cancel(
    doomedId,
    { reasonCode: 'other', note: 'hủy sau giao thất bại' },
    lanCtx,
  );
  assert.equal(doomedCancel.refunded, 0);
  assert.equal(doomedCancel.refundPending, doomed.order.order.totalAmount);
  const doomedDetail = await adminOrders.detail(doomedId, lanCtx);
  assert.equal(doomedDetail.refunds.length, 1);
  assert.equal(doomedDetail.refunds[0].status, 'pending');
  assert.equal(doomedDetail.order.paymentStatus, 'paid', 'pending refund does not move paymentStatus');
  leg = await legOf(doomedGroup.id);
  assert.equal(leg.status, 'canceled');

  // ── Accept-then-pay picks its own workflow ─────────────────────────────────
  await setDelivery('accept-then-pay', ['sepay']);
  const atp = await place({ payment: { providerCode: 'sepay' } });
  assert.equal(atp.order.groups[0].workflowName, 'delivery-accept-then-pay');
  assert.equal(atp.order.groups[0].status, 'awaiting-acceptance');
  const atpId = atp.order.order.id;
  await adminOrders.transition(atpId, { to: 'awaiting-payment' }, lanCtx);
  await transfer(9003, atp.order.order.code, atp.order.order.totalAmount);
  assert.equal((await groupOf(atpId)).status, 'preparing');

  console.log('[ordering-test] delivery leg: dispatch, race, external vehicle, fail/retry,');
  console.log('[ordering-test] cash handover actor, cancel refunds (cash + bank), sepay prepay');
});
