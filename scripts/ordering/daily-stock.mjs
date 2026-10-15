// Step 3: daily portion limits. A limit of 3 loses exactly one of four parallel
// reserves across two Strapi processes (barrier, same shape as the outbox test).
// Releasing an order twice returns stock once, and `reserved` stays >= 0.
// Step 4: create reserves, quote checks, cancel/reject/expiry and a partial line
// cancel give portions back, the public catalog says sold-out-today, and the
// daily-limit route is 403 without the action and 404 outside the branch scope.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o7 node scripts/ordering/daily-stock.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runPaymentExpiry } from '../../src/plugins/ordering/dist/server/src/jobs/payment-expiry.js';
import {
  basicOrderInput,
  bootOrderingTestApp,
  seedAdminHttpStaff,
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
  const { order, transition, lineCancel, branch, changeLog, dailyStock: daily } = services(app);
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

  const usage = async (entityType, entityDocumentId, businessDate) => {
    const { rows } = await app.db.connection.raw(
      `SELECT COALESCE((
         SELECT reserved FROM plugins_ordering_catalog_daily_usage
         WHERE entity_type = ? AND entity_document_id = ? AND location_ref = 'Q1'
           AND business_date = ?::date
       ), 0) AS reserved`,
      [entityType, entityDocumentId, businessDate],
    );
    return Number(rows[0].reserved);
  };
  const placedAt = '2026-10-12T08:00:00.000Z';
  const stockDate = '2026-10-12';
  const placeOn = (lines, extra = {}) =>
    order.createOrder(
      basicOrderInput({ lines, adjustments: [], placedAt, ...extra }),
      systemCtx,
    );

  await limits().create({
    data: { ...ref('product', 'bun-bo'), locationRef: 'Q1', dailyLimit: 2, updatedByRef: 'ordering-test' },
  });
  const filled = await placeOn([{ sellableUid: 'bun-bo', quantity: 2 }]);
  assert.equal(await usage('product', 'bun-bo', stockDate), 2);

  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}`;
  const catalogOf = async (date) => {
    const response = await fetch(
      `${base}/api/v1/ordering/catalog/products?locale=vi&location=Q1&date=${date}`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    return body.items.find((item) => item.id === 'bun-bo');
  };
  const sold = await catalogOf(stockDate);
  assert.equal(sold.available, false, 'catalog marks the product unavailable');
  assert.equal(sold.unavailableReason, 'sold-out-today');
  assert.deepEqual(sold.dailyLimit, { remaining: 0, date: stockDate });

  await assert.rejects(
    () => order.quote(basicOrderInput({ lines: [{ sellableUid: 'bun-bo', quantity: 1 }], adjustments: [], placedAt }), systemCtx),
    (error) => {
      assert.equal(error.code, 'ITEM_SOLD_OUT');
      assert.equal(error.status, 409);
      assert.equal(error.details.sellableUid, 'bun-bo');
      assert.equal(error.details.entityType, 'product');
      assert.equal(error.details.remaining, 0);
      assert.equal(error.details.businessDate, stockDate);
      return true;
    },
  );
  await assert.rejects(
    () => placeOn([{ sellableUid: 'bun-bo', quantity: 1 }]),
    (error) => error.code === 'ITEM_SOLD_OUT' && error.details.sellableUid === 'bun-bo',
  );
  assert.equal(await usage('product', 'bun-bo', stockDate), 2, 'failed create keeps the ledger');

  await transition.cancelOrder({ orderId: filled.order.order.id, reason: 'khach doi y' }, systemCtx);
  assert.equal(await usage('product', 'bun-bo', stockDate), 0);
  const restored = await catalogOf(stockDate);
  assert.equal(restored.available, true);
  assert.equal(restored.unavailableReason, undefined);
  assert.deepEqual(restored.dailyLimit, { remaining: 2, date: stockDate });

  const rejected = await placeOn([{ sellableUid: 'bun-bo', quantity: 1 }]);
  await transition.transitionGroup(
    {
      orderId: rejected.order.order.id,
      groupId: rejected.order.groups[0].id,
      to: 'rejected',
      reason: 'het mon',
    },
    systemCtx,
  );
  assert.equal(await usage('product', 'bun-bo', stockDate), 0, 'reject returns the portion');

  const partial = await placeOn([{ sellableUid: 'bun-bo', quantity: 2 }]);
  await lineCancel.cancelLineQuantity(
    {
      orderId: partial.order.order.id,
      lineId: partial.order.lines[0].id,
      quantity: 1,
      reason: 'bot mot',
    },
    systemCtx,
  );
  assert.equal(await usage('product', 'bun-bo', stockDate), 1, 'partial cancel returns one');
  const mid = await catalogOf(stockDate);
  assert.equal(mid.available, true);
  assert.equal(mid.dailyLimit.remaining, 1);

  // O-06 (owner decision 2026-10-15): money back and stock back are separate. Once the group left
  // the kitchen the portion is sold and must not return to the shelf, while the refund still
  // settles. A fresh sellable keeps the `bun-bo` ledger above untouched; Q1 gets delivery so a
  // group can reach `out-for-delivery` through its real workflow.
  await app.plugin('ordering').service('registry').catalogAdapter('test-catalog').seed([
    {
      ref: { uid: 'bun-bo-giao' },
      productType: 'test-food',
      title: 'Bún bò giao',
      listPrice: { amount: 100000, currency: 'VND' },
      requiresShipping: false,
      isVirtual: false,
      isDownloadable: false,
      isGiftCard: false,
      fulfillmentKinds: ['pickup', 'delivery'],
      options: [],
      availability: {},
      categories: [{ ref: 'mon-chinh', title: 'Món chính', path: ['mon-chinh'] }],
      isActive: true,
      purchasable: true,
    },
  ]);
  await limits().create({
    data: { ...ref('product', 'bun-bo-giao'), locationRef: 'Q1', dailyLimit: 2, updatedByRef: 'ordering-test' },
  });
  const q1Row = await app.db.query('plugin::ordering.branch').findOne({ where: { code: 'Q1' } });
  await app.db.query('plugin::ordering.branch').update({
    where: { id: q1Row.id },
    data: {
      fulfillment: {
        ...q1Row.fulfillment,
        delivery: {
          enabled: true,
          orderTiming: 'both',
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          minOrderAmount: 0,
          schedule: {
            leadTimeMinutes: 60,
            slotLengthMinutes: 15,
            capacity: 8,
            openingHours: { mode: '24_7' },
          },
          zones: [
            {
              code: 'near',
              label: 'Gần',
              priority: 10,
              match: { kind: 'commune', communeCodes: ['XT01002'] },
              rules: [{ when: 'any', fee: 0 }],
            },
          ],
        },
      },
    },
  });
  const shipped = await order.createOrder(
    basicOrderInput({
      lines: [{ sellableUid: 'bun-bo-giao', quantity: 2 }],
      adjustments: [],
      placedAt,
      receiveMethod: {
        kind: 'delivery',
        address: {
          communeCode: 'XT01002',
          line1: '12 Đường Thử',
          recipientName: 'Người Thử',
          phone: '0901234567',
        },
      },
    }),
    systemCtx,
  );
  assert.equal(await usage('product', 'bun-bo-giao', stockDate), 2, 'the delivery order holds both portions');
  for (const to of ['preparing', 'ready', 'out-for-delivery']) {
    await transition.transitionGroup(
      { orderId: shipped.order.order.id, groupId: shipped.order.groups[0].id, to },
      systemCtx,
    );
  }
  const handedOff = await lineCancel.cancelLineQuantity(
    {
      orderId: shipped.order.order.id,
      lineId: shipped.order.lines[0].id,
      quantity: 1,
      reason: 'khach bao thieu mot phan',
    },
    systemCtx,
  );
  assert.equal(handedOff.restocked, false, 'a portion that left the kitchen is not put back');
  assert.equal(await usage('product', 'bun-bo-giao', stockDate), 2, 'the sold portion stays sold');
  assert.equal(handedOff.order.lines[0].canceledQuantity, 1, 'the cancel itself still happened');
  const afterHandOff = [
    ...(await daily.remaining('Q1', stockDate, [ref('product', 'bun-bo-giao')])).values(),
  ][0];
  assert.equal(afterHandOff.remaining, 0, 'the shelf does not refill after hand-off');

  const branchRow = await app.db.query('plugin::ordering.branch').findOne({ where: { code: 'Q1' } });
  const pickup = branch.pickupSettings(branchRow);
  const slotNow = new Date('2026-10-20T03:00:00.000Z');
  const slots = await app.plugin('ordering').service('pickup-scheduling').listSlots({
    branch: branchRow,
    settings: pickup,
    date: '2026-10-24',
    leadTimeMinutes: pickup.schedule.leadTimeMinutes,
    now: slotNow,
  });
  const noon = slots.find((slot) => slot.localStart === '12:00' && slot.available);
  assert.ok(noon, `saturday noon missing: ${slots.slice(0, 6).map((slot) => slot.localStart).join(',')}`);
  const saturday = await order.createOrder(
    basicOrderInput({
      lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
      adjustments: [],
      placedAt: slotNow.toISOString(),
      payment: { providerCode: 'cash' },
      pickup: { slot: { startsAt: noon.startsAt } },
    }),
    { actor: { kind: 'system' }, now: slotNow },
  );
  assert.equal(await usage('product', 'bun-bo', '2026-10-24'), 1, 'saturday slot reserves saturday');
  assert.equal(String(saturday.order.order.businessDate).slice(0, 10), '2026-10-20');
  assert.equal(await usage('product', 'bun-bo', stockDate), 1, 'saturday does not touch monday');

  await limits().create({
    data: { ...ref('product', 'tra-dao'), locationRef: 'Q1', dailyLimit: 5, updatedByRef: 'ordering-test' },
  });
  await order.createOrder(
    basicOrderInput({
      lines: [{ sellableUid: 'tra-dao', quantity: 1 }],
      adjustments: [],
      placedAt: '2026-10-13T20:59:00.000Z',
    }),
    systemCtx,
  );
  assert.equal(await usage('product', 'tra-dao', '2026-10-13'), 1, '03:59 belongs to the previous business day');
  assert.equal(await usage('product', 'tra-dao', '2026-10-14'), 0);
  await order.createOrder(
    basicOrderInput({
      lines: [{ sellableUid: 'tra-dao', quantity: 1 }],
      adjustments: [],
      placedAt: '2026-10-13T21:00:00.000Z',
    }),
    systemCtx,
  );
  assert.equal(await usage('product', 'tra-dao', '2026-10-14'), 1, '04:00 belongs to the new business day');

  await limits().create({
    data: { ...ref('modifier', 'lon'), locationRef: 'Q1', dailyLimit: 1, updatedByRef: 'ordering-test' },
  });
  const topped = {
    lines: [{ sellableUid: 'bun-bo', quantity: 1, selected: [{ groupUid: 'size', optionUid: 'lon', quantity: 1 }] }],
    adjustments: [],
    placedAt: '2026-11-02T06:00:00.000Z',
  };
  await order.createOrder(basicOrderInput(topped), systemCtx);
  assert.equal(await usage('modifier', 'lon', '2026-11-02'), 1);
  await assert.rejects(
    () => order.createOrder(basicOrderInput(topped), systemCtx),
    (error) =>
      error.code === 'ITEM_SOLD_OUT' &&
      error.details.entityType === 'modifier' &&
      error.details.modifierUid === 'lon',
  );

  await limits().create({
    data: { ...ref('product', 'goi-cuon'), locationRef: 'Q1', dailyLimit: 1, updatedByRef: 'ordering-test' },
  });
  const branches = app.db.query('plugin::ordering.branch');
  const stored = await branches.findOne({ where: { code: 'Q1' } });
  await branches.update({
    where: { id: stored.id },
    data: {
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'prepay',
          paymentProviders: ['cash'],
          paymentTimeoutMinutes: 15,
          schedule: { businessDayPolicy: { cutoffLocalTime: '04:00' } },
        },
      },
    },
  });
  const expiring = await order.createOrder(
    basicOrderInput({
      lines: [{ sellableUid: 'goi-cuon', quantity: 1 }],
      adjustments: [],
      placedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    }),
    systemCtx,
  );
  const expiryDate = String(expiring.order.order.businessDate).slice(0, 10);
  assert.equal(expiring.order.groups[0].status, 'awaiting-payment');
  assert.equal(await usage('product', 'goi-cuon', expiryDate), 1);
  const expired = await runPaymentExpiry(app, { owner: `daily-stock-${process.pid}`, now: new Date() });
  assert.equal(expired.ran, true);
  assert.equal(expired.expired, 1);
  assert.equal(await usage('product', 'goi-cuon', expiryDate), 0, 'payment expiry returns the portion');
  await branches.update({ where: { id: stored.id }, data: { fulfillment: stored.fulfillment } });

  const draft = await order.createOrder(
    basicOrderInput({
      lines: [{ sellableUid: 'goi-cuon', quantity: 1 }],
      adjustments: [],
      origin: { kind: 'staff-draft' },
    }),
    systemCtx,
  );
  const draftDate = String(draft.order.order.businessDate).slice(0, 10);
  assert.equal(await usage('product', 'goi-cuon', draftDate), 0, 'a draft does not reserve');
  await order.confirmDraft(draft.order.order.id, systemCtx);
  assert.equal(await usage('product', 'goi-cuon', draftDate), 1, 'confirming the draft reserves');

  const product = await app.documents('plugin::ordering.catalog-product').create({
    data: {
      productType: 'food',
      status: 'active',
      sellOnline: true,
      fulfillmentKinds: ['pickup'],
      name: { vi: 'Cơm phần' },
    },
  });
  const denied = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { xem: { allLocations: true, locationRefs: [] } },
  });
  const allowed = await seedAdminHttpStaff(app, {
    actions: ['catalog.toggle-availability'],
    scopes: { lan: { allLocations: false, locationRefs: ['Q1'] } },
  });
  try {
    const forbidden = await denied.as.xem('PUT', '/availability/daily-limit', {
      locationRef: 'Q1',
      entityType: 'product',
      entityDocumentId: product.documentId,
      dailyLimit: 4,
    });
    assert.equal(forbidden.status, 403, 'missing catalog.toggle-availability is 403');
    const outside = await allowed.as.lan('PUT', '/availability/daily-limit', {
      locationRef: 'Q3',
      entityType: 'product',
      entityDocumentId: product.documentId,
      dailyLimit: 4,
    });
    assert.equal(outside.status, 404);
    assert.equal(outside.body.error.code, 'BRANCH_NOT_FOUND');
    const saved = await allowed.as.lan('PUT', '/availability/daily-limit', {
      locationRef: 'Q1',
      entityType: 'product',
      entityDocumentId: product.documentId,
      dailyLimit: 4,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.item.dailyLimit, 4);
    const listed = await allowed.as.lan('GET', '/availability?locationRef=Q1');
    const row = listed.body.items.find((item) => item.entityDocumentId === product.documentId);
    assert.equal(row.dailyLimit, 4);
    assert.equal(row.reservedToday, 0);
    assert.equal(row.remainingToday, 4);
    const cleared = await allowed.as.lan('PUT', '/availability/daily-limit', {
      locationRef: 'Q1',
      entityType: 'product',
      entityDocumentId: product.documentId,
      dailyLimit: null,
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.item.dailyLimit, null);
    const logs = await changeLog.list({ entityType: 'catalog-daily-limit', limit: 10 });
    assert.ok(logs.some((entry) => entry.action === 'catalog.daily-limit' && entry.locationRef === 'Q1'));
  } finally {
    await denied.cleanup();
    await allowed.cleanup();
  }

  console.log('[ordering-test] daily stock: atomic reserve, release once, reserved stays >= 0');
  console.log('[ordering-test] daily stock: orders, catalog, cancel, and the limit screen');
});
