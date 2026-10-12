// Step 3: daily portion limits. A limit of 3 loses exactly one of four parallel
// reserves across two Strapi processes (barrier, same shape as the outbox test).
// Releasing an order twice returns stock once, and `reserved` stays >= 0.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o7 node scripts/ordering/daily-stock.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  basicOrderInput,
  bootOrderingTestApp,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const FILE = fileURLToPath(import.meta.url);
const RACE_DATE = '2026-10-17';
const GROUP_DATE = '2026-10-18';
const isWorker = process.argv[2] === 'worker';

// Each process binds PORT. .env pins 1337 and loadEnvFile will not replace a
// value that is already set, so the parent and each child pick their own.
if (!isWorker) {
  process.env.PORT = String(18100 + (process.pid % 800));
}

const ref = (entityType, entityDocumentId) => ({ entityType, entityDocumentId });

const heldAndReserved = async (app, entityDocumentId, businessDate) => {
  const { rows } = await app.db.connection.raw(
    `SELECT
       (SELECT COALESCE(reserved, 0) FROM plugins_ordering_catalog_daily_usage
        WHERE entity_type = 'product' AND entity_document_id = ? AND location_ref = 'Q1'
          AND business_date = ?::date) AS reserved,
       (SELECT COALESCE(SUM(quantity - released_quantity), 0)
        FROM plugins_ordering_catalog_daily_reservation
        WHERE entity_type = 'product' AND entity_document_id = ? AND location_ref = 'Q1'
          AND business_date = ?::date) AS held`,
    [entityDocumentId, businessDate, entityDocumentId, businessDate],
  );
  return {
    reserved: Number(rows[0].reserved ?? 0),
    held: Number(rows[0].held ?? 0),
  };
};

const assertLedger = async (app, entityDocumentId, businessDate, expected) => {
  const ledger = await heldAndReserved(app, entityDocumentId, businessDate);
  assert.equal(ledger.reserved, expected, `${entityDocumentId} reserved`);
  assert.equal(ledger.held, expected, `${entityDocumentId} reservation sum`);
  assert.ok(ledger.reserved >= 0, `${entityDocumentId} reserved went negative`);
};

if (isWorker) {
  const pairs = process.argv.slice(3).map((part) => {
    const [orderId, lineId] = part.split(':').map(Number);
    return { orderId, lineId };
  });
  const app = await bootOrderingTestApp();
  try {
    const daily = app.plugin('ordering').service('daily-stock');
    process.stdout.write('READY\n');
    await new Promise((resolve) => {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        if (String(chunk).includes('go')) resolve();
      });
    });
    process.stdin.destroy();
    const results = await Promise.all(
      pairs.map(async (pair) => {
        try {
          await app.db.transaction(async ({ trx }) => {
            await daily.reserveInTransaction(trx, {
              orderId: pair.orderId,
              locationRef: 'Q1',
              businessDate: RACE_DATE,
              items: [{ ...ref('product', 'com-ga'), lineId: pair.lineId, quantity: 1 }],
            });
          });
          return { ok: true, orderId: pair.orderId };
        } catch (error) {
          return { ok: false, orderId: pair.orderId, code: error?.code ?? 'ERR' };
        }
      }),
    );
    for (const result of results) console.log(`RESULT ${JSON.stringify(result)}`);
  } finally {
    await app.destroy();
  }
  process.exit(0);
}

const startWorker = (pairs, port) => {
  const child = spawn(
    process.execPath,
    [FILE, 'worker', ...pairs.map((pair) => `${pair.orderId}:${pair.lineId}`)],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(port) },
    },
  );
  let ready;
  const readyPromise = new Promise((resolve) => {
    ready = resolve;
  });
  let stdout = '';
  child.stdout.on('data', (data) => {
    stdout += data;
    if (stdout.includes('READY')) ready();
    process.stdout.write(`  [worker:${port}] ${data}`);
  });
  child.stderr.on('data', (data) => {
    process.stderr.write(`  [worker:${port}!] ${data}`);
  });
  const exited = new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      ready();
      resolve({ code, stdout });
    });
    child.on('error', reject);
  });
  return { child, ready: readyPromise, exited };
};

