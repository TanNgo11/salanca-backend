// O6 step 2: the ops status board (GET /ops/status), manual job runs and outbox retry.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { seedAdminHttpStaff, seedBranches, seedMenu, withApp } from './_harness.mjs';

const owner = `test:${process.pid}`;

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const plugin = app.plugin('ordering');
  const outboxRows = () => app.db.query('plugin::ordering.outbox');

  await app.listen();

  // Lowercase names: the admin login lowercases the email the seed stores verbatim.
  const ops = await seedAdminHttpStaff(app, {
    actions: ['ops.read'],
    scopes: { opsuser: null },
  });
  const staff = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { nvn: null },
  });

  try {
    // ── Permission gate ─────────────────────────────────────────────────────────
    const denied = await staff.as.nvn('GET', '/ops/status');
    assert.equal(denied.status, 403, 'order.read alone must not see the ops board');

    // ── Status shape ────────────────────────────────────────────────────────────
    const first = await ops.as.opsuser('GET', '/ops/status');
    assert.equal(first.status, 200);
    const body = first.body;
    for (const key of ['now', 'outbox', 'webhooks', 'reconciliation', 'alerts', 'jobs', 'failedOutbox']) {
      assert.ok(key in body, `status must carry ${key}`);
    }
    assert.equal(typeof body.outbox.pending, 'number');
    assert.equal(body.outbox.thresholdMinutes, 10, 'default outbox-stuck threshold');
    assert.equal(body.outbox.stuck, false);
    assert.equal(body.reconciliation.enabled, true, 'sepay provider is registered in tests');
    const jobNames = body.jobs.map((job) => job.name);
    for (const name of [
      'outbox',
      'hold-expiry',
      'idempotency-cleanup',
      'sla-check',
      'sepay-reconciliation',
      'payment-expiry',
      'manual-payment-check',
      'ops-check',
    ]) {
      assert.ok(jobNames.includes(name), `jobs must list ${name}`);
    }
    const outboxJob = body.jobs.find((job) => job.name === 'outbox');
    assert.equal(outboxJob.runnable, true);
    console.log('[ordering-test] ops status: shape, permissions, job list');

    // ── Failed outbox row: listed, retried once, then 409 ────────────────────────
    const failed = await outboxRows().create({
      data: {
        type: 'test.fail',
        aggregateType: 'test',
        aggregateId: `fail-${randomUUID()}`,
        payload: { probe: true },
        uniqueKey: `retry:${randomUUID()}`,
        occurredAt: new Date(Date.now() - 60_000),
        availableAt: new Date(Date.now() - 60_000),
        attempts: 10,
        failedAt: new Date(),
        lastError: 'consumer exploded',
      },
    });
    const withFailed = await ops.as.opsuser('GET', '/ops/status');
    const listed = withFailed.body.failedOutbox.find((row) => row.id === failed.id);
    assert.ok(listed, 'the failed row must appear in failedOutbox');
    assert.equal(listed.attempts, 10);
    assert.equal(listed.lastError, 'consumer exploded');

    const retried = await ops.as.opsuser('POST', `/ops/outbox/${failed.id}/retry`);
    assert.equal(retried.status, 200);
    assert.equal(retried.body.id, failed.id);
    assert.ok(retried.body.availableAt);
    const afterRetry = await outboxRows().findOne({ where: { id: failed.id } });
    assert.equal(afterRetry.failedAt, null);
    assert.equal(afterRetry.attempts, 0);
    assert.equal(afterRetry.lockedBy, null);

    const again = await ops.as.opsuser('POST', `/ops/outbox/${failed.id}/retry`);
    assert.equal(again.status, 409, 'a pending row cannot be retried');
    const missing = await ops.as.opsuser('POST', '/ops/outbox/999999/retry');
    assert.equal(missing.status, 404);
    console.log('[ordering-test] outbox retry: 200 once, 409 pending, 404 missing');

    // ── Run a job now ───────────────────────────────────────────────────────────
    const ran = await ops.as.opsuser('POST', '/ops/jobs/sla-check/run');
    assert.equal(ran.status, 200);
    assert.equal(ran.body.name, 'sla-check');
    assert.equal(ran.body.result.ran, true);
    const unknown = await ops.as.opsuser('POST', '/ops/jobs/khong-co/run');
    assert.equal(unknown.status, 404);
    const logs = await app.db.query('plugin::ordering.admin-change-log').findMany({
      where: { action: { $in: ['ops.job-run', 'ops.outbox-retry'] } },
    });
    assert.equal(logs.filter((row) => row.action === 'ops.job-run').length, 1);
    assert.equal(logs.filter((row) => row.action === 'ops.outbox-retry').length, 1);
    console.log('[ordering-test] run-now: sla-check ran, unknown name 404, change-logged');

    // ── Retry actually re-delivers: consumer throws → attempts climb again ──────
    plugin.service('registry').registerOutboxConsumer('test.fail', async () => {
      throw new Error('still broken');
    });
    await runOutboxDispatcher(app, { owner });
    const reFailed = await outboxRows().findOne({ where: { id: failed.id } });
    assert.ok(reFailed.attempts >= 1, 'the retried row is claimed and fails again');
    await outboxRows().delete({ where: { id: failed.id } });

    const afterDispatch = await ops.as.opsuser('GET', '/ops/status');
    const outboxAfter = afterDispatch.body.jobs.find((job) => job.name === 'outbox');
    assert.ok(outboxAfter.lastSuccessAt, 'dispatcher heartbeat reaches the job table');
    assert.ok(outboxAfter.lastDurationMs !== null);
    console.log('[ordering-test] dispatcher retry: attempts climb, outbox heartbeat visible');

    console.log('[ordering-test] ops-status: all checks passed');
  } finally {
    await ops.cleanup();
    await staff.cleanup();
  }
});
