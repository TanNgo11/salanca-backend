import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  basicOrderInput,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

withApp(async (app) => {
  const { order } = services(app);
  await seedBranches(app);
  seedMenu(app);

  const key = randomUUID();
  const input = basicOrderInput({ idempotencyKey: key });
  const first = await order.createOrder(input, systemCtx);
  assert.equal(first.replayed, false);
  assert.ok(first.publicToken);

  const second = await order.createOrder({ ...input, idempotencyKey: key }, systemCtx);
  assert.equal(second.replayed, true);
  assert.equal(second.order.order.id, first.order.order.id);
  // contracts §21.10: the replay returns the SAME token (sealed on the idempotency row), so a
  // customer who lost the first response still gets a working link; no plaintext is stored.
  assert.equal(second.publicToken, first.publicToken);
  const row = await app.db.query('plugin::ordering.idempotency-key').findOne({
    where: { scope: 'order.create', key },
  });
  assert.ok(row.resultCipher.startsWith('v1:'), 'token is stored sealed');
  assert.ok(!row.resultCipher.includes(first.publicToken), 'never in plaintext');
  assert.ok(!JSON.stringify(row.responseSnapshot).includes(first.publicToken));
  console.log('[ordering-test] replay returns order', second.order.order.code, 'with the same sealed token');

  await assert.rejects(
    order.createOrder(
      basicOrderInput({ idempotencyKey: key, customerNote: 'different payload' }),
      systemCtx,
    ),
    (error) => error?.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH',
  );
  console.log('[ordering-test] same key + different payload → IDEMPOTENCY_PAYLOAD_MISMATCH');

  const raceKey = randomUUID();
  const raceInput = basicOrderInput({ idempotencyKey: raceKey });
  const outcomes = await Promise.allSettled(
    Array.from({ length: 10 }, () => order.createOrder(raceInput, systemCtx)),
  );
  const codes = new Set();
  let inProgress = 0;
  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') codes.add(outcome.value.order.order.code);
    else if (outcome.reason?.code === 'IDEMPOTENCY_IN_PROGRESS') inProgress += 1;
    else throw outcome.reason;
  }
  const rows = await app.db
    .connection('plugins_ordering_order')
    .whereIn('code', [...codes])
    .select('id');
  const total = await app.db.connection('plugins_ordering_order').count('* as c').first();
  assert.ok(codes.size >= 1, 'at least one call must succeed');
  assert.equal(Number(total.c), 2, 'all races collapse onto one order row');
  console.log(
    `[ordering-test] 10 parallel calls → ${outcomes.length - inProgress} resolved, ` +
      `${inProgress} IDEMPOTENCY_IN_PROGRESS, ${codes.size} distinct code(s), ${total.c} orders total`,
  );
  assert.ok(rows.length >= 1);
});
