// Step 15 review additions: branch code immutability (service + Document Service middleware),
// PII-safe admin change log with eventHub emission, and per-line cancellation with refund
// accounting. Run: node scripts/ordering/review-additions.mjs
import assert from 'node:assert/strict';

import {
  basicOrderInput,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

withApp(async (app) => {
  const { order, payment, branch, changeLog, lineCancel } = services(app);
  const branches = await seedBranches(app);
  seedMenu(app);

  // --- (a) branch code immutability + change log -----------------------------------------
  // Give Q1 a real phone first (db.query bypass is documented; the log must show a before).
  const PHONE_BEFORE = '+84901112222';
  const PHONE_AFTER = '+84903334444';
  await app.db
    .query('plugin::ordering.branch')
    .update({ where: { id: branches.Q1.id }, data: { phone: PHONE_BEFORE } });

  await assert.rejects(
    branch.update(branches.Q1.id, { code: 'Q9' }, systemCtx),
    (error) => error?.code === 'BRANCH_CODE_IMMUTABLE',
  );
  await assert.rejects(
    app.documents('plugin::ordering.branch').update({
      documentId: branches.Q1.documentId,
      data: { code: 'Q9' },
    }),
    (error) => error?.code === 'BRANCH_CODE_IMMUTABLE',
  );
  console.log('[ordering-test] branch code immutable via service + documents middleware');

  const changed = [];
  const listener = (payload) => changed.push(payload);
  app.eventHub.on('ordering.admin.changed', listener);

  await branch.update(branches.Q1.id, { phone: PHONE_AFTER }, systemCtx);
  const logs = await changeLog.list({ entityType: 'branch' });
  const phoneLog = logs.find((row) => row.action === 'branch.update');
  assert.ok(phoneLog, 'a branch.update change-log row must exist');
  assert.deepEqual(phoneLog.changes.phone, { before: '[redacted]', after: '[redacted]' });
  const logJson = JSON.stringify(phoneLog.changes);
  for (const digits of ['90111222', '90333444']) {
    assert.ok(!logJson.includes(digits), `change log must not contain ${digits}`);
  }
  assert.equal(changed.length, 1, 'ordering.admin.changed must fire once');
  const eventJson = JSON.stringify(changed[0]);
  for (const digits of ['90111222', '90333444']) {
    assert.ok(!eventJson.includes(digits), `event payload must not contain ${digits}`);
  }
  assert.equal(changed[0].entityType, 'branch');
  app.eventHub.off('ordering.admin.changed', listener);
  console.log('[ordering-test] change log: phone redacted, event emitted without values');

  // --- (b) line cancellation --------------------------------------------------------------
  const created = await order.createOrder(basicOrderInput(), systemCtx);
  const orderId = created.order.order.id;
  const lines = created.order.lines;
  const goiCuon = lines.find((line) => line.sellableUid === 'goi-cuon');
  const traDao = lines.find((line) => line.sellableUid === 'tra-dao');
  const totalBefore = Number(created.order.order.totalAmount);

  const pay = await payment.createPayment(
    { orderId, providerCode: 'test' },
    systemCtx,
  );
  await payment.capturePayment(
    { paymentId: pay.id, amount: totalBefore, providerTransactionId: 'lc-txn-1' },
    systemCtx,
  );

  // Cancel 1 of 3 goi-cuon: telescoped amount round(39887/3) = 13296.
  const first = await lineCancel.cancelLineQuantity(
    { orderId, lineId: goiCuon.id, quantity: 1, reason: 'khách đổi ý' },
    systemCtx,
  );
  const canceledLine = first.order.lines.find((line) => line.id === goiCuon.id);
  assert.equal(canceledLine.canceledQuantity, 1);
  assert.equal(canceledLine.returnedQuantity, 0, 'cancel must not bump returnedQuantity');
  assert.equal(first.refundAmount, 13296);
  assert.equal(first.refundShortfall, 0);
  const orderAfter = await order.getOrder(orderId, systemCtx);
  assert.equal(orderAfter.order.paymentStatus, 'partially-refunded');
  const refunds = await app.db
    .query('plugin::ordering.refund')
    .findMany({ where: { order: orderId } });
  const refundSum = refunds.reduce((sum, row) => sum + Number(row.amount), 0);
  assert.equal(refundSum, 13296);
  console.log('[ordering-test] line cancel: goi-cuon ×1 → refund 13296, partially-refunded');

  // Over-cancel: 3 of remaining 2 → LINE_QUANTITY_EXCEEDED.
  await assert.rejects(
    lineCancel.cancelLineQuantity(
      { orderId, lineId: goiCuon.id, quantity: 3, reason: 'quá số lượng' },
      systemCtx,
    ),
    (error) => error?.code === 'LINE_QUANTITY_EXCEEDED',
  );

  // Cancel the single tra-dao unit: full lineTotal 39886.
  const second = await lineCancel.cancelLineQuantity(
    { orderId, lineId: traDao.id, quantity: 1, reason: 'hết món' },
    systemCtx,
  );
  assert.equal(second.refundAmount, 39886);
  const final = await order.getOrder(orderId, systemCtx);
  const traDaoAfter = final.order.lines.find((line) => line.id === traDao.id);
  assert.equal(traDaoAfter.canceledQuantity, 1);
  assert.equal(
    Number(final.order.totalAmount),
    totalBefore,
    'order totalAmount is immutable; refunds carry the money',
  );
  const canceledEvents = await app.db
    .query('plugin::ordering.order-event')
    .findMany({ where: { order: orderId, type: 'order.line.canceled' } });
  assert.equal(canceledEvents.length, 2);
  assert.ok(canceledEvents.every((row) => row.isPublic));
  const outboxRows = await app.db
    .query('plugin::ordering.outbox')
    .findMany({ where: { type: 'order.line.canceled' } });
  assert.equal(outboxRows.length, 2);
  console.log(
    `[ordering-test] line cancel: tra-dao ×1 → refund 39886, total stays ${totalBefore}, ` +
      'timeline+outbox emitted',
  );
});
