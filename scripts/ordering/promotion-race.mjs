// O8 step 4: two Strapi processes race for the last use of a promotion. Round 1: an entered
// code with usageLimit 1 — exactly one order gets it, the other fails PROMOTION_EXHAUSTED.
// Round 2: an automatic promotion with usageLimit 1 — both orders are created, exactly one
// carries the discount. Children: `worker <name> <round>`; each boots, prints READY, waits for
// `go` on stdin (barrier) and prints one RESULT line.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o8 node scripts/ordering/promotion-race.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  basicOrderInput,
  bootOrderingTestApp,
  configureTestEnvironment,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const [, , mode, name, round] = process.argv;
const FILE = fileURLToPath(import.meta.url);
const PLACED_AT = '2026-10-13T04:30:00.000Z';
const PHONES = { A: '+84901220001', B: '+84901220002' };

if (mode === 'worker') {
  const app = await bootOrderingTestApp();
  seedMenu(app);
  const { order } = services(app);
  process.stdout.write('READY\n');
  await new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      if (chunk.includes('go')) resolve();
    });
  });
  process.stdin.destroy();
  let result;
  try {
    const created = await order.createOrder(
      basicOrderInput({
        adjustments: [],
        ...(round === 'code' ? { promotionCode: 'RACE1' } : {}),
        contact: { name: 'Khách đua', phone: PHONES[name] },
        placedAt: PLACED_AT,
      }),
      systemCtx,
    );
    result = { ok: true, orderId: created.order.order.id, adjustment: created.order.order.adjustmentAmount };
  } catch (error) {
    result = { ok: false, code: error.code ?? String(error.message) };
  }
  process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
  await app.destroy();
  process.exit(0);
}

const startWorker = (workerName, workerRound) => {
  const child = spawn(process.execPath, [FILE, 'worker', workerName, workerRound], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  let stdout = '';
  let ready;
  const readyPromise = new Promise((resolve) => {
    ready = resolve;
  });
  child.stdout.on('data', (data) => {
    stdout += data;
    if (stdout.includes('READY')) ready();
  });
  child.stderr.on('data', (data) => process.stderr.write(`  [${workerName}!] ${data}`));
  const exited = new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      ready();
      const line = stdout.split('\n').find((row) => row.startsWith('RESULT '));
      resolve({ code, result: line ? JSON.parse(line.slice(7)) : null });
    });
    child.on('error', reject);
  });
  return { child, ready: readyPromise, exited };
};

const race = async (workerRound) => {
  const workers = [startWorker('A', workerRound), startWorker('B', workerRound)];
  await Promise.all(workers.map((worker) => worker.ready));
  for (const worker of workers) worker.child.stdin.end('go\n');
  const results = await Promise.all(workers.map((worker) => worker.exited));
  for (const row of results) {
    assert.equal(row.code, 0, 'worker exits cleanly');
    assert.ok(row.result, 'worker printed a result');
  }
  return results.map((row) => row.result);
};

const promotion = (overrides) => ({
  name: { vi: 'Đua' },
  kind: 'code',
  discountType: 'amount',
  value: 20000,
  maxDiscount: null,
  target: { kind: 'order', refs: [] },
  minSubtotal: 0,
  locationRefs: null,
  receiveKinds: ['pickup', 'delivery'],
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: null,
  weekdays: [],
  timeRanges: [],
  firstOrderOnly: false,
  usageLimit: 1,
  perCustomerLimit: null,
  stackable: false,
  priority: 1,
  active: true,
  usedCount: 0,
  ...overrides,
});

withApp(async (app) => {
  await seedBranches(app);
  configureTestEnvironment();
  const promotions = app.db.query('plugin::ordering.promotion');
  const redemptions = app.db.query('plugin::ordering.promotion-redemption');

  const coded = await promotions.create({ data: promotion({}) });
  await app.db.query('plugin::ordering.promotion-code').create({
    data: { promotionId: coded.id, code: 'RACE1', usageLimit: null, usedCount: 0, active: true },
  });
  const codeRound = await race('code');
  const winners = codeRound.filter((row) => row.ok);
  assert.equal(winners.length, 1, `exactly one order gets the last use: ${JSON.stringify(codeRound)}`);
  assert.equal(winners[0].adjustment, -20000);
  assert.equal(codeRound.find((row) => !row.ok).code, 'PROMOTION_EXHAUSTED');
  assert.equal((await promotions.findOne({ where: { id: coded.id } })).usedCount, 1);
  assert.equal(await redemptions.count({ where: { promotionId: coded.id } }), 1);
  console.log('[ordering-test] promotion race: entered code with one use went to exactly one order');

  await promotions.update({ where: { id: coded.id }, data: { active: false } });
  const auto = await promotions.create({ data: promotion({ kind: 'auto', name: { vi: 'Tự động đua' } }) });
  const autoRound = await race('auto');
  assert.ok(autoRound.every((row) => row.ok), `both orders are created: ${JSON.stringify(autoRound)}`);
  assert.equal(autoRound.filter((row) => row.adjustment === -20000).length, 1, 'one order discounted');
  assert.equal(autoRound.filter((row) => row.adjustment === 0).length, 1, 'the other at full price');
  assert.equal((await promotions.findOne({ where: { id: auto.id } })).usedCount, 1);
  console.log('[ordering-test] promotion race: automatic promotion with one use discounted exactly one order');
});
