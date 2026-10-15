import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { seedAdminHttpStaff, seedBranches, seedMenu, systemCtx, withApp } from './_harness.mjs';

// O3 step 7: Admin order API over HTTP with real route policies.
// - staff of branch Q1 cannot read or act on a Q3 order through ANY admin order route (404);
// - acceptance sets estimatedReadyAt; "Nhận và lùi" adds delayMinutes; two staff accepting at
//   once → one 200, one INVALID_TRANSITION;
// - rejection needs a reason; delivering with money due needs cash-handover;
// - cash-handover failing mid-way leaves no payment and no state change;
// - mockup case: cancel 1 × Bún bò (100.000) of a 199.000 − 24.000 order → refund 87.940, and
//   the preview shows the same number before the write.
withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const catalog = app.plugin('ordering').service('registry').catalogAdapter('test-catalog');
  const base = {
    requiresShipping: false, isVirtual: false, isDownloadable: false, isGiftCard: false,
    fulfillmentKinds: ['pickup'], options: [], availability: {}, isActive: true, purchasable: true,
    categories: [{ ref: 'mon-chinh', title: 'Món chính', path: ['mon-chinh'] }],
    productType: 'test-food',
  };
  catalog.seed([
    { ...base, ref: { uid: 'bun-bo-dac-biet' }, title: 'Bún bò Huế', listPrice: { amount: 100000, currency: 'VND' } },
    { ...base, ref: { uid: 'combo-trua' }, title: 'Combo trưa 1 người', listPrice: { amount: 99000, currency: 'VND' } },
  ]);
  const branchRows = app.db.query('plugin::ordering.branch');
  for (const code of ['Q1', 'Q3']) {
    const row = await branchRows.findOne({ where: { code } });
    await branchRows.update({
      where: { id: row.id },
      data: {
        fulfillment: {
          pickup: {
            enabled: true,
            paymentTiming: 'pay-on-pickup',
            paymentProviders: ['cash'],
            schedule: { leadTimeMinutes: 30, openingHours: { mode: '24_7' } },
          },
        },
      },
    });
  }
  const orderService = app.plugin('ordering').service('order');
  const place = async (locationRef, extra = {}) =>
    (
      await orderService.createOrder(
        {
          idempotencyKey: randomUUID(),
          locationRef,
          lines: [
            { sellableUid: 'bun-bo-dac-biet', quantity: 1 },
            { sellableUid: 'combo-trua', quantity: 1 },
          ],
          receiveMethod: { kind: 'pickup', locationRef },
          pickup: { asap: true },
          contact: { name: 'Ngọc', phone: '0901234567' },
          consent: { policyVersion: 'v1', channel: 'web-checkout' },
          customerNote: 'Lấy giúp 2 bộ đũa',
          adjustments: [{ kind: 'discount', code: 'giam-24k', label: 'Giảm 24k', amount: -24000 }],
          origin: { kind: 'storefront' },
          ...extra,
        },
        systemCtx,
      )
    ).order.order;

  await app.listen();
  const http = await seedAdminHttpStaff(app, {
    scopes: {
      lan: { allLocations: false, locationRefs: ['Q1'] },
      minh: { allLocations: false, locationRefs: ['Q1'] },
      chain: { allLocations: true, locationRefs: [] },
    },
  });
  const readOnly = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { viewer: { allLocations: true, locationRefs: [] } },
  });
  try {
    const { lan, minh, chain } = http.as;
    const q1 = await place('Q1');
    const q3 = await place('Q3');
    assert.equal(q1.totalAmount, 175000, 'mockup total 199.000 − 24.000');

    // --- Scope across every admin order route ---------------------------------------------
    const lineQ3 = (await chain('GET', `/orders/${q3.id}`)).body.lines[0].id;
    const outOfScope = [
      ['GET', `/orders/${q3.id}`],
      ['POST', `/orders/${q3.id}/transition`, { to: 'preparing' }],
      ['POST', `/orders/${q3.id}/notes`, { text: 'x' }],
      ['POST', `/orders/${q3.id}/cash-handover`, { method: 'cash' }],
      ['POST', `/orders/${q3.id}/cancel`, { reasonCode: 'closed' }],
      ['GET', `/orders/${q3.id}/lines/${lineQ3}/cancel-preview?quantity=1`],
      ['POST', `/orders/${q3.id}/lines/${lineQ3}/cancel`, { quantity: 1, reason: 'x' }],
      ['POST', `/orders/${q3.id}/refunds`, { amount: 1000, reason: 'x' }],
    ];
    for (const [method, path, body] of outOfScope) {
      const res = await lan(method, path, body);
      assert.equal(res.status, 404, `${method} ${path} must be 404 for Q1 staff (got ${res.status})`);
    }
    const lanList = await lan('GET', '/orders?tab=all');
    assert.deepEqual(lanList.body.results.map((row) => row.locationRef), ['Q1']);
    assert.equal(lanList.body.results[0].customer.phoneMasked, '090•••4567');
    assert.equal((await chain('GET', '/orders?tab=awaiting')).body.counts.awaiting, 2);
    assert.equal((await lan('GET', '/orders/summary')).body.awaiting, 1);
    assert.equal(
      (await readOnly.as.viewer('POST', `/orders/${q1.id}/transition`, { to: 'preparing' })).status,
      403,
      'order.process is required to act',
    );

    // --- Detail + next transitions ----------------------------------------------------------
    const detail = (await lan('GET', `/orders/${q1.id}`)).body;
    assert.equal(detail.order.contact.phone, '+84901234567', 'full phone in detail');
    assert.deepEqual(
      detail.nextTransitions.map((item) => [item.to, item.kind, item.requires]),
      [
        ['preparing', 'primary', []],
        ['rejected', 'danger', ['reason']],
      ],
    );

    // --- Concurrent accept: one wins ---------------------------------------------------------
    const race = await Promise.all([
      lan('POST', `/orders/${q1.id}/transition`, { to: 'preparing', notifyCustomer: true }),
      minh('POST', `/orders/${q1.id}/transition`, { to: 'preparing', notifyCustomer: true }),
    ]);
    assert.deepEqual(race.map((res) => res.status).sort(), [200, 409]);
    assert.equal(race.find((res) => res.status === 409).body.error.code, 'INVALID_TRANSITION');
    const accepted = race.find((res) => res.status === 200).body.detail;
    assert.ok(accepted.group.estimatedReadyAt, 'acceptance sets estimatedReadyAt');

    // --- Notes are internal ------------------------------------------------------------------
    const noted = (await lan('POST', `/orders/${q1.id}/notes`, { text: 'Khách gọi lại, lấy trễ 5 phút' })).body;
    assert.ok(noted.timeline.some((event) => event.type === 'note' && event.isPublic === false));

    // --- Delivered needs cash; cash-handover failing mid-way changes nothing ---------------
    assert.equal((await lan('POST', `/orders/${q1.id}/transition`, { to: 'ready' })).status, 200);
    const direct = await lan('POST', `/orders/${q1.id}/transition`, { to: 'delivered' });
    assert.equal(direct.body.error.code, 'PAYMENT_REQUIRED');

    const transition = app.plugin('ordering').service('transition');
    const original = transition.transitionGroup;
    transition.transitionGroup = async () => {
      const { OrderingError } = await import('../../src/plugins/ordering/dist/server/src/domain/errors.js');
      throw new OrderingError('INTERNAL', 'injected failure after the cash write');
    };
    const failed = await lan('POST', `/orders/${q1.id}/cash-handover`, { method: 'cash' });
    transition.transitionGroup = original;
    assert.equal(failed.status, 500);
    const afterFail = (await lan('GET', `/orders/${q1.id}`)).body;
    assert.equal(afterFail.payments.length, 0, 'no payment row survives the rollback');
    assert.equal(afterFail.group.status, 'ready', 'state did not change');

    const handover = await lan('POST', `/orders/${q1.id}/cash-handover`, { method: 'cash' });
    assert.equal(handover.status, 200, JSON.stringify(handover.body));
    assert.equal(handover.body.collected, 175000);
    assert.equal(handover.body.detail.order.status, 'completed');
    assert.equal(handover.body.detail.order.paymentStatus, 'paid');
    assert.equal(handover.body.detail.payments[0].actorName, 'lan HTTP');

    // A completed order refuses a line cancel (O-06): the delivered unit is sold stock.
    const completedLine = handover.body.detail.lines.find((line) => line.title === 'Bún bò Huế');
    const completedCancel = await lan('POST', `/orders/${q1.id}/lines/${completedLine.id}/cancel`, {
      quantity: 1,
      reason: 'x',
    });
    assert.equal(completedCancel.status, 409, JSON.stringify(completedCancel.body));
    assert.equal(completedCancel.body.error.code, 'INVALID_TRANSITION');

    // --- Mockup partial cancel: 87.940 (a paid but still-live order) ---------------------------
    const live = await place('Q1');
    const paymentService = app.plugin('ordering').service('payment');
    const liveCash = await paymentService.createPayment({ orderId: live.id, providerCode: 'cash' }, systemCtx);
    await paymentService.capturePayment(
      { paymentId: liveCash.id, amount: live.totalAmount, providerTransactionId: randomUUID() },
      systemCtx,
    );
    const bunBo = (await lan('GET', `/orders/${live.id}`)).body.lines.find((line) => line.title === 'Bún bò Huế');
    const preview = await lan('GET', `/orders/${live.id}/lines/${bunBo.id}/cancel-preview?quantity=1`);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.refundAmount, 87940);
    assert.equal((await lan('GET', `/orders/${live.id}`)).body.lines.find((l) => l.id === bunBo.id).canceledQuantity, 0, 'preview wrote nothing');
    const lineCancel = await lan('POST', `/orders/${live.id}/lines/${bunBo.id}/cancel`, { quantity: 1, reason: 'Hết giò heo' });
    assert.equal(lineCancel.status, 200, JSON.stringify(lineCancel.body));
    assert.equal(lineCancel.body.refundAmount, 87940);
    assert.equal(lineCancel.body.detail.totals.refunded, 87940);

    // --- Manual cash refund respects the cap ----------------------------------------------------
    assert.equal(
      (await lan('POST', `/orders/${live.id}/refunds`, { amount: 100000, reason: 'x' })).body.error.code,
      'REFUND_EXCEEDS_CAPTURED',
    );
    const refunded = await lan('POST', `/orders/${live.id}/refunds`, { amount: 1060, reason: 'Thối thiếu' });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
    assert.equal(refunded.body.totals.refunded, 89000);

    // --- Reject needs a reason; "Nhận và lùi" adds the delay ---------------------------------
    const second = await place('Q1');
    assert.equal(
      (await lan('POST', `/orders/${second.id}/transition`, { to: 'rejected' })).body.error.details.field,
      'reasonCode',
    );
    assert.equal(
      (await lan('POST', `/orders/${second.id}/transition`, { to: 'rejected', reasonCode: 'made-up' })).body.error.code,
      'VALIDATION_ERROR',
    );
    const third = await place('Q1');
    const before = Date.now();
    const delayed = await lan('POST', `/orders/${third.id}/transition`, { to: 'preparing', delayMinutes: 20 });
    assert.equal(delayed.status, 200);
    const ready = new Date(delayed.body.detail.group.estimatedReadyAt).getTime();
    assert.ok(ready >= before + 50 * 60_000 - 5000 && ready <= Date.now() + 50 * 60_000 + 5000, 'lead 30 + delay 20');
    const rejected = await lan('POST', `/orders/${second.id}/transition`, { to: 'rejected', reasonCode: 'out-of-stock' });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.detail.order.status, 'canceled');

    // --- Staff cancel with a reason -------------------------------------------------------------
    assert.equal((await lan('POST', `/orders/${third.id}/cancel`, {})).body.error.details.field, 'reasonCode');
    const canceled = await lan('POST', `/orders/${third.id}/cancel`, { reasonCode: 'closed', note: 'Mất điện' });
    assert.equal(canceled.status, 200, JSON.stringify(canceled.body));
    assert.equal(canceled.body.detail.order.status, 'canceled');

    // --- Settings ------------------------------------------------------------------------------
    // The core store survives table truncation; start from defaults and leave them behind.
    await app.store({ type: 'plugin', name: 'ordering', key: 'settings' }).delete();
    const settings = await chain('GET', '/settings');
    assert.deepEqual(settings.body.settings.delayMinutes, [10, 20, 30]);
    const put = await chain('PUT', '/settings', { ...settings.body.settings, delayMinutes: [15, 45] });
    assert.deepEqual(put.body.settings.delayMinutes, [15, 45]);
    assert.equal((await readOnly.as.viewer('GET', '/settings')).status, 403);
    await app.store({ type: 'plugin', name: 'ordering', key: 'settings' }).delete();
    console.log('[ordering-test] admin-orders: scope on all routes, accept race, handover rollback, 87.940 cancel, refunds, settings verified');
  } finally {
    await http.cleanup();
    await readOnly.cleanup();
  }
});
