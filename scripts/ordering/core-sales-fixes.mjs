// Core-sales regressions (audit 2026-10-14): money owed after a line cancel, refunds on every
// close path (customer cancel, payment expiry), cancel rights decided under the group lock,
// the delivery payment window, and line-cancel refunds spread over several payments.
// Run: node scripts/ordering/core-sales-fixes.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runPaymentExpiry } from '../../src/plugins/ordering/dist/server/src/jobs/payment-expiry.js';
import { basicOrderInput, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const MINUTE = 60_000;

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const { order, payment, transition, lineCancel } = services(app);
  const plugin = app.plugin('ordering');
  const admin = plugin.service('admin-orders');
  const storefront = plugin.service('storefront');
  const manual = plugin.service('manual-payment');
  const branches = app.db.query('plugin::ordering.branch');
  const q1 = await branches.findOne({ where: { code: 'Q1' } });
  const setPickup = (paymentTiming = 'pay-on-pickup') =>
    branches.update({
      where: { id: q1.id },
      data: {
        fulfillment: {
          pickup: {
            enabled: true,
            paymentTiming,
            paymentProviders: ['cash', 'test', 'sepay'],
            paymentTimeoutMinutes: 15,
          },
        },
      },
    });
  const place = (overrides = {}) => order.createOrder(basicOrderInput(overrides), systemCtx);
  const capture = async (id, amount, providerCode = 'cash') => {
    const row = await payment.createPayment({ orderId: id, providerCode, amount }, systemCtx);
    await payment.capturePayment(
      { paymentId: row.id, amount, providerTransactionId: randomUUID() },
      systemCtx,
    );
    return row;
  };
  const transfer = (id, amount) =>
    manual.record(
      id,
      { reference: `FIX-${randomUUID().slice(0, 30)}`, amount, transferredAt: new Date().toISOString() },
      systemCtx,
    );
  const age = (id, minutes) =>
    app.db
      .query('plugin::ordering.order')
      .update({ where: { id }, data: { placedAt: new Date(Date.now() - minutes * MINUTE) } });
  const line = (placed, uid) => placed.order.lines.find((row) => row.sellableUid === uid);

  // 1a. Cancel before anything is paid: the cash handover asks only for what is still owed.
  await setPickup();
  const unpaid = await place();
  const unpaidId = unpaid.order.order.id;
  const unpaidCancel = await lineCancel.cancelLineQuantity(
    { orderId: unpaidId, lineId: line(unpaid, 'tra-dao').id, quantity: 1, reason: 'unavailable' },
    systemCtx,
  );
  assert.equal(unpaidCancel.refundAmount, 0);
  assert.equal(unpaidCancel.refundShortfall, 0, 'nothing was paid, so nothing is owed back');
  for (const to of ['preparing', 'ready']) {
    await transition.transitionGroup({ orderId: unpaidId, groupId: unpaid.order.groups[0].id, to }, systemCtx);
  }
  const handover = await admin.cashHandover(unpaidId, { method: 'cash' }, systemCtx);
  assert.equal(handover.collected, 155114, 'handover must not charge the canceled item');
  const unpaidAfter = await order.getOrder(unpaidId, systemCtx);
  assert.equal(unpaidAfter.refunds.length, 0);
  assert.equal(unpaidAfter.order.paymentStatus, 'paid');
  assert.equal(unpaidAfter.order.status, 'completed');
  assert.equal(unpaidAfter.order.totalAmount, 195000, 'the placement snapshot is untouched');
  console.log('[ordering-test] core fixes: unpaid line cancel → handover 155114');

  // 1b. Part-paid: no refund, due = payable − captured.
  const part = await place();
  const partId = part.order.order.id;
  await capture(partId, 50000);
  const partCancel = await lineCancel.cancelLineQuantity(
    { orderId: partId, lineId: line(part, 'tra-dao').id, quantity: 1, reason: 'unavailable' },
    systemCtx,
  );
  assert.equal(partCancel.refundAmount, 0, 'part-paid money stays against what is still owed');
  assert.equal(partCancel.refundShortfall, 0);
  const partDetail = await admin.detail(partId, systemCtx);
  assert.equal(partDetail.totals.due, 105114);

  // 1c. Fully paid: the canceled share still goes back.
  const paid = await place();
  const paidId = paid.order.order.id;
  await capture(paidId, 195000);
  const paidCancel = await lineCancel.cancelLineQuantity(
    { orderId: paidId, lineId: line(paid, 'tra-dao').id, quantity: 1, reason: 'unavailable' },
    systemCtx,
  );
  assert.equal(paidCancel.refundAmount, 39886);
  assert.equal((await admin.detail(paidId, systemCtx)).totals.due, 0);
  console.log('[ordering-test] core fixes: part-paid owes the rest, fully paid is refunded');

  // 2. Customer cancel gives back the transfer that was received.
  await setPickup('prepay');
  const customer = await place();
  const customerId = customer.order.order.id;
  await transfer(customerId, 50000);
  await storefront.cancelByToken(customer.publicToken, 'customer-cancel', systemCtx);
  const customerAfter = await order.getOrder(customerId, systemCtx);
  assert.equal(customerAfter.order.status, 'canceled');
  assert.equal(customerAfter.refunds.length, 1);
  assert.equal(customerAfter.refunds[0].status, 'pending');
  assert.equal(customerAfter.refunds[0].amount, 50000);
  console.log('[ordering-test] core fixes: customer cancel → pending refund 50000');

  // 3. Payment expiry refunds what was received; a fully paid order moves on instead.
  const expiring = await place();
  const expiringId = expiring.order.order.id;
  await transfer(expiringId, 50000);
  await age(expiringId, 20);
  await runPaymentExpiry(app, { owner: 'fix-expiry-partial' });
  const expired = await order.getOrder(expiringId, systemCtx);
  assert.equal(expired.groups[0].status, 'expired');
  assert.equal(expired.refunds.length, 1);
  assert.equal(expired.refunds[0].status, 'pending');
  assert.equal(expired.refunds[0].amount, 50000);
  const funded = await place();
  const fundedId = funded.order.order.id;
  await transfer(fundedId, 195000);
  await age(fundedId, 20);
  await runPaymentExpiry(app, { owner: 'fix-expiry-paid' });
  assert.notEqual((await order.getOrder(fundedId, systemCtx)).groups[0].status, 'expired');
  console.log('[ordering-test] core fixes: expiry refunds a short payment, spares a paid order');

  // 4. A kitchen step that commits between the customer's read and cancel wins.
  await setPickup();
  const racing = await place();
  const racingId = racing.order.order.id;
  const originalGet = order.getOrder.bind(order);
  let notifyRead;
  let resume;
  const hasRead = new Promise((resolve) => { notifyRead = resolve; });
  const resumed = new Promise((resolve) => { resume = resolve; });
  let paused = false;
  order.getOrder = async (id, ctx) => {
    const result = await originalGet(id, ctx);
    if (id === racingId && ctx.actor.kind === 'customer' && !paused) {
      paused = true;
      notifyRead();
      await resumed;
    }
    return result;
  };
  let raceError;
  try {
    const cancelPromise = storefront.cancelByToken(racing.publicToken, 'race', systemCtx);
    await hasRead;
    await transition.transitionGroup({ orderId: racingId, groupId: racing.order.groups[0].id, to: 'preparing' }, systemCtx);
    resume();
    await cancelPromise.catch((error) => {
      raceError = error;
    });
  } finally {
    resume();
    order.getOrder = originalGet;
  }
  assert.equal(raceError?.code, 'CANCEL_NOT_ALLOWED');
  assert.equal((await order.getOrder(racingId, systemCtx)).groups[0].status, 'preparing');
  console.log('[ordering-test] core fixes: customer cancel loses to a committed kitchen step');

  // 5. Delivery orders expire on the delivery window, not the pickup one.
  await branches.update({
    where: { id: q1.id },
    data: {
      fulfillment: {
        pickup: { enabled: true, paymentTiming: 'prepay', paymentTimeoutMinutes: 1 },
        delivery: {
          enabled: true,
          paymentTiming: 'prepay',
          paymentProviders: ['test'],
          paymentTimeoutMinutes: 60,
          zones: [{ code: 'near', label: 'Near', priority: 1, match: { kind: 'commune', communeCodes: ['XT01001'] }, rules: [{ when: 'any', fee: 0 }], minOrderAmount: 0, extraLeadTimeMinutes: 0 }],
        },
      },
    },
  });
  const delivery = await place({
    receiveMethod: { kind: 'delivery', providerCode: 'self-delivery', address: { recipientName: 'Test', phone: '+84900000001', line1: 'Test', wardCode: 'XT01001' } },
    payment: { providerCode: 'test' },
  });
  const deliveryId = delivery.order.order.id;
  await age(deliveryId, 5);
  await runPaymentExpiry(app, { owner: 'fix-delivery-live' });
  assert.equal((await order.getOrder(deliveryId, systemCtx)).groups[0].status, 'awaiting-payment');
  await age(deliveryId, 61);
  await runPaymentExpiry(app, { owner: 'fix-delivery-due' });
  assert.equal((await order.getOrder(deliveryId, systemCtx)).groups[0].status, 'expired');
  console.log('[ordering-test] core fixes: delivery payment window is 60 minutes');

  // 6. A refund larger than any single payment is spread over several.
  await setPickup();
  const twoPay = await place();
  const twoPayId = twoPay.order.order.id;
  await capture(twoPayId, 25000);
  await capture(twoPayId, 25000);
  const twoPayCancel = await lineCancel.cancelLineQuantity(
    { orderId: twoPayId, lineId: line(twoPay, 'tra-dao').id, quantity: 1, reason: 'unavailable' },
    systemCtx,
  );
  assert.equal(twoPayCancel.refundAmount, 0);
  assert.equal(
    (await order.getOrder(twoPayId, systemCtx)).lines.find((row) => row.sellableUid === 'tra-dao').canceledQuantity,
    1,
  );
  const split = await place();
  const splitId = split.order.order.id;
  for (let index = 0; index < 5; index += 1) await capture(splitId, 39000);
  const splitLine = line(split, 'tra-dao');
  const splitCancel = await lineCancel.cancelLineQuantity(
    { orderId: splitId, lineId: splitLine.id, quantity: 1, reason: 'unavailable' },
    systemCtx,
  );
  assert.equal(splitCancel.refundAmount, 39886);
  assert.equal(splitCancel.refundShortfall, 0);
  const splitAfter = await order.getOrder(splitId, systemCtx);
  assert.equal(splitAfter.refunds.length, 2, 'one refund per payment that gave money back');
  assert.equal(splitAfter.refunds.reduce((sum, row) => sum + row.amount, 0), 39886);
  for (const row of splitAfter.refunds) {
    assert.equal(row.lines.reduce((sum, item) => sum + item.amount, 0), row.amount);
  }
  assert.equal(splitAfter.lines.find((row) => row.id === splitLine.id).canceledQuantity, 1);
  console.log('[ordering-test] core fixes: line cancel refund split over payments');

  // 7. A staff edit re-bases the total: units it cuts are not subtracted a second time, and a
  // line cancel made before the edit is already inside the new total.
  await setPickup();
  const edit = plugin.service('order-edit');
  const edited = await place();
  const editedId = edited.order.order.id;
  await lineCancel.cancelLineQuantity(
    { orderId: editedId, lineId: line(edited, 'tra-dao').id, quantity: 1, reason: 'unavailable' },
    systemCtx,
  );
  assert.equal((await admin.detail(editedId, systemCtx)).totals.due, 155114);
  const goiCuon = line(edited, 'goi-cuon');
  await edit.edit(editedId, { revision: 0, reason: 'bot mot cuon', reduce: [{ lineId: goiCuon.id, quantity: 1 }] }, systemCtx);
  const afterEdit = await order.getOrder(editedId, systemCtx);
  const editedDetail = await admin.detail(editedId, systemCtx);
  assert.equal(editedDetail.totals.due, afterEdit.order.totalAmount, 'due equals the re-based total');
  assert.ok(afterEdit.order.totalAmount < 155114);
  console.log('[ordering-test] core fixes: staff edit re-bases what is owed');

  // 8. Cancel after a return: refunds already paid out count as given, the cancel still refunds.
  const returned = await place();
  const returnedId = returned.order.order.id;
  const returnedPay = await capture(returnedId, 195000);
  await plugin.service('refund').createRefund(
    { paymentId: returnedPay.id, lines: [{ lineId: line(returned, 'goi-cuon').id, quantity: 1 }], reason: 'return', idempotencyKey: randomUUID() },
    systemCtx,
  );
  const afterReturn = await lineCancel.cancelLineQuantity(
    { orderId: returnedId, lineId: line(returned, 'tra-dao').id, quantity: 1, reason: 'unavailable' },
    systemCtx,
  );
  assert.equal(afterReturn.refundAmount, 39886, 'the canceled item is still refunded after a return');
  assert.equal(
    (await order.getOrder(returnedId, systemCtx)).refunds.reduce((sum, row) => sum + row.amount, 0),
    13296 + 39886,
  );
  console.log('[ordering-test] core fixes: cancel after a return refunds the canceled share');

  // 9. Money that arrives while the expiry job runs is either kept (order moves on) or refunded.
  await setPickup('prepay');
  for (const order_ of [0, 1, 2]) {
    const racer = await place();
    const racerId = racer.order.order.id;
    await transfer(racerId, 50000);
    await age(racerId, 20);
    await Promise.allSettled([
      runPaymentExpiry(app, { owner: `fix-expiry-race-${order_}` }),
      transfer(racerId, 145000),
    ]);
    const settled = await order.getOrder(racerId, systemCtx);
    const held = settled.payments.reduce((sum, row) => sum + row.capturedAmount - row.refundedAmount, 0);
    const pending = settled.refunds.filter((row) => row.status === 'pending').reduce((sum, row) => sum + row.amount, 0);
    if (settled.groups[0].status === 'expired') {
      assert.equal(held - pending, 0, 'an expired order keeps no unrefunded money');
    } else {
      assert.equal(held, 195000, 'a paid order was not expired');
      assert.equal(settled.refunds.length, 0);
    }
  }
  console.log('[ordering-test] core fixes: expiry racing a transfer loses no money');

  // 10. A payment link extends the deadline the job respects.
  const linked = await place();
  const linkedId = linked.order.order.id;
  await age(linkedId, 14);
  await plugin.service('payment-link').issue(linkedId, systemCtx);
  await age(linkedId, 20);
  await runPaymentExpiry(app, { owner: 'fix-link-live' });
  assert.equal((await order.getOrder(linkedId, systemCtx)).groups[0].status, 'awaiting-payment');
  await runPaymentExpiry(app, { owner: 'fix-link-due', now: new Date(Date.now() + 16 * MINUTE) });
  assert.equal((await order.getOrder(linkedId, systemCtx)).groups[0].status, 'expired');
  console.log('[ordering-test] core fixes: payment link extension keeps the order alive');

  // 11. Bank refunds stay pending and reserve the one SePay payment (transfers merge into it).
  await setPickup();
  const bank = await place();
  const bankId = bank.order.order.id;
  for (let index = 0; index < 5; index += 1) await transfer(bankId, 39000);
  const bankCancel = await lineCancel.cancelLineQuantity(
    { orderId: bankId, lineId: line(bank, 'tra-dao').id, quantity: 1, reason: 'unavailable' },
    systemCtx,
  );
  assert.equal(bankCancel.refundAmount, 39886);
  const bankAfter = await order.getOrder(bankId, systemCtx);
  assert.equal(bankAfter.refunds.length, 1);
  assert.ok(bankAfter.refunds.every((row) => row.status === 'pending'));
  const second = await lineCancel.cancelLineQuantity(
    { orderId: bankId, lineId: line(bank, 'goi-cuon').id, quantity: 1, reason: 'unavailable' },
    systemCtx,
  );
  assert.equal(second.refundAmount, 13296);
  assert.equal(second.refundShortfall, 0);
  const reserved = (await order.getOrder(bankId, systemCtx)).refunds.reduce((sum, row) => sum + row.amount, 0);
  assert.equal(reserved, 39886 + 13296);
  console.log('[ordering-test] core fixes: pending bank refunds reserve the payment');

  // 12. The customer cancel window is judged after the group lock, on a fresh read.
  const slotted = await place();
  const slottedId = slotted.order.order.id;
  const baseReceive = (await order.getOrder(slottedId, systemCtx)).order.receiveMethod;
  const setSlot = (startsAt) =>
    app.db.query('plugin::ordering.order').update({
      where: { id: slottedId },
      data: { receiveMethod: { ...baseReceive, timing: { mode: 'scheduled', slot: { startsAt, endsAt: startsAt } } } },
    });
  await setSlot(new Date(Date.now() + 5 * 60 * MINUTE).toISOString());
  const realGet = order.getOrder.bind(order);
  let slotRead;
  let slotResume;
  const slotReached = new Promise((resolve) => { slotRead = resolve; });
  const slotResumed = new Promise((resolve) => { slotResume = resolve; });
  let slotPaused = false;
  order.getOrder = async (id, ctx) => {
    const result = await realGet(id, ctx);
    if (id === slottedId && ctx.actor.kind === 'customer' && !slotPaused) {
      slotPaused = true;
      slotRead();
      await slotResumed;
    }
    return result;
  };
  let slotError;
  try {
    const attempt = storefront.cancelByToken(slotted.publicToken, 'late', systemCtx);
    await slotReached;
    await setSlot(new Date(Date.now() + 10 * MINUTE).toISOString());
    slotResume();
    await attempt.catch((error) => { slotError = error; });
  } finally {
    slotResume();
    order.getOrder = realGet;
  }
  assert.equal(slotError?.code, 'CANCEL_NOT_ALLOWED');
  assert.equal((await order.getOrder(slottedId, systemCtx)).order.status, 'open');
  console.log('[ordering-test] core fixes: cancel window is checked under the lock');

  // 13. After a staff edit a line is priced for its live units only: a later cancel is worth one
  // live unit, not a fraction of the original quantity.
  await setPickup();
  const reduced = await place();
  const reducedId = reduced.order.order.id;
  const reducedLine = line(reduced, 'goi-cuon');
  await edit.edit(reducedId, { revision: 0, reason: 'bot mot cuon', reduce: [{ lineId: reducedLine.id, quantity: 1 }] }, systemCtx);
  const editedLine = (await order.getOrder(reducedId, systemCtx)).lines.find((row) => row.id === reducedLine.id);
  assert.equal(editedLine.pricedQuantity, 2);
  const unit = Math.round(editedLine.lineTotalAmount / 2);
  const afterEditCancel = await lineCancel.cancelLineQuantity(
    { orderId: reducedId, lineId: reducedLine.id, quantity: 1, reason: 'unavailable' },
    systemCtx,
  );
  assert.equal((await order.getOrder(reducedId, systemCtx)).order.canceledAmount, unit);
  assert.equal(afterEditCancel.refundAmount, 0);
  const reducedPaid = await place();
  const reducedPaidId = reducedPaid.order.order.id;
  const reducedPaidLine = line(reducedPaid, 'goi-cuon');
  await edit.edit(reducedPaidId, { revision: 0, reason: 'bot mot cuon', reduce: [{ lineId: reducedPaidLine.id, quantity: 1 }] }, systemCtx);
  const reducedTotal = (await order.getOrder(reducedPaidId, systemCtx)).order.totalAmount;
  await capture(reducedPaidId, reducedTotal);
  const paidEditedLine = (await order.getOrder(reducedPaidId, systemCtx)).lines.find((row) => row.id === reducedPaidLine.id);
  const editedPaidCancel = await lineCancel.cancelLineQuantity(
    { orderId: reducedPaidId, lineId: reducedPaidLine.id, quantity: 2, reason: 'unavailable' },
    systemCtx,
  );
  assert.equal(editedPaidCancel.refundAmount, paidEditedLine.lineTotalAmount, 'canceling every live unit refunds exactly what they cost');
  console.log('[ordering-test] core fixes: cancel after an edit is priced on live units');

  // 14. A transfer recorded by hand against a closed order is refused, not left unrefunded.
  await setPickup('prepay');
  const closed = await place();
  const closedId = closed.order.order.id;
  await storefront.cancelByToken(closed.publicToken, 'closed', systemCtx);
  await assert.rejects(transfer(closedId, 50000), (error) => error?.code === 'ORDER_CLOSED');
  assert.equal((await order.getOrder(closedId, systemCtx)).payments.length, 0);
  console.log('[ordering-test] core fixes: manual record on a closed order is refused');

  // Concurrency: one operation is held inside its transaction while another starts. Every pair
  // must finish without a deadlock and leave the same state as running them one after the other.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const holdProjection = (ms) => {
    const original = order.recomputeProjection.bind(order);
    let held = false;
    order.recomputeProjection = async (id) => {
      if (!held) { held = true; await sleep(ms); }
      return original(id);
    };
    return () => { order.recomputeProjection = original; };
  };
  const holdGetOrder = (ms, orderId) => {
    const original = order.getOrder.bind(order);
    let held = false;
    order.getOrder = async (id, ctx) => {
      const result = await original(id, ctx);
      if (!held && id === orderId && ctx.actor.kind === 'system') { held = true; await sleep(ms); }
      return result;
    };
    return () => { order.getOrder = original; };
  };
  await setPickup();

  // 15. A capture and a line cancel on one order no longer take locks in opposite orders.
  const lockPair = await place();
  const lockPairId = lockPair.order.order.id;
  const lockPairPay = await payment.createPayment({ orderId: lockPairId, providerCode: 'cash', amount: 220000 }, systemCtx);
  await payment.capturePayment({ paymentId: lockPairPay.id, amount: 195000, providerTransactionId: randomUUID() }, systemCtx);
  const release15 = holdProjection(400);
  let outcomes15;
  try {
    const collecting = payment.capturePayment({ paymentId: lockPairPay.id, amount: 1, providerTransactionId: randomUUID() }, systemCtx);
    await sleep(100);
    const canceling = lineCancel.cancelLineQuantity({ orderId: lockPairId, lineId: line(lockPair, 'tra-dao').id, quantity: 1, reason: 'unavailable' }, systemCtx);
    outcomes15 = await Promise.allSettled([collecting, canceling]);
  } finally { release15(); }
  assert.deepEqual(outcomes15.map((row) => row.status), ['fulfilled', 'fulfilled'], JSON.stringify(outcomes15.map((row) => row.reason?.code)));
  console.log('[ordering-test] core fixes: capture and line cancel do not deadlock');

  // 16. A staff edit and a line cancel on one order apply one after the other, in either order:
  // the result equals running the two operations back to back.
  const pairOps = (pair) => ({
    runEdit: () => edit.edit(pair.order.order.id, { revision: 0, reason: 'them tra dao', add: [{ sellableUid: 'tra-dao', quantity: 1 }] }, systemCtx),
    runCancel: () => lineCancel.cancelLineQuantity({ orderId: pair.order.order.id, lineId: line(pair, 'tra-dao').id, quantity: 1, reason: 'unavailable' }, systemCtx),
  });
  for (const editFirst of [true, false]) {
    const reference = await place();
    const refOps = pairOps(reference);
    if (editFirst) { await refOps.runEdit(); await refOps.runCancel(); } else { await refOps.runCancel(); await refOps.runEdit(); }
    const expected = await admin.detail(reference.order.order.id, systemCtx);

    const pair = await place();
    const pairId = pair.order.order.id;
    const ops = pairOps(pair);
    const release = holdGetOrder(400, pairId);
    let done;
    try {
      const first = editFirst ? ops.runEdit() : ops.runCancel();
      await sleep(100);
      const second = editFirst ? ops.runCancel() : ops.runEdit();
      done = await Promise.allSettled([first, second]);
    } finally { release(); }
    assert.deepEqual(done.map((row) => row.status), ['fulfilled', 'fulfilled'], JSON.stringify(done.map((row) => row.reason?.message)));
    const detail = await admin.detail(pairId, systemCtx);
    assert.equal(detail.totals.due, expected.totals.due, `edit ${editFirst ? 'first' : 'second'}: same amount owed as back to back`);
    assert.equal(detail.order.totalAmount, expected.order.totalAmount);
  }
  console.log('[ordering-test] core fixes: edit and line cancel serialize');

  // 17. Two captures that finish an order together leave it paid.
  for (let round = 0; round < 3; round += 1) {
    const both = await place();
    const bothId = both.order.order.id;
    const total = both.order.order.totalAmount;
    const half = Math.floor(total / 2);
    const payA = await payment.createPayment({ orderId: bothId, providerCode: 'cash', amount: half }, systemCtx);
    const payB = await payment.createPayment({ orderId: bothId, providerCode: 'cash', amount: total - half }, systemCtx);
    const release17 = holdProjection(300);
    try {
      await Promise.all([
        payment.capturePayment({ paymentId: payA.id, amount: half, providerTransactionId: randomUUID() }, systemCtx),
        payment.capturePayment({ paymentId: payB.id, amount: total - half, providerTransactionId: randomUUID() }, systemCtx),
      ]);
    } finally { release17(); }
    assert.equal((await order.getOrder(bothId, systemCtx)).order.paymentStatus, 'paid');
  }
  console.log('[ordering-test] core fixes: simultaneous captures leave the order paid');
});
