import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { runSlaCheck } from '../../src/plugins/ordering/dist/server/src/jobs/sla-check.js';
import { seedBranches, seedMenu, systemCtx, withApp } from './_harness.mjs';

// O3 step 12: an order waiting longer than the branch slaMinutes opens exactly one
// order-awaiting-acceptance alert (re-runs only bump count), the branch gets one email, and the
// alert resolves once staff accept the order.
withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const plugin = app.plugin('ordering');
  const capture = plugin.service('registry').notificationProvider('email');
  const branchRows = app.db.query('plugin::ordering.branch');
  const q1 = await branchRows.findOne({ where: { code: 'Q1' } });
  await branchRows.update({
    where: { id: q1.id },
    data: {
      email: 'q1-staff@example.invalid',
      fulfillment: {
        pickup: {
          enabled: true,
          slaMinutes: 10,
          paymentProviders: ['cash'],
          schedule: { leadTimeMinutes: 30, openingHours: { mode: '24_7' } },
        },
      },
    },
  });
  const { order } = await plugin.service('order').createOrder(
    {
      idempotencyKey: randomUUID(),
      locationRef: 'Q1',
      lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
      receiveMethod: { kind: 'pickup', locationRef: 'Q1' },
      pickup: { asap: true },
      contact: { phone: '0901234567' },
      consent: { policyVersion: 'v1', channel: 'web-checkout' },
      origin: { kind: 'storefront' },
      // Placed 9 minutes ago; the job then runs on the real clock (outbox events must be due).
      placedAt: new Date(Date.now() - 9 * 60_000).toISOString(),
    },
    systemCtx,
  );
  const owner = `test:${process.pid}`;

  const early = await runSlaCheck(app, { owner });
  assert.deepEqual({ opened: early.opened, resolved: early.resolved }, { opened: 0, resolved: 0 });
  await app.db
    .query('plugin::ordering.order')
    .update({ where: { id: order.order.id }, data: { placedAt: new Date(Date.now() - 11 * 60_000) } });
  const late = await runSlaCheck(app, { owner });
  assert.equal(late.opened, 1);
  const again = await runSlaCheck(app, { owner });
  assert.equal(again.opened, 0, 'the same order never opens a second alert');
  const alerts = await app.db.query('plugin::ordering.ops-alert').findMany({});
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].count, 2);
  assert.equal(alerts[0].aggregateRef, `order:${order.order.id}`);

  await runOutboxDispatcher(app, { owner });
  const overdue = capture.sent.filter((mail) => mail.template === 'staff.order-overdue');
  assert.equal(overdue.length, 1, 'branch emailed once');
  assert.match(overdue[0].subject, /chờ nhận quá lâu/);

  await plugin
    .service('transition')
    .transitionGroup({ orderId: order.order.id, groupId: order.groups[0].id, to: 'preparing' }, systemCtx);
  const after = await runSlaCheck(app, { owner });
  assert.equal(after.resolved, 1);
  const resolved = await app.db.query('plugin::ordering.ops-alert').findOne({ where: { id: alerts[0].id } });
  assert.equal(resolved.status, 'resolved');
  console.log('[ordering-test] sla-alerts: open once, dedupe count, branch email, resolve on accept verified');
});
