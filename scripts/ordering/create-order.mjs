import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import {
  basicOrderInput,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const count = async (app, table) =>
  Number((await app.db.connection(table).count('* as c').first()).c);

withApp(async (app) => {
  const { order } = services(app);
  await seedBranches(app);
  seedMenu(app);
  app.config.set('plugin::ordering.orderCode', { template: '{prefix}-{seq:6}', prefix: 'SLC' });

  const created = await order.createOrder(
    basicOrderInput({ placedAt: '2026-10-10T18:30:00Z' }),
    systemCtx,
  );
  const { order: row, lines, adjustments, groups } = created.order;
  assert.equal(row.status, 'open');
  assert.equal(row.paymentStatus, 'unpaid');
  assert.equal(row.fulfillmentStatus, 'not-started');
  assert.match(row.code, /^SLC-\d{6}$/);
  assert.ok(created.publicToken && /^[A-Za-z0-9_-]{40,}$/.test(created.publicToken));
  assert.equal(
    row.publicTokenHash,
    createHash('sha256').update(created.publicToken).digest('hex'),
  );
  // Fri 18:30Z = Sat 01:30 Asia/Ho_Chi_Minh, before the 04:00 cutoff → business day Fri.
  assert.equal(String(row.businessDate).slice(0, 10), '2026-10-10');
  assert.equal(row.subtotalAmount, 220000);
  assert.equal(row.adjustmentAmount, -25000);
  assert.equal(row.taxAmount, 0);
  assert.equal(row.totalAmount, 195000);
  assert.equal(row.origin.kind, 'storefront');
  assert.equal(row.draftConfirmedAt, null);

  const sorted = [...lines].sort((a, b) => a.position - b.position);
  assert.deepEqual(
    sorted.map((line) => line.discountAmount),
    [-14773, -5114, -5113],
  );
  assert.deepEqual(
    sorted.map((line) => line.lineTotalAmount),
    [115227, 39886, 39887],
  );
  assert.equal(sorted.reduce((sum, line) => sum + line.lineTotalAmount, 0), 195000);
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].kind, 'discount');
  assert.equal(adjustments[0].amount, -25000);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].workflowName, 'pickup-pay-on-pickup');
  assert.equal(groups[0].status, 'awaiting-acceptance');
  console.log('[ordering-test] mockup order', row.code, 'total 195000, allocations -14773/-5114/-5113');

  const events = await app.db.query('plugin::ordering.order-event').findMany({
    where: { order: { id: row.id }, type: 'order.placed' },
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].isPublic, true);
  const outboxRows = await app.db.query('plugin::ordering.outbox').findMany({
    where: { type: 'order.created' },
  });
  assert.equal(outboxRows.length, 1);
  console.log('[ordering-test] timeline order.placed (public) + outbox order.created recorded');

  // 200 parallel orders → 200 distinct sequence-backed codes.
  const batch = await Promise.all(
    Array.from({ length: 200 }, () => order.createOrder(basicOrderInput(), systemCtx)),
  );
  const codes = new Set(batch.map((result) => result.order.order.code));
  assert.equal(codes.size, 200);
  const seqs = batch.map((result) => Number(result.order.order.code.split('-')[1]));
  assert.equal(new Set(seqs).size, 200);
  console.log('[ordering-test] 200 parallel orders → 200 distinct codes (seq range', Math.min(...seqs), 'to', Math.max(...seqs), ')');

  // Failure mid-way → nothing persisted.
  const before = {
    order: await count(app, 'plugins_ordering_order'),
    line: await count(app, 'plugins_ordering_order_line'),
    outbox: await count(app, 'plugins_ordering_outbox'),
    idem: await count(app, 'plugins_ordering_idempotency_key'),
  };
  await assert.rejects(
    order.createOrder(
      basicOrderInput({ lines: [{ sellableUid: 'ghost', quantity: 1 }] }),
      systemCtx,
    ),
    (error) => error?.code === 'SELLABLE_NOT_FOUND',
  );
  assert.equal(await count(app, 'plugins_ordering_order'), before.order);
  assert.equal(await count(app, 'plugins_ordering_order_line'), before.line);
  assert.equal(await count(app, 'plugins_ordering_outbox'), before.outbox);
  assert.equal(await count(app, 'plugins_ordering_idempotency_key'), before.idem);
  console.log('[ordering-test] ghost sellable → SELLABLE_NOT_FOUND, zero new rows');

  await assert.rejects(
    order.createOrder(
      basicOrderInput({ consent: { policyVersion: 'v0', channel: 'web-checkout' } }),
      systemCtx,
    ),
    (error) => error?.code === 'CONSENT_REQUIRED',
  );
  console.log('[ordering-test] wrong policyVersion → CONSENT_REQUIRED');

  // Mixed workflows rejected unless explicitly allowed.
  const mixedLines = [
    { sellableUid: 'bun-bo', quantity: 1 },
    { sellableUid: 'cat-toc', quantity: 1 },
  ];
  await assert.rejects(
    order.createOrder(basicOrderInput({ lines: mixedLines }), systemCtx),
    (error) => error?.code === 'MIXED_WORKFLOW_UNSUPPORTED',
  );
  app.config.set('plugin::ordering.allowMixedProductTypes', true);
  const mixed = await order.createOrder(basicOrderInput({ lines: mixedLines }), systemCtx);
  assert.equal(mixed.order.groups.length, 2);
  assert.deepEqual(
    [...mixed.order.groups]
      .map((group) => `${group.workflowName}@${group.workflowVersion}`)
      .sort(),
    ['pickup-pay-on-pickup@1', 'test-service@1'],
  );
  app.config.set('plugin::ordering.allowMixedProductTypes', false);
  console.log('[ordering-test] mixed workflows blocked, then 2 groups once allowMixedProductTypes');

  // Cash rounding on Q3 (multiple 1000, provider `test`): exact total → no adjustment;
  // +500 fee lands exactly on a half-multiple, and half-away-from-zero rounds up to 196000.
  const exact = await order.createOrder(
    basicOrderInput({
      locationRef: 'Q3',
      receiveMethod: { kind: 'pickup', locationRef: 'Q3' },
      payment: { providerCode: 'test' },
    }),
    systemCtx,
  );
  // Rounding rides on adjustmentAmount (a kind:'rounding' adjustment row), not a column.
  assert.equal(exact.order.order.adjustmentAmount, -25000);
  assert.equal(exact.order.adjustments.some((a) => a.kind === 'rounding'), false);
  assert.equal(exact.order.order.totalAmount, 195000);
  const rounded = await order.createOrder(
    basicOrderInput({
      locationRef: 'Q3',
      receiveMethod: { kind: 'pickup', locationRef: 'Q3' },
      payment: { providerCode: 'test' },
      adjustments: [
        { kind: 'discount', code: 'test-25k', label: 'Giảm test 25k', amount: -25000 },
        { kind: 'fee', code: 'test-fee', label: 'Phí test', amount: 500 },
      ],
    }),
    systemCtx,
  );
  assert.equal(rounded.order.order.adjustmentAmount, -24000);
  assert.equal(rounded.order.order.totalAmount, 196000);
  const roundingAdjustment = rounded.order.adjustments.find((a) => a.kind === 'rounding');
  assert.equal(roundingAdjustment.amount, 500);
  assert.equal(
    rounded.order.lines.reduce((sum, line) => sum + line.lineTotalAmount, 0),
    196000,
  );
  console.log('[ordering-test] cash rounding: 195000 → no-op; +500 fee → +500 rounding → 196000');

  // Staff draft confirms into open.
  const draft = await order.createOrder(
    basicOrderInput({ origin: { kind: 'staff-draft' } }),
    systemCtx,
  );
  assert.equal(draft.order.order.status, 'draft');
  const projection = await order.confirmDraft(draft.order.order.id, systemCtx);
  assert.equal(projection.before.status, 'draft');
  assert.equal(projection.after.status, 'open');
  const confirmed = await order.getOrder(draft.order.order.id, systemCtx);
  assert.ok(confirmed.order.draftConfirmedAt);
  console.log('[ordering-test] staff-draft → draft, confirmDraft →', confirmed.order.code, 'open');
});
