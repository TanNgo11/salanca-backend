// O6 step 1: alert rules in the plugin store, the aggregation/escalation engine, role-scoped
// recipients and alert routes, and the ops-check job (outbox-stuck + job-heartbeat-missed).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { runOpsCheck } from '../../src/plugins/ordering/dist/server/src/jobs/ops-check.js';
import { runManualPaymentCheck } from '../../src/plugins/ordering/dist/server/src/jobs/manual-confirmation.js';
import {
  seedAdminHttpStaff,
  seedBranches,
  seedMenu,
  systemCtx,
  withApp,
} from './_harness.mjs';

const MINUTE = 60_000;
const owner = `test:${process.pid}`;

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const plugin = app.plugin('ordering');
  const alert = plugin.service('alert');
  const alertRules = plugin.service('alert-rules');
  const alerts = () => app.db.query('plugin::ordering.ops-alert');
  const outboxRows = () => app.db.query('plugin::ordering.outbox');
  const locks = () => app.db.query('plugin::ordering.order-job-lock');
  const capture = plugin.service('registry').notificationProvider('email');
  const coreStore = app.store({ type: 'plugin', name: 'ordering' });
  await coreStore.delete({ key: 'alert-rules' });

  const t0 = new Date('2026-10-12T08:00:00.000Z');
  const at = (minutes) => new Date(t0.getTime() + minutes * MINUTE);
  const ctxAt = (minutes) => ({ actor: { kind: 'system' }, now: at(minutes) });
  const eventsOf = async (type, alertId) =>
    (await outboxRows().findMany({ where: { type, aggregateId: String(alertId) } }));

  await app.listen();

  // User names must be lowercase: the admin login lowercases the email while the stored
  // address keeps the seed name verbatim.
  const ops = await seedAdminHttpStaff(app, {
    actions: ['ops.read'],
    scopes: {
      opsq1: { allLocations: false, locationRefs: ['Q1'] },
      opsall: { allLocations: true },
    },
  });
  const staff = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { nvn1: { allLocations: false, locationRefs: ['Q1'] } },
  });
  const report = await seedAdminHttpStaff(app, {
    actions: ['report.read'],
    scopes: {
      ketoan1: { allLocations: false, locationRefs: ['Q1'] },
      ketoanall: { allLocations: true },
    },
  });
  const settings = await seedAdminHttpStaff(app, {
    actions: ['settings.manage'],
    scopes: { quanly: null },
  });

  try {
    // ── 1. Alert rules ──────────────────────────────────────────────────────────
    const defaults = await alertRules.get();
    assert.equal(defaults['outbox-stuck'].threshold, 10);
    assert.equal(defaults['webhook-failing'].criticalThreshold, 20);
    const unknown = await settings.as.quanly('PUT', '/settings/alert-rules', {
      rules: {
        'not-a-rule': { enabled: true, threshold: 1, aggregationMinutes: 60, recipients: [] },
      },
    });
    assert.equal(unknown.status, 400, 'an unknown alert code must be rejected');
    const edited = await settings.as.quanly('PUT', '/settings/alert-rules', {
      rules: {
        'outbox-stuck': {
          enabled: true,
          threshold: 1,
          criticalThreshold: 60,
          aggregationMinutes: 60,
          recipients: ['ops.read'],
        },
      },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.rules['outbox-stuck'].threshold, 1);
    const changeRows = await app.db
      .query('plugin::ordering.admin-change-log')
      .findMany({ where: { action: 'alert-rules.update' } });
    assert.equal(changeRows.length, 1, 'the rules edit must be change-logged');
    const readBack = await settings.as.quanly('GET', '/settings/alert-rules');
    assert.equal(readBack.status, 200);
    assert.equal(readBack.body.rules['outbox-stuck'].threshold, 1);
    console.log('[ordering-test] alert rules: defaults, 400 on unknown code, PUT + change-log');

    // ── 2. Dedupe: same key opens once, re-opens only bump count ────────────────
    const dedupe = { alertCode: 'payment-unmatched', dedupeKey: 'test:dedupe', aggregateRef: 'provider:test' };
    const first = await alert.open({ ...dedupe, severity: 'warning' }, ctxAt(0));
    assert.equal(first.opened, true);
    assert.equal((await alert.open(dedupe, ctxAt(1))).opened, false);
    assert.equal((await alert.open(dedupe, ctxAt(2))).opened, false);
    const dedupeRow = await alerts().findOne({ where: { dedupeKey: 'test:dedupe' } });
    assert.equal(dedupeRow.count, 3);
    assert.equal((await eventsOf('ops-alert.opened', first.id)).length, 1, 'one email per alert');
    console.log('[ordering-test] dedupe: one row, count 3, one ops-alert.opened event');

    // ── 3. Critical escalation ──────────────────────────────────────────────────
    await alertRules.put(
      {
        'reconciliation-mismatch': {
          enabled: true,
          threshold: 1,
          criticalThreshold: 3,
          aggregationMinutes: 60,
          recipients: ['payment.review'],
        },
      },
      systemCtx,
    );
    const recon = { alertCode: 'reconciliation-mismatch', dedupeKey: 'recon:test', aggregateRef: 'provider:test' };
    const escal = await alert.open(recon, ctxAt(3));
    await alert.open(recon, ctxAt(4));
    const third = await alert.open(recon, ctxAt(5));
    assert.equal(third.escalated, true, 'count 3 reaches criticalThreshold 3');
    assert.equal((await alerts().findOne({ where: { id: escal.id } })).severity, 'critical');
    assert.equal((await eventsOf('ops-alert.escalated', escal.id)).length, 1);
    const fourth = await alert.open(recon, ctxAt(6));
    assert.equal(fourth.escalated, false, 'already critical — no second escalation');
    assert.equal((await eventsOf('ops-alert.escalated', escal.id)).length, 1);
    console.log('[ordering-test] escalation: critical at threshold, single escalated event');

    // ── 4. Acknowledge → bump → resolve → silent reopen → new row after window ──
    const wf = { alertCode: 'webhook-failing', dedupeKey: 'wf:test', aggregateRef: 'provider:test' };
    const a = await alert.open({ ...wf, severity: 'warning' }, ctxAt(0));
    const staffCtx = {
      actor: await plugin.service('scope').actorFromAdminUser(ops.users.opsall),
    };
    const acked = await alert.acknowledge(a.id, staffCtx);
    assert.equal(acked.status, 'acknowledged');
    assert.equal(acked.acknowledgedBy, `admin:${ops.users.opsall.id}`);
    await alert.open(wf, ctxAt(1));
    const afterAck = await alerts().findOne({ where: { id: a.id } });
    assert.equal(afterAck.status, 'acknowledged', 'a bump never un-acknowledges');
    assert.equal(afterAck.count, 2);
    assert.equal((await eventsOf('ops-alert.opened', a.id)).length, 1);
    await alert.resolve('wf:test', ctxAt(2));
    // 5 minutes after resolvedAt: inside the 60-minute aggregation window → reopen silently.
    const reopened = await alert.open(wf, ctxAt(7));
    assert.equal(reopened.id, a.id);
    assert.equal(reopened.opened, false);
    const reopenedRow = await alerts().findOne({ where: { id: a.id } });
    assert.equal(reopenedRow.status, 'open');
    assert.equal(reopenedRow.count, 3);
    assert.equal(reopenedRow.resolvedAt, null);
    assert.equal(reopenedRow.acknowledgedBy, null);
    assert.equal((await eventsOf('ops-alert.opened', a.id)).length, 1, 'reopen sends nothing');
    // Resolve at +8, then open 61 minutes after that resolution → a brand new row + email.
    await alert.resolve('wf:test', ctxAt(8));
    const fresh = await alert.open(wf, ctxAt(69));
    assert.equal(fresh.opened, true);
    assert.notEqual(fresh.id, a.id);
    assert.equal((await eventsOf('ops-alert.opened', fresh.id)).length, 1);
    console.log('[ordering-test] lifecycle: ack keeps dedupe, windowed reopen is silent, late reopen creates');

    // ── 5. Disabled rule records nothing ────────────────────────────────────────
    await alertRules.put(
      {
        'webhook-failing': {
          enabled: false,
          threshold: 5,
          criticalThreshold: 20,
          aggregationMinutes: 60,
          recipients: ['ops.read'],
        },
      },
      systemCtx,
    );
    const disabled = await alert.open(
      { alertCode: 'webhook-failing', dedupeKey: 'wf:disabled', severity: 'warning' },
      ctxAt(10),
    );
    assert.deepEqual(disabled, { id: 0, opened: false, escalated: false });
    assert.equal(await alerts().findOne({ where: { dedupeKey: 'wf:disabled' } }), null);
    await alertRules.put(
      {
        'webhook-failing': {
          enabled: true,
          threshold: 5,
          criticalThreshold: 20,
          aggregationMinutes: 60,
          recipients: ['ops.read'],
        },
      },
      systemCtx,
    );
    console.log('[ordering-test] disabled rule: open() is a no-op');

    // ── 6. Role-based recipients over the outbox ────────────────────────────────
    await runOutboxDispatcher(app, { owner }); // flush events queued by the parts above
    capture.sent.length = 0;
    await alert.open(
      { alertCode: 'outbox-stuck', dedupeKey: 'outbox-stuck', aggregateRef: 'outbox', severity: 'warning' },
      systemCtx,
    );
    await runOutboxDispatcher(app, { owner });
    const opsMails = capture.sent.filter((mail) => mail.template === 'staff.ops-alert');
    assert.equal(opsMails.length, 2, 'both ops.read holders get the alert, no location filter');
    assert.deepEqual(
      opsMails.map((mail) => mail.to).sort(),
      [ops.users.opsq1.email, ops.users.opsall.email].sort(),
    );
    await runOutboxDispatcher(app, { owner });
    assert.equal(
      capture.sent.filter((mail) => mail.template === 'staff.ops-alert').length,
      2,
      'a dispatcher re-run never resends',
    );
    await alert.open(
      {
        alertCode: 'cash-closing-mismatch',
        dedupeKey: 'cc:test',
        aggregateRef: 'cash-closing:Q3:test',
        locationRef: 'Q3',
        severity: 'warning',
      },
      systemCtx,
    );
    await runOutboxDispatcher(app, { owner });
    const allOpsMails = capture.sent.filter((mail) => mail.template === 'staff.ops-alert');
    assert.equal(allOpsMails.length, 3);
    assert.equal(
      allOpsMails[2].to,
      report.users.ketoanall.email,
      'a Q3-scoped report alert skips the Q1-scoped accountant',
    );
    for (const mail of allOpsMails) {
      assert.equal(mail.subject.includes('@example.invalid'), false);
      assert.equal(mail.text.includes('@example.invalid'), false);
      assert.equal(mail.text.includes('Khách'), false, 'no customer PII in alert mail');
    }
    console.log('[ordering-test] recipients: action roles, branch scope filter, dedupe, no PII');

    // ── 7. Role-scoped alert routes ─────────────────────────────────────────────
    const q1Alert = await alert.open(
      {
        alertCode: 'order-awaiting-acceptance',
        dedupeKey: 'order-awaiting-acceptance:9001',
        aggregateRef: 'order:9001',
        locationRef: 'Q1',
        severity: 'warning',
      },
      systemCtx,
    );
    const q3Alert = await alert.open(
      {
        alertCode: 'order-awaiting-acceptance',
        dedupeKey: 'order-awaiting-acceptance:9002',
        aggregateRef: 'order:9002',
        locationRef: 'Q3',
        severity: 'warning',
      },
      systemCtx,
    );
    const denied = await settings.as.quanly('GET', '/alerts?status=open');
    assert.equal(denied.status, 403, 'settings.manage alone grants no alert access');
    const nvn1List = await staff.as.nvn1('GET', '/alerts?status=open');
    assert.equal(nvn1List.status, 200);
    const nvn1Keys = nvn1List.body.rows.map((row) => row.dedupeKey);
    assert.deepEqual(nvn1Keys, ['order-awaiting-acceptance:9001'], 'order.read sees branch alerts in scope only');
    const opsList = await ops.as.opsall('GET', '/alerts?status=open');
    const opsKeys = opsList.body.rows.map((row) => row.dedupeKey);
    assert.ok(opsKeys.includes('order-awaiting-acceptance:9002'));
    assert.ok(opsKeys.includes('outbox-stuck'), 'ops.read sees every open alert');
    const crossAck = await staff.as.nvn1('POST', `/alerts/${q3Alert.id}/acknowledge`);
    assert.equal(crossAck.status, 404, 'out-of-scope acknowledge answers 404');
    const ownAck = await staff.as.nvn1('POST', `/alerts/${q1Alert.id}/acknowledge`);
    assert.equal(ownAck.status, 200);
    assert.equal(ownAck.body.alert.status, 'acknowledged');
    console.log('[ordering-test] routes: role+scope filtering, acknowledge 404 out of scope');

    // ── 8. ops-check: outbox-stuck + job-heartbeat-missed + dispatcher heartbeat ─
    await alert.resolve('outbox-stuck', systemCtx);
    // Age the resolved row out of the 60-minute aggregation window so ops-check opens a new row.
    await alerts().update({
      where: { dedupeKey: 'outbox-stuck' },
      data: { resolvedAt: new Date(Date.now() - 61 * MINUTE) },
    });
    const stuckEvent = await outboxRows().create({
      data: {
        type: 'test.fail',
        aggregateType: 'test',
        aggregateId: `stuck-${randomUUID()}`,
        payload: {},
        uniqueKey: `stuck:${randomUUID()}`,
        occurredAt: new Date(Date.now() - 15 * MINUTE),
        availableAt: new Date(Date.now() - 15 * MINUTE),
        attempts: 0,
      },
    });
    const check1 = await runOpsCheck(app, { owner });
    assert.equal(check1.opened, 1, 'the 15-minute-old pending event opens outbox-stuck');
    const stuckRow = await alerts().findOne({ where: { dedupeKey: 'outbox-stuck', status: 'open' } });
    const check2 = await runOpsCheck(app, { owner });
    assert.equal(check2.opened, 0);
    assert.equal((await alerts().findOne({ where: { id: stuckRow.id } })).count, 2);
    await outboxRows().delete({ where: { id: stuckEvent.id } });
    const check3 = await runOpsCheck(app, { owner });
    assert.equal(check3.resolved, 1);
    assert.equal((await alerts().findOne({ where: { id: stuckRow.id } })).status, 'resolved');

    await locks().create({
      data: {
        jobName: 'hold-expiry',
        shardKey: 'default',
        attempts: 0,
        lastSuccessAt: new Date(Date.now() - 10 * MINUTE),
      },
    });
    // Silence is measured from max(last_success_at, created_at); a freshly created row is never
    // silent, so age the managed created_at column too.
    await app.db
      .connection('plugins_ordering_order_job_lock')
      .where({ job_name: 'hold-expiry' })
      .update({ created_at: new Date(Date.now() - 10 * MINUTE) });
    const check4 = await runOpsCheck(app, { owner });
    assert.equal(check4.opened, 1, '10 silent minutes > 2 cycles of 2 minutes');
    const heartbeat = await alerts().findOne({
      where: { dedupeKey: 'job-heartbeat-missed:hold-expiry' },
    });
    assert.equal(heartbeat.status, 'open');
    assert.equal(heartbeat.aggregateRef, 'job:hold-expiry');
    await locks().update({
      where: { jobName: 'hold-expiry' },
      data: { lastSuccessAt: new Date() },
    });
    const check5 = await runOpsCheck(app, { owner });
    assert.equal(check5.resolved, 1);
    assert.equal(
      (await alerts().findOne({ where: { id: heartbeat.id } })).status,
      'resolved',
      'a fresh success resolves the heartbeat alert',
    );

    await runOutboxDispatcher(app, { owner });
    const outboxLock = await locks().findOne({ where: { jobName: 'outbox' } });
    assert.ok(outboxLock.lastSuccessAt, 'the lock-free dispatcher heartbeats into the same table');
    assert.ok(outboxLock.lastDurationMs !== null);
    console.log('[ordering-test] ops-check: outbox-stuck, heartbeat missed/resolved, dispatcher pulse');

    // ── 9. manual-payment-unconfirmed honours the rule threshold ────────────────
    await alertRules.put(
      {
        'manual-payment-unconfirmed': {
          enabled: true,
          threshold: 1,
          criticalThreshold: 72,
          aggregationMinutes: 60,
          recipients: ['report.read'],
        },
      },
      systemCtx,
    );
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * MINUTE).toISOString();
    const manualEvent = await app.db.query('plugin::ordering.payment-event').create({
      data: {
        providerCode: 'sepay',
        providerTransactionId: `ptx-${randomUUID()}`,
        transferType: 'in',
        amount: '100000',
        currency: 'VND',
        kind: 'manual',
        rawPayload: { transferredAt: twoHoursAgo },
        receivedAt: twoHoursAgo,
        reviewStatus: 'needs-review',
      },
    });
    const manual = await runManualPaymentCheck(app, { owner });
    assert.equal(manual.opened, 1, 'a 2-hour-old manual transfer exceeds the 1-hour rule');
    const manualAlert = await alerts().findOne({
      where: { dedupeKey: `manual-payment-unconfirmed:${manualEvent.id}` },
    });
    assert.equal(manualAlert.status, 'open');
    console.log('[ordering-test] manual-payment-unconfirmed uses the configured threshold');

    console.log('[ordering-test] alerts-engine: all checks passed');
  } finally {
    // The plugin store survives table truncation — restore defaults for sibling scripts.
    await coreStore.delete({ key: 'alert-rules' });
    await ops.cleanup();
    await staff.cleanup();
    await report.cleanup();
    await settings.cleanup();
  }
});