await withApp(async (app) => {
  const { order, dailyStock: daily } = services(app);
  await seedBranches(app);
  seedMenu(app);
  const limits = () => app.db.query('plugin::ordering.catalog-daily-limit');
  const place = async (lines) => {
    const created = await order.createOrder(
      basicOrderInput({ lines, adjustments: [] }),
      systemCtx,
    );
    return created.order;
  };

  await limits().create({
    data: {
      ...ref('product', 'pho'),
      locationRef: 'Q1',
      dailyLimit: 3,
      updatedByRef: 'ordering-test',
    },
  });
  const limitMap = await daily.limitsFor('Q1', [ref('product', 'pho')]);
  assert.equal([...limitMap.values()][0], 3);

  const grouped = await place([
    { sellableUid: 'bun-bo', quantity: 1 },
    { sellableUid: 'tra-dao', quantity: 1 },
  ]);
  const groupedReserve = await app.db.transaction(({ trx }) =>
    daily.reserveInTransaction(trx, {
      orderId: grouped.order.id,
      locationRef: 'Q1',
      businessDate: GROUP_DATE,
      items: [
        { ...ref('product', 'pho'), lineId: grouped.lines[0].id, quantity: 1 },
        { ...ref('product', 'pho'), lineId: grouped.lines[1].id, quantity: 2 },
      ],
    }),
  );
  assert.equal(groupedReserve[0].quantity, 3);
  assert.equal(groupedReserve[0].usageReserved, 3);
  await assertLedger(app, 'pho', GROUP_DATE, 3);

  await assert.rejects(
    () =>
      app.db.transaction(({ trx }) =>
        daily.reserveInTransaction(trx, {
          orderId: grouped.order.id,
          locationRef: 'Q1',
          businessDate: GROUP_DATE,
          items: [{ ...ref('product', 'pho'), lineId: grouped.lines[0].id, quantity: 1 }],
        }),
      ),
    (error) => {
      assert.equal(error.code, 'ITEM_SOLD_OUT');
      assert.equal(error.status, 409);
      assert.equal(error.details.remaining, 0);
      assert.equal(error.details.entityDocumentId, 'pho');
      assert.equal(error.details.businessDate, GROUP_DATE);
      return true;
    },
  );
  await assertLedger(app, 'pho', GROUP_DATE, 3);

  const firstSlice = await app.db.transaction(({ trx }) =>
    daily.releaseForLine(trx, grouped.lines[1].id, 1),
  );
  assert.equal(firstSlice.released, 1);
  await assertLedger(app, 'pho', GROUP_DATE, 2);
  const secondSlice = await app.db.transaction(({ trx }) =>
    daily.releaseForLine(trx, grouped.lines[1].id, 1),
  );
  assert.equal(secondSlice.released, 1);
  const thirdSlice = await app.db.transaction(({ trx }) =>
    daily.releaseForLine(trx, grouped.lines[1].id, 1),
  );
  assert.equal(thirdSlice.released, 0);
  await assertLedger(app, 'pho', GROUP_DATE, 1);

  const returned = await app.db.transaction(({ trx }) =>
    daily.releaseForOrder(trx, grouped.order.id, 'cancel'),
  );
  assert.equal(returned.released, 1);
  const returnedAgain = await app.db.transaction(({ trx }) =>
    daily.releaseForOrder(trx, grouped.order.id, 'cancel'),
  );
  assert.equal(returnedAgain.released, 0);
  await assertLedger(app, 'pho', GROUP_DATE, 0);

  await assert.rejects(() =>
    app.db.connection.raw(
      `UPDATE plugins_ordering_catalog_daily_usage SET reserved = -1
       WHERE entity_document_id = 'pho' AND business_date = ?::date`,
      [GROUP_DATE],
    ),
  );
  await assertLedger(app, 'pho', GROUP_DATE, 0);

  const open = await place([{ sellableUid: 'bun-bo', quantity: 1 }]);
  const skipped = await app.db.transaction(({ trx }) =>
    daily.reserveInTransaction(trx, {
      orderId: open.order.id,
      locationRef: 'Q1',
      businessDate: GROUP_DATE,
      items: [{ ...ref('product', 'khong-gioi-han'), lineId: open.lines[0].id, quantity: 4 }],
    }),
  );
  assert.equal(skipped.length, 0);
  await assertLedger(app, 'khong-gioi-han', GROUP_DATE, 0);

  await limits().create({
    data: { ...ref('product', 'het'), locationRef: 'Q1', dailyLimit: 0, updatedByRef: 'ordering-test' },
  });
  await assert.rejects(
    () =>
      app.db.transaction(({ trx }) =>
        daily.reserveInTransaction(trx, {
          orderId: open.order.id,
          locationRef: 'Q1',
          businessDate: GROUP_DATE,
          items: [{ ...ref('product', 'het'), lineId: open.lines[0].id, quantity: 1 }],
        }),
      ),
    (error) => error.code === 'ITEM_SOLD_OUT' && error.details.remaining === 0,
  );

  await limits().create({
    data: { ...ref('product', 'com-ga'), locationRef: 'Q1', dailyLimit: 3, updatedByRef: 'ordering-test' },
  });
  const racers = [];
  for (let index = 0; index < 4; index += 1) {
    const placed = await place([{ sellableUid: 'goi-cuon', quantity: 1 }]);
    racers.push({ orderId: placed.order.id, lineId: placed.lines[0].id });
  }
  const workers = [
    startWorker(racers.slice(0, 2), 19110 + (process.pid % 40)),
    startWorker(racers.slice(2), 19210 + (process.pid % 40)),
  ];
  await Promise.all(workers.map((worker) => worker.ready));
  for (const worker of workers) worker.child.stdin.write('go\n');
  const finished = await Promise.all(workers.map((worker) => worker.exited));
  for (const worker of finished) {
    assert.equal(worker.code, 0, 'daily-stock worker failed');
  }
  const results = finished.flatMap((worker) =>
    worker.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith('RESULT '))
      .map((line) => JSON.parse(line.slice('RESULT '.length))),
  );
  assert.equal(results.length, 4);
  assert.equal(results.filter((result) => result.ok).length, 3);
  assert.equal(results.filter((result) => result.code === 'ITEM_SOLD_OUT').length, 1);
  await assertLedger(app, 'com-ga', RACE_DATE, 3);
  const left = await daily.remaining('Q1', RACE_DATE, [ref('product', 'com-ga')]);
  const remaining = [...left.values()][0];
  assert.equal(remaining.dailyLimit, 3);
  assert.equal(remaining.reserved, 3);
  assert.equal(remaining.remaining, 0);

  const winner = results.find((result) => result.ok);
  const once = await app.db.transaction(({ trx }) =>
    daily.releaseForOrder(trx, winner.orderId, 'cancel'),
  );
  assert.equal(once.released, 1);
  const twice = await app.db.transaction(({ trx }) =>
    daily.releaseForOrder(trx, winner.orderId, 'cancel'),
  );
  assert.equal(twice.released, 0);
  await assertLedger(app, 'com-ga', RACE_DATE, 2);

  console.log('[ordering-test] daily stock: atomic reserve, release once, reserved stays >= 0');
});
