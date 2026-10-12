// O6 step 6: the retention job — payment-payload redaction to the allowlist plus
// bounded-batch deletion of aged outbox and resolved-alert rows.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runRetention } from '../../src/plugins/ordering/dist/server/src/jobs/retention.js';
import { seedBranches, withApp } from './_harness.mjs';

const owner = `test:${process.pid}`;
const NOW = new Date('2026-02-01T03:30:00+07:00');
const daysAgo = (days) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

withApp(async (app) => {
  await seedBranches(app);
  const knex = app.db.connection;
  const paymentEvent = () => app.db.query('plugin::ordering.payment-event');
  const outbox = () => app.db.query('plugin::ordering.outbox');
  const alert = () => app.db.query('plugin::ordering.ops-alert');

  await app.listen();

  const event = (days, rawPayload) =>
    paymentEvent().create({
      data: {
        providerCode: 'sepay',
        providerTransactionId: `txn-${randomUUID()}`,
        amount: '175000',
        currency: 'VND',
        kind: 'webhook',
        receivedAt: daysAgo(days),
        rawPayload,
      },
    });
  const mail = (days, column) =>
    outbox().create({
      data: {
        type: 'staff.ops-alert',
        aggregateType: 'ops-alert',
        aggregateId: randomUUID(),
        payload: {},
        uniqueKey: `uk-${randomUUID()}`,
        occurredAt: daysAgo(days),
        availableAt: daysAgo(days),
        attempts: 0,
        [column]: daysAgo(days),
      },
    });
  const resolvedAlert = (days) =>
    alert().create({
      data: {
        alertCode: 'webhook-silent',
        dedupeKey: `retention-test:${randomUUID()}`,
        severity: 'warning',
        status: 'resolved',
        resolvedAt: daysAgo(days),
        firstSeenAt: daysAgo(days + 1),
        lastSeenAt: daysAgo(days),
      },
    });

  try {
    // ── Past-window payload redacts to the allowlist; recent payload untouched ────
    const old = await event(200, {
      id: '1',
      transferAmount: 175000,
      transferType: 'in',
      referenceCode: 'FT1',
      transactionDate: '2025-07-15T10:00:00+07:00',
      content: 'NGUYEN VAN A ck SLC-000001',
      accountNumber: '0123456789',
      description: 'x',
    });
    const fresh = await event(10, { id: '2', referenceCode: 'FT2', content: 'keep me' });

    await mail(40, 'deliveredAt');
    await mail(10, 'deliveredAt');
    await mail(100, 'failedAt');
    await mail(10, 'failedAt');
    await resolvedAlert(100);
    await resolvedAlert(10);

    const first = await runRetention(app, { owner, now: NOW });
    assert.equal(first.ran, true, 'first run must acquire the lock');
    assert.equal(first.redacted, 1, 'only the past-window payload redacts');
    assert.equal(first.outboxDeleted, 2, 'old delivered + old failed rows go');
    assert.equal(first.alertsDeleted, 1, 'only the resolved-alert past window goes');

    const redactedPayload = (
      await knex('plugins_ordering_payment_event').where({ id: old.id }).select('raw_payload')
    )[0].raw_payload;
    const parsed = JSON.parse(redactedPayload);
    assert.equal(parsed.referenceCode, 'FT1', 'referenceCode survives for payment-matching');
    assert.equal(parsed.transferAmount, 175000);
    assert.equal(parsed.id, '1');
    assert.ok(parsed.redactedAt, 'redactedAt stamp present');
    for (const key of ['content', 'accountNumber', 'description']) {
      assert.equal(parsed[key], undefined, `${key} must be redacted`);
    }

    const freshPayload = (
      await knex('plugins_ordering_payment_event').where({ id: fresh.id }).select('raw_payload')
    )[0].raw_payload;
    assert.deepEqual(JSON.parse(freshPayload), {
      id: '2',
      referenceCode: 'FT2',
      content: 'keep me',
    });
    console.log('[ordering-test] retention: payload allowlist + aged rows deleted');

    // ── Idempotent rerun ─────────────────────────────────────────────────────────
    const second = await runRetention(app, { owner, now: NOW });
    assert.equal(second.ran, true);
    assert.deepEqual(
      {
        redacted: second.redacted,
        outboxDeleted: second.outboxDeleted,
        alertsDeleted: second.alertsDeleted,
      },
      { redacted: 0, outboxDeleted: 0, alertsDeleted: 0 },
      'caught-up rerun must be a no-op',
    );
    console.log('[ordering-test] retention: rerun is a no-op');

    // ── Bounded batches: batchSize 1, one batch per run, drains over three runs ──
    await event(200, { id: 'b1', referenceCode: 'B1', content: 'a' });
    await event(200, { id: 'b2', referenceCode: 'B2', content: 'b' });
    await event(200, { id: 'b3', referenceCode: 'B3', content: 'c' });
    app.config.set('plugin::ordering.retention.batchSize', 1);
    app.config.set('plugin::ordering.retention.maxBatchesPerRun', 1);
    for (let run = 0; run < 3; run += 1) {
      const r = await runRetention(app, { owner, now: NOW });
      assert.equal(r.redacted, 1, `run ${run + 1} must redact exactly one row`);
    }
    const drained = await runRetention(app, { owner, now: NOW });
    assert.equal(drained.redacted, 0, 'all old payloads drained after three bounded runs');
    console.log('[ordering-test] retention: bounded batches drain one per run');
  } finally {
    app.config.set('plugin::ordering.retention.batchSize', 500);
    app.config.set('plugin::ordering.retention.maxBatchesPerRun', 20);
  }
});
