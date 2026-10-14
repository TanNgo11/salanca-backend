import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runAutoReject } from '../../src/plugins/ordering/dist/server/src/jobs/auto-reject.js';
import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import {
  basicOrderInput,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

// O12 step 2: groups stuck in `awaiting-acceptance` past the branch's per-kind
// `autoRejectAfterMinutes` are rejected by the auto-reject job — held money is refunded
// (cash settles, transfers stay pending), the customer gets the order-rejected email, and
// re-runs are no-ops. Branches/kinds without a timeout keep waiting.
withApp(async (app) => {
  const { order, transition, payment } = services(app);
  await seedBranches(app);
  seedMenu(app);
  const capture = app.plugin('ordering').service('registry').notificationProvider('email');
  const branchRows = app.db.query('plugin::ordering.branch');
  const q1 = await branchRows.findOne({ where: { code: 'Q1' } });
  await branchRows.update({
    where: { id: q1.id },
    data: {
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash', 'sepay'],
          autoRejectAfterMinutes: 1,
          schedule: { openingHours: { mode: '24_7' } },
        },
        // Delivery stays configured but deliberately without an auto-reject timeout.
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
  const owner = `test:${process.pid}`;
  const placedAt = new Date(Date.now() - 2 * 60_000).toISOString();
  const contact = { name: 'Khách test', phone: '+84900000001', email: 'khach@example.invalid' };

  // Order A — pickup, cash captured: rejection refunds the cash immediately.
  const a = await order.createOrder(
    basicOrderInput({ placedAt, contact, adjustments: [], lines: [{ sellableUid: 'bun-bo', quantity: 1 }] }),
    systemCtx,
  );
  const orderA = a.order.order.id;
  const cashPayment = await payment.createPayment({ orderId: orderA, providerCode: 'cash' }, systemCtx);
  await payment.capturePayment(
    { paymentId: cashPayment.id, amount: cashPayment.requestedAmount, providerTransactionId: 'cash-a' },
    systemCtx,
  );

  // Order B — pickup, transfer (SePay) captured: rejection leaves a pending refund row.
  const b = await order.createOrder(
    basicOrderInput({ placedAt, contact, adjustments: [], lines: [{ sellableUid: 'tra-dao', quantity: 1 }] }),
    systemCtx,
  );
  const orderB = b.order.order.id;
  const transferPayment = await payment.createPayment({ orderId: orderB, providerCode: 'sepay' }, systemCtx);
  await payment.capturePayment(
    {
      paymentId: transferPayment.id,
      amount: transferPayment.requestedAmount,
      providerTransactionId: 'txn-b',
    },
    systemCtx,
  );

  // Order C — delivery at Q1: the kind has no timeout, so the wait is unbounded.
  const c = await order.createOrder(
    basicOrderInput({
      placedAt,
      contact,
      adjustments: [],
      lines: [{ sellableUid: 'goi-cuon', quantity: 1 }],
      receiveMethod: {
        kind: 'delivery',
        locationRef: 'Q1',
        address: { communeCode: 'xt01002', line1: '1 Đường test', recipientName: 'Khách test', phone: '+84900000001' },
      },
    }),
    systemCtx,
  );
  const orderC = c.order.order.id;

  // Order D — pickup but placed just now: the deadline has not passed.
  const d = await order.createOrder(
    basicOrderInput({ contact, adjustments: [], lines: [{ sellableUid: 'goi-cuon', quantity: 1 }] }),
    systemCtx,
  );
  const orderD = d.order.order.id;

  // Two "processes" racing: the job lock admits one; its scan+reject is serialized, so the
  // due orders are rejected exactly once even though both runs saw them.
  const [run1, run2] = await Promise.all([
    runAutoReject(app, { owner }),
    runAutoReject(app, { owner: `${owner}-b` }),
  ]);
  assert.equal(
    [run1, run2].filter((run) => run.ran).length,
    1,
    'the job lock admits exactly one runner',
  );
  const first = run1.ran ? run1 : run2;
  assert.deepEqual({ rejected: first.rejected, skipped: first.skipped }, { rejected: 2, skipped: 0 });

  const aggA = await order.getOrder(orderA, systemCtx);
  assert.equal(aggA.order.status, 'canceled');
  assert.equal(aggA.groups[0].status, 'rejected');
  assert.equal(aggA.order.paymentStatus, 'refunded', 'cash refunded at once');
  const refundsA = await app.db
    .query('plugin::ordering.refund')
    .findMany({ where: { reason: 'no-response' } });
  assert.equal(refundsA.filter((r) => Number(r.amount) === 65000 && r.status === 'settled').length, 1);

  const aggB = await order.getOrder(orderB, systemCtx);
  assert.equal(aggB.order.status, 'canceled');
  assert.equal(aggB.groups[0].status, 'rejected');
  const refundB = (await app.db.query('plugin::ordering.refund').findMany({})).find(
    (r) => r.status === 'pending',
  );
  assert.ok(refundB, 'transfer refund stays pending until staff settle it');
  assert.equal(Number(refundB.amount), 45000);

  const aggC = await order.getOrder(orderC, systemCtx);
  assert.equal(aggC.groups[0].status, 'awaiting-acceptance', 'delivery has no timeout configured');
  const aggD = await order.getOrder(orderD, systemCtx);
  assert.equal(aggD.groups[0].status, 'awaiting-acceptance', 'order inside the window waits');

  // Customer notification rides the normal outbox path.
  await runOutboxDispatcher(app, { owner });
  const rejectedMails = capture.sent.filter((mail) => mail.template === 'customer.order-rejected');
  assert.equal(rejectedMails.length, 2, 'both rejected customers are emailed once');
  assert.ok(rejectedMails.every((mail) => mail.to === 'khach@example.invalid'));

  // Idempotent: a second run rejects nothing and duplicates neither refund nor mail.
  const second = await runAutoReject(app, { owner });
  assert.equal(second.rejected, 0);
  const refundsAfter = await app.db.query('plugin::ordering.refund').findMany({});
  assert.equal(refundsAfter.length, 2, 'no extra refund rows on re-run');
  await runOutboxDispatcher(app, { owner });
  assert.equal(
    capture.sent.filter((mail) => mail.template === 'customer.order-rejected').length,
    2,
    'no duplicate rejection emails',
  );

  // Staff accepting before the deadline is never touched: transition D forward and re-run.
  await transition.transitionGroup(
    { orderId: orderD, groupId: aggD.groups[0].id, to: 'preparing' },
    systemCtx,
  );
  const third = await runAutoReject(app, { owner });
  assert.equal(third.rejected, 0);

  // Order E — prepay at Q3, placed 2 minutes ago but paid only now: the wait is measured from
  // entering awaiting-acceptance, not placedAt, so a late payer is not rejected on arrival.
  const q3 = await branchRows.findOne({ where: { code: 'Q3' } });
  await branchRows.update({
    where: { id: q3.id },
    data: {
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'prepay',
          paymentProviders: ['sepay'],
          autoRejectAfterMinutes: 1,
          schedule: { openingHours: { mode: '24_7' } },
        },
      },
    },
  });
  const e = await order.createOrder(
    basicOrderInput({
      placedAt,
      contact,
      adjustments: [],
      locationRef: 'Q3',
      receiveMethod: { kind: 'pickup', locationRef: 'Q3' },
      lines: [{ sellableUid: 'tra-dao', quantity: 1 }],
    }),
    systemCtx,
  );
  const orderE = e.order.order.id;
  assert.equal(e.order.groups[0].status, 'awaiting-payment');
  const prepayment = await payment.createPayment({ orderId: orderE, providerCode: 'sepay' }, systemCtx);
  await payment.capturePayment(
    { paymentId: prepayment.id, amount: prepayment.requestedAmount, providerTransactionId: 'txn-e' },
    systemCtx,
  );
  // Paid: the group moves on as the SePay matcher does.
  await transition.transitionGroup(
    { orderId: orderE, groupId: e.order.groups[0].id, to: 'awaiting-acceptance' },
    systemCtx,
  );
  assert.equal((await order.getOrder(orderE, systemCtx)).groups[0].status, 'awaiting-acceptance');
  const fourth = await runAutoReject(app, { owner });
  assert.equal(fourth.rejected, 0, 'a late payer gets the full acceptance window');
  assert.equal((await order.getOrder(orderE, systemCtx)).groups[0].status, 'awaiting-acceptance');
  // Backdate the entry into awaiting-acceptance: now the window has passed and the job rejects.
  const entered = (
    await app.db.query('plugin::ordering.order-event').findMany({
      where: { order: orderE, type: 'fulfillment-group.transitioned' },
    })
  ).filter((row) => row.payload?.to === 'awaiting-acceptance');
  assert.equal(entered.length, 1);
  await app.db.query('plugin::ordering.order-event').update({
    where: { id: entered[0].id },
    data: { occurredAt: placedAt },
  });
  const fifth = await runAutoReject(app, { owner });
  assert.equal(fifth.rejected, 1, 'measured from the transition event');
  assert.equal((await order.getOrder(orderE, systemCtx)).groups[0].status, 'rejected');

  console.log(
    '[ordering-test] auto-reject: timeout reject, cash settle, transfer pending, per-kind scope, email, idempotent re-run, late-paid prepay window verified',
  );
});
