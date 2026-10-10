// Step 12: two-process outbox delivery. Parent enqueues 500 `test.ping` events and spawns
// two independent Strapi processes claiming the same queue; worker B kills itself mid-run
// leaving its lease behind, a third process reclaims after the lease expires, and a
// `test.fail` batch exercises backoff → failed_at. Run: node scripts/ordering/outbox-two-process.mjs
// (children: `worker <owner> [crash-after=<n>]`).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  bootOrderingTestApp,
  configureTestEnvironment,
  resetOrderingTables,
  services,
  systemCtx,
  TEST_DATABASE,
  withApp,
} from './_harness.mjs';

const [, , mode, owner, crashAfterArg] = process.argv;
const FILE = fileURLToPath(import.meta.url);

if (mode === 'worker') {
  // Child mode: own Strapi instance, no truncation — just claim and deliver.
  const crashAfter = Number(crashAfterArg?.split('=')[1] ?? 0);
  const app = await bootOrderingTestApp();
  const { outbox } = services(app);
  let batches = 0;
  const result = await outbox.dispatch({
    owner,
    leaseSeconds: 3,
    batchSize: 10,
    maxBatches: 100,
    beforeDeliver: () => {
      batches += 1;
      if (crashAfter > 0 && batches >= crashAfter) {
        console.error(`[ordering-test] worker ${owner} crashing after batch ${batches}`);
        process.exit(1);
      }
    },
  });
  console.log(`[ordering-test] worker ${owner} done`, result);
  await app.destroy();
  process.exit(0);
}

const runWorker = (workerOwner, extra = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FILE, 'worker', workerOwner, ...extra], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let stderr = '';
    child.stdout.on('data', (data) => process.stdout.write(`  [${workerOwner}] ${data}`));
    child.stderr.on('data', (data) => {
      stderr += data;
      process.stderr.write(`  [${workerOwner}!] ${data}`);
    });
    child.on('exit', (code, signal) => resolve({ code, signal, stderr }));
    child.on('error', reject);
  });

withApp(async (app) => {
  const { outbox } = services(app);
  const db = app.db.connection;

  await db.raw('DROP TABLE IF EXISTS ordering_test_delivery_log');
  await db.raw(`CREATE TABLE ordering_test_delivery_log (
      event_id integer PRIMARY KEY,
      owner text NOT NULL,
      delivered_at timestamptz NOT NULL DEFAULT now()
    )`);

  // 500 events enqueued transactionally like a business mutation would.
  const EVENTS = 500;
  await app.db.transaction(async () => {
    for (let index = 0; index < EVENTS; index += 1) {
      await outbox.enqueue(
        {
          type: 'test.ping',
          aggregateType: 'test',
          aggregateId: `evt-${index}`,
          payload: { index },
          uniqueKey: `test.ping:${index}`,
        },
        systemCtx,
      );
    }
  });
  console.log(`[ordering-test] enqueued ${EVENTS} test.ping events`);

  configureTestEnvironment(); // children inherit the test env
  const [a, b] = await Promise.all([
    runWorker('A'),
    runWorker('B', ['crash-after=2']),
  ]);
  assert.equal(a.code, 0, `worker A must exit cleanly (got ${a.code})`);
  assert.notEqual(b.code, 0, `worker B must crash (got ${b.code})`);

  const { rows: bLocks } = await db.raw(
    `SELECT count(*)::int AS n FROM plugins_ordering_outbox
       WHERE locked_by = 'B' AND delivered_at IS NULL`,
  );
  assert.ok(bLocks[0].n > 0, 'worker B must leave locked rows behind');
  console.log(`[ordering-test] worker B abandoned ${bLocks[0].n} leased rows`);

  // Wait out the 3 s lease, then a fresh process reclaims the remainder.
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const a2 = await runWorker('A2');
  assert.equal(a2.code, 0, `worker A2 must exit cleanly (got ${a2.code})`);

  const { rows: delivered } = await db.raw(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE attempts > 1)::int AS reclaimed
       FROM plugins_ordering_outbox WHERE delivered_at IS NOT NULL`,
  );
  assert.equal(delivered[0].n, EVENTS, 'every event must be delivered');
  assert.ok(delivered[0].reclaimed > 0, "B's rows must be reclaimed with attempts > 1");
  const { rows: logRows } = await db.raw(
    `SELECT count(*)::int AS n, count(DISTINCT event_id)::int AS d
       FROM ordering_test_delivery_log`,
  );
  assert.equal(logRows[0].n, EVENTS);
  assert.equal(logRows[0].d, EVENTS, 'no duplicate deliveries');
  console.log(
    `[ordering-test] delivered=${delivered[0].n} unique=${logRows[0].d} reclaimed=${delivered[0].reclaimed}`,
  );

  // Backoff: test.fail events retry then park; a forced attempt count drives failed_at.
  await app.db.transaction(async () => {
    for (let index = 0; index < 3; index += 1) {
      await outbox.enqueue(
        {
          type: 'test.fail',
          aggregateType: 'test',
          aggregateId: `fail-${index}`,
          payload: { secret: 'must-never-appear-in-errors' },
          uniqueKey: `test.fail:${index}`,
        },
        systemCtx,
      );
    }
  });
  const first = await outbox.dispatch({ owner: 'parent' });
  assert.equal(first.retried, 3);
  const { rows: retried } = await db.raw(
    `SELECT attempts, last_error, extract(epoch FROM (available_at - now()))::int AS backoff
       FROM plugins_ordering_outbox WHERE type = 'test.fail'`,
  );
  for (const row of retried) {
    assert.equal(row.attempts, 1);
    assert.ok(row.backoff >= 25 && row.backoff <= 35, `backoff ≈30s, got ${row.backoff}`);
    assert.match(row.last_error ?? '', /test\.fail consumer always fails/);
    assert.doesNotMatch(row.last_error ?? '', /must-never-appear/, 'payload must not leak');
  }
  console.log(`[ordering-test] backoff: 3 retried at attempts=1, next run in ~${retried[0].backoff}s`);

  // Jump attempts to maxAttempts-1 and make the rows due: next failure sets failed_at.
  await db.raw(
    `UPDATE plugins_ordering_outbox
        SET attempts = 9, available_at = now() - interval '1 second'
       WHERE type = 'test.fail'`,
  );
  const second = await outbox.dispatch({ owner: 'parent' });
  assert.equal(second.failed, 3);
  const { rows: failed } = await db.raw(
    `SELECT count(*)::int AS n FROM plugins_ordering_outbox
       WHERE type = 'test.fail' AND failed_at IS NOT NULL AND delivered_at IS NULL`,
  );
  assert.equal(failed[0].n, 3);
  const stats = await outbox.pendingStats();
  assert.equal(stats.failed, 3);
  console.log(`[ordering-test] ${TEST_DATABASE}: 3 failed at maxAttempts, pendingStats`, stats);
});
