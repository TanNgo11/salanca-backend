import assert from 'node:assert/strict';

import { runDataRequestWaiting } from '../../src/plugins/ordering/dist/server/src/jobs/data-request-waiting.js';
import { withApp } from './_harness.mjs';

// Core gaps step 7: a Decree 13 request still received/waiting past `dataRights.deadlineHours`
// holds one `data-request-overdue` alert (warning, per request); the alert closes by itself once
// the request is done or rejected. Alerts are keyed by the request's documentId and never carry
// the phone number.
withApp(async (app) => {
  const requests = () => app.db.query('plugin::ordering.data-request');
  const alerts = () => app.db.query('plugin::ordering.ops-alert');
  const hours = (count) => new Date(Date.now() - count * 3_600_000);
  const deadline = app.config.get('plugin::ordering').dataRights.deadlineHours;
  assert.equal(deadline, 72, 'default deadline');

  const make = (data) =>
    requests().create({
      data: { phoneHash: `hash-${Math.random()}`, kind: 'export', source: 'staff', status: 'received', ...data },
    });
  const late = await make({ requestedAt: hours(80) });
  const lateWaiting = await make({ requestedAt: hours(73), status: 'waiting' });
  const fresh = await make({ requestedAt: hours(10) });
  const alreadyDone = await make({ requestedAt: hours(200), status: 'done', doneAt: hours(100) });
  const keyOf = (row) => `data-request-overdue:${row.documentId}`;
  const open = async () =>
    (await alerts().findMany({ where: { alertCode: 'data-request-overdue', status: { $in: ['open', 'acknowledged'] } } }))
      .map((row) => row.dedupeKey)
      .sort();

  let job = await runDataRequestWaiting(app, { owner: 'test:overdue' });
  assert.equal(job.ran, true);
  assert.equal(job.overdue, 2, 'only received/waiting past the deadline count');
  assert.deepEqual(await open(), [keyOf(late), keyOf(lateWaiting)].sort());
  const row = await alerts().findOne({ where: { dedupeKey: keyOf(late) } });
  assert.equal(row.severity, 'warning');
  assert.equal(row.aggregateRef, `data-request:${late.documentId}`);
  assert.equal(row.locationRef, null, 'no branch: visible to all-branch staff only');
  assert.ok(!JSON.stringify(row).includes('hash-'), 'the alert never carries the phone hash');

  // A second run neither duplicates nor resolves anything.
  job = await runDataRequestWaiting(app, { owner: 'test:overdue' });
  assert.equal(job.overdue, 2);
  assert.equal(job.resolved, 0);
  assert.equal((await alerts().findMany({ where: { alertCode: 'data-request-overdue' } })).length, 2, 'one row per request');

  // Handling a request closes its alert on the next run; the other stays.
  await requests().update({ where: { id: late.id }, data: { status: 'done', doneAt: new Date() } });
  job = await runDataRequestWaiting(app, { owner: 'test:overdue' });
  assert.equal(job.resolved, 1);
  assert.deepEqual(await open(), [keyOf(lateWaiting)]);
  assert.equal((await alerts().findOne({ where: { dedupeKey: keyOf(late) } })).status, 'resolved');

  await requests().update({ where: { id: lateWaiting.id }, data: { status: 'rejected' } });
  job = await runDataRequestWaiting(app, { owner: 'test:overdue' });
  assert.equal(job.resolved, 1);
  assert.deepEqual(await open(), []);

  // A request still inside its deadline is never flagged; raising the deadline un-flags.
  const stale = await make({ requestedAt: hours(100) });
  job = await runDataRequestWaiting(app, { owner: 'test:overdue' });
  assert.equal(job.overdue, 1);
  app.config.set('plugin::ordering.dataRights.deadlineHours', 200);
  job = await runDataRequestWaiting(app, { owner: 'test:overdue' });
  assert.equal(job.overdue, 0);
  assert.equal(job.resolved, 1, 'no longer overdue under the longer deadline');
  assert.deepEqual(await open(), []);
  void fresh;
  void alreadyDone;
  void stale;

  console.log('[ordering-test] data-request-overdue: alert per late request, no duplicates, auto-close on done/rejected/deadline verified');
});
