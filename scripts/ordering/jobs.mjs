// Step 12: job-lock serialization + the three scheduled jobs. Run: node scripts/ordering/jobs.mjs
import assert from 'node:assert/strict';
import { hostname } from 'node:os';

import { runHoldExpiry } from '../../src/plugins/ordering/dist/server/jobs/hold-expiry.js';
import { runIdempotencyCleanup } from '../../src/plugins/ordering/dist/server/jobs/idempotency-cleanup.js';
import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/jobs/outbox-dispatcher.js';
import {
  basicOrderInput,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const owner = () => `${hostname()}:${process.pid}`;

withApp(async (app) => {
  const { order, hold, outbox, jobLock } = services(app);
  await seedBranches(app);
  seedMenu(app);

  // --- job lock: mutual exclusion, expiry re-acquire, error recording ---
  const [first, second] = await Promise.all([
    jobLock.withLock(
      { jobName: 'probe', owner: 'p1', now: new Date(), leaseSeconds: 60 },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'p1-done';
      },
    ),
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jobLock.withLock(
        { jobName: 'probe', owner: 'p2', now: new Date(), leaseSeconds: 60 },
        async () => 'p2-done',
      );
    })(),
  ]);
  const outcomes = [first, second];
  assert.equal(
    outcomes.filter((outcome) => outcome.ran).length,
    1,
    'exactly one contender must run',
  );
  const loser = outcomes.find((outcome) => !outcome.ran);
  assert.equal(loser.reason, 'locked');
  console.log('[ordering-test] job lock: one ran, one {ran:false, locked}');

  // An expired lease is stealable.
  await jobLock.withLock(
    { jobName: 'expiry-probe', owner: 'old', now: new Date(Date.now() - 600_000), leaseSeconds: 1 },
    async () => 'done',
  );
  const lockRows = app.db.query('plugin::ordering.order-job-lock');
  await lockRows.update({
    where: { jobName: 'expiry-probe' },
    data: { expiresAt: new Date(Date.now() - 1000), owner: 'old' },
  });
  const reacquired = await jobLock.withLock(
    { jobName: 'expiry-probe', owner: 'new', now: new Date() },
    async () => 're-acquired',
  );
  assert.deepEqual(reacquired, { ran: true, result: 're-acquired' });

  // A throwing fn records last_error (message only) and frees the lease.
  await assert.rejects(
    jobLock.withLock(
      { jobName: 'err-probe', owner: 'p1', now: new Date() },
      async () => {
        throw new Error('intentional failure — no payload here');
      },
    ),
    /intentional failure/,
  );
  const errRow = await lockRows.findOne({ where: { jobName: 'err-probe' } });
  assert.match(errRow.lastError, /intentional failure/);
  assert.equal(errRow.expiresAt, null);
  assert.equal(errRow.owner, null);
  console.log('[ordering-test] job lock: error recorded, lease freed, expiry re-acquired');

  // --- hold-expiry job: releases only expired open holds, serialized ---
  const created = await order.createOrder(basicOrderInput(), systemCtx);
  const orderId = created.order.order.id;
  await hold.create(
    {
      orderId,
      resourceRef: 'probe-slot',
      quantity: 1,
      expiresAt: new Date(Date.now() - 60_000),
    },
    systemCtx,
  );
  const job1 = await runHoldExpiry(app, { owner: owner() });
  assert.deepEqual(job1, { ran: true, released: 1 });
  const job2 = await runHoldExpiry(app, { owner: owner() });
  assert.deepEqual(job2, { ran: true, released: 0 });
  const holdRow = await app.db.query('plugin::ordering.hold').findOne({
    where: { order: orderId },
  });
  assert.ok(holdRow.releasedAt, 'hold must be released');
  assert.equal(holdRow.releaseReason, 'expired');
  const timelineRows = await app.db
    .query('plugin::ordering.order-event')
    .findMany({ where: { order: orderId, type: 'hold.released' } });
  assert.equal(timelineRows.length, 1);
  console.log('[ordering-test] hold-expiry job: released 1, second run 0, timeline recorded');

  // --- idempotency-cleanup job: deletes expired rows only ---
  const keys = app.db.query('plugin::ordering.idempotency-key');
  const expired = await keys.create({
    data: {
      scope: 'probe',
      key: 'expired',
      requestHash: 'x',
      status: 'completed',
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  const fresh = await keys.create({
    data: {
      scope: 'probe',
      key: 'fresh',
      requestHash: 'y',
      status: 'completed',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  const cleanup = await runIdempotencyCleanup(app, { owner: owner() });
  assert.deepEqual(cleanup, { ran: true, deleted: 1 });
  assert.equal(await keys.findOne({ where: { id: expired.id } }), null);
  assert.ok(await keys.findOne({ where: { id: fresh.id } }), 'fresh row must survive');
  console.log('[ordering-test] idempotency-cleanup job: deleted 1 expired, kept fresh');

  // --- outbox dispatcher job: no lock, drains the queue ---
  await outbox.enqueue(
    {
      type: 'test.ping',
      aggregateType: 'test',
      aggregateId: 'jobs-probe',
      payload: { probe: true },
      uniqueKey: 'jobs:ping',
    },
    systemCtx,
  );
  await app.db.connection.raw(
    'DROP TABLE IF EXISTS ordering_test_delivery_log; ' +
      'CREATE TABLE ordering_test_delivery_log (event_id integer PRIMARY KEY, owner text NOT NULL, delivered_at timestamptz NOT NULL DEFAULT now())',
  );
  const dispatched = await runOutboxDispatcher(app, { owner: owner() });
  // createOrder enqueued `order.created` earlier, so the queue holds 2 events: both must
  // drain (claimed == delivered), and our test.ping must be among them.
  assert.equal(dispatched.delivered, dispatched.claimed);
  assert.ok(dispatched.claimed >= 1);
  const { rows: pingDelivered } = await app.db.connection.raw(
    `SELECT count(*)::int AS n FROM plugins_ordering_outbox
       WHERE type = 'test.ping' AND delivered_at IS NOT NULL`,
  );
  assert.equal(pingDelivered[0].n, 1);
  console.log('[ordering-test] outbox dispatcher job:', dispatched);
});
