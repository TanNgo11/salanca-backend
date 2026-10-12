// O15: the change-history screen API (filters, scope, detail + same-request rows, actors, CSV
// export) and the after-commit hash chain (fill, verify, tamper → audit-tampered alert).
import assert from 'node:assert/strict';

import { runAuditChain } from '../../src/plugins/ordering/dist/server/src/jobs/audit-chain.js';
import {
  basicOrderInput,
  seedAdminHttpStaff,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const owner = 'audit-log-test';

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  await app.listen();
  const { order } = services(app);
  const knex = app.db.connection;
  const staff = await seedAdminHttpStaff(app, {
    scopes: {
      quanly: { allLocations: false, locationRefs: ['Q1'] },
      nvq3: { allLocations: false, locationRefs: ['Q3'] },
      chuoi: { allLocations: true, locationRefs: [] },
    },
  });
  const noExport = await seedAdminHttpStaff(app, {
    actions: ['audit.read', 'order.read'],
    scopes: { ketoan: { allLocations: true, locationRefs: [] } },
  });
  const noAudit = await seedAdminHttpStaff(app, {
    actions: ['order.read', 'order.process'],
    scopes: { nv: { allLocations: true, locationRefs: [] } },
  });
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const base = `http://127.0.0.1:${process.env.PORT}`;
  const raw = async (token, path) => {
    const res = await fetch(`${base}/ordering${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get('content-type') ?? '', text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) };
  };

  try {
    // Seed history: one Q1 cancel (+ request id), one Q3 transition, one branch-less settings change.
    const q1 = (await order.createOrder(basicOrderInput(), systemCtx)).order;
    const cancel = await staff.as.quanly('POST', `/orders/${q1.order.id}/cancel`, { reasonCode: 'other', note: 'x' });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    const q3 = (
      await order.createOrder(
        basicOrderInput({ locationRef: 'Q3', receiveMethod: { kind: 'pickup', locationRef: 'Q3' } }),
        systemCtx,
      )
    ).order;
    const accept = await staff.as.nvq3('POST', `/orders/${q3.order.id}/transition`, { to: 'preparing' });
    assert.equal(accept.status, 200, JSON.stringify(accept.body));
    const settings = await staff.as.chuoi('GET', '/settings');
    const put = await staff.as.chuoi('PUT', '/settings', { ...settings.body, delayMinutes: [10, 20, 45] });
    assert.equal(put.status, 200, JSON.stringify(put.body));

    // ── Scope ─────────────────────────────────────────────────────────────────
    const q1List = await staff.as.quanly('GET', `/audit-log?from=${today}&to=${today}`);
    assert.equal(q1List.status, 200, JSON.stringify(q1List.body));
    assert.ok(q1List.body.rows.length >= 1);
    assert.ok(q1List.body.rows.every((row) => row.locationRef === 'Q1'), 'Q1 staff sees only Q1 rows');
    const all = await staff.as.chuoi('GET', `/audit-log?from=${today}&to=${today}`);
    assert.ok(all.body.rows.some((row) => row.locationRef === 'Q3'));
    assert.ok(
      all.body.rows.some((row) => row.locationRef === null && row.action === 'settings.update'),
      'allLocations sees branch-less rows',
    );
    const denied = await staff.as.quanly('GET', `/audit-log?branch=Q3&from=${today}&to=${today}`);
    assert.equal(denied.status, 404, 'out-of-scope branch filter answers 404');
    assert.equal((await noAudit.as.nv('GET', '/audit-log')).status, 403, 'audit.read is required');

    // ── Filters ───────────────────────────────────────────────────────────────
    const byOrder = await staff.as.chuoi('GET', `/audit-log?from=${today}&to=${today}&q=${q1.order.code}`);
    assert.ok(byOrder.body.rows.length >= 1 && byOrder.body.rows.every((row) => row.orderId === q1.order.id));
    const cancelRow = byOrder.body.rows.find((row) => row.action === 'order.cancel');
    assert.equal(cancelRow.actionLabel, 'Hủy đơn');
    assert.equal(cancelRow.entityLabel, q1.order.code);
    assert.ok(cancelRow.actorName?.startsWith('quanly'));
    const configRows = await staff.as.chuoi('GET', `/audit-log?from=${today}&to=${today}&category=config`);
    assert.ok(configRows.body.rows.length >= 1 && configRows.body.rows.every((row) => row.category === 'config'));
    const byActor = await staff.as.chuoi(
      'GET',
      `/audit-log?from=${today}&to=${today}&actor=admin:${staff.users.nvq3.id}`,
    );
    assert.ok(byActor.body.rows.every((row) => row.actorRef === `admin:${staff.users.nvq3.id}`));
    const en = await staff.as.chuoi('GET', `/audit-log?from=${today}&to=${today}&action=order.cancel&locale=en`);
    assert.equal(en.body.rows[0].actionLabel, 'Cancel order');
    const badRange = await staff.as.chuoi('GET', '/audit-log?from=2025-01-01&to=2026-12-31');
    assert.equal(badRange.status, 400, 'range over 366 days is refused');
    const badCategory = await staff.as.chuoi('GET', '/audit-log?category=nope');
    assert.equal(badCategory.status, 400);

    // ── Detail + same request; actors ─────────────────────────────────────────
    const detail = await staff.as.chuoi('GET', `/audit-log/${cancelRow.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.entry.id, cancelRow.id);
    assert.ok(Array.isArray(detail.body.related));
    const settingsRow = all.body.rows.find((row) => row.action === 'settings.update');
    assert.equal((await staff.as.quanly('GET', `/audit-log/${settingsRow.id}`)).status, 404, 'branch-less row hidden');
    const actors = await staff.as.chuoi('GET', '/audit-log/actors');
    assert.ok(actors.body.actors.some((actor) => actor.ref === `admin:${staff.users.quanly.id}`));

    // ── CSV export ────────────────────────────────────────────────────────────
    const csv = await raw(await staff.tokenOf('chuoi'), `/audit-log/export?from=${today}&to=${today}`);
    assert.equal(csv.status, 200);
    assert.ok(csv.type.includes('text/csv'));
    assert.ok(csv.text.startsWith('﻿'), 'csv opens with a UTF-8 BOM');
    assert.match(csv.text, /Hủy đơn/);
    const noExportRes = await raw(await noExport.tokenOf('ketoan'), `/audit-log/export?from=${today}&to=${today}`);
    assert.equal(noExportRes.status, 403, 'export also needs the export action');
    console.log('[ordering-test] audit log: scope, filters, detail, actors, csv');

    // ── Hash chain ────────────────────────────────────────────────────────────
    const later = new Date(Date.now() + 120_000);
    const filled = await runAuditChain(app, { owner, now: later });
    assert.equal(filled.ran, true);
    assert.ok(filled.hashed >= 3, `rows get hashed (${filled.hashed})`);
    assert.deepEqual(filled.broken, []);
    const again = await runAuditChain(app, { owner, now: later });
    assert.equal(again.hashed, 0, 'rerun hashes nothing new');
    assert.deepEqual(again.broken, []);

    // Editing a hashed row in the DB breaks its own hash.
    const [{ id: tamperId }] = await knex('plugins_ordering_admin_change_log')
      .whereNotNull('hash')
      .orderBy('id', 'asc')
      .limit(1)
      .select('id');
    await knex('plugins_ordering_admin_change_log')
      .where({ id: tamperId })
      .update({ changes: JSON.stringify({ amount: { before: 1, after: 999999 } }) });
    const tampered = await runAuditChain(app, { owner, now: later });
    assert.ok(tampered.broken.includes(tamperId), 'an edited row fails verification');
    const alertRow = await app.db.query('plugin::ordering.ops-alert').findOne({
      where: { dedupeKey: 'audit-tampered', status: 'open' },
    });
    assert.ok(alertRow, 'audit-tampered alert opened');
    assert.equal(alertRow.severity, 'critical');

    // Deleting a row breaks the link of the row that pointed at it.
    const [victim, next] = await knex('plugins_ordering_admin_change_log')
      .whereNotNull('hash')
      .whereNot({ id: tamperId })
      .orderBy('id', 'asc')
      .limit(2)
      .select('id', 'hash');
    await knex('plugins_ordering_admin_change_log').where({ id: victim.id }).delete();
    const afterDelete = await runAuditChain(app, { owner, now: later });
    const pointer = await knex('plugins_ordering_admin_change_log').where({ prev_hash: victim.hash }).first('id');
    assert.ok(pointer, 'some row linked to the deleted one');
    assert.ok(afterDelete.broken.includes(Number(pointer.id)), 'the orphaned link is reported');
    assert.ok(next, 'fixture had a following row');
    console.log('[ordering-test] audit chain: fill, idempotent rerun, edit and delete detected, alert opened');
  } finally {
    await staff.cleanup();
    await noExport.cleanup();
    await noAudit.cleanup();
  }
});
