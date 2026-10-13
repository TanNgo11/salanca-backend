// O9 step 6 — reporting, cash closing, CSV export, the expiry job, sealed-code retention
// and the probing alert. Card money stays separated from food revenue (sold = captured
// payments on digital orders, redeemed = the `gift-card` provider ledger, circulating =
// Σ active balances); cash closing keeps counting `provider_code = 'cash'` only; the export
// shows `•••• last4`; the daily expiry job writes one `expire` ledger row per card and is
// idempotent; sealed plaintext is purged after retention; wrong-code probing opens one
// deduped ops alert that escalates.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.TRUST_PROXY = 'true';

import { runGiftCardExpiry } from '../../src/plugins/ordering/dist/server/src/jobs/gift-card-expiry.js';
import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { runRetention } from '../../src/plugins/ordering/dist/server/src/jobs/retention.js';
import {
  basicOrderInput,
  seedAdminHttpStaff,
  seedBranches,
  seedMenu,
  seedStaff,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const cardSellable = (overrides = {}) => ({
  requiresShipping: false,
  isVirtual: true,
  isDownloadable: false,
  isGiftCard: true,
  fulfillmentKinds: ['digital'],
  options: [],
  availability: {},
  categories: [{ ref: 'the-qua-tang', title: 'Thẻ quà tặng', path: ['the-qua-tang'] }],
  isActive: true,
  purchasable: true,
  ...overrides,
});

const digitalInput = (overrides = {}) => ({
  idempotencyKey: randomUUID(),
  locationRef: 'Q1',
  locale: 'vi',
  lines: [{ sellableUid: 'card-200k', quantity: 1 }],
  receiveMethod: { kind: 'digital', recipientEmail: 'giftee@example.invalid' },
  contact: { name: 'Buyer', phone: '+84900000002' },
  consent: { policyVersion: 'v1', channel: 'web-checkout' },
  payment: { providerCode: 'test' },
  origin: { kind: 'storefront' },
  ...overrides,
});

const foodInput = (giftCardCode, overrides = {}) =>
  basicOrderInput({
    adjustments: [],
    lines: [{ sellableUid: 'bun-bo', quantity: 2 }],
    payment: { providerCode: 'cash', giftCardCode },
    ...overrides,
  });

const knex = (app) => app.db.connection;

withApp(async (app) => {
  const { order, payment, giftCard } = services(app);
  const matching = app.plugin('ordering').service('payment-matching');
  const adminOrders = app.plugin('ordering').service('admin-orders');
  const reports = app.plugin('ordering').service('reports');
  const alertRules = app.plugin('ordering').service('alert-rules');
  const alerts = () => app.db.query('plugin::ordering.ops-alert');
  const cardRow = (id) => app.db.query('plugin::ordering.gift-card').findOne({ where: { id } });
  const ledgerOf = (id) =>
    app.db.query('plugin::ordering.gift-card-ledger').findMany({
      where: { card: { id } },
      orderBy: { id: 'asc' },
    });
  const dispatch = () => runOutboxDispatcher(app, { owner: `test:${process.pid}` });
  await seedBranches(app);
  seedMenu(app);
  await seedStaff(app);
  const branchRows = app.db.query('plugin::ordering.branch');
  const q1 = await branchRows.findOne({ where: { code: 'Q1' } });
  await branchRows.update({
    where: { id: q1.id },
    data: {
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash', 'test'],
          schedule: { businessDayPolicy: { cutoffLocalTime: '04:00' } },
        },
      },
    },
  });
  app.plugin('ordering').service('registry').catalogAdapter('test-catalog').seed([
    cardSellable({
      ref: { uid: 'card-200k' },
      productType: 'gift-card',
      title: 'Thẻ 200k',
      listPrice: { amount: 200000, currency: 'VND' },
    }),
  ]);

  // ── Fixture: 1 digital card sale (200k captured via `test`), the issued card pays a
  // 130k food order in full, plus one fresh manual card still circulating. ──────────────
  const sale = await order.createOrder(digitalInput(), systemCtx);
  const saleOrderId = sale.order.order.id;
  const pay = await payment.createPayment({ orderId: saleOrderId, providerCode: 'test' }, systemCtx);
  await payment.capturePayment(
    { paymentId: pay.id, amount: 200000, providerTransactionId: 'gc-report-1' },
    systemCtx,
  );
  await matching.advanceIfPaid(saleOrderId, systemCtx);
  await dispatch();
  const soldCard = await app.db
    .query('plugin::ordering.gift-card')
    .findOne({ where: { order: { id: saleOrderId } } });
  assert.ok(soldCard?.codeHash, 'sale card minted');

  // A card whose plaintext the script knows pays the 130k food order in full.
  const manual = await app.db.transaction(async ({ trx }) =>
    giftCard.issueInTransaction(trx, { amount: 300000, source: 'manual' }, systemCtx),
  );
  await order.createOrder(foodInput(manual.code), systemCtx);
  const expiring = await app.db.transaction(async ({ trx }) =>
    giftCard.issueInTransaction(trx, { amount: 80000, source: 'manual' }, systemCtx),
  );
  assert.ok(manual.code && expiring.code, 'manual issues return the code once');

  const today = await adminOrders.todayFor('Q1');
  const range = { from: today, to: today, groupBy: 'payment' };
  const report = await reports.sales(range, systemCtx);
  assert.equal(report.summary.giftCards.sold, 200000, 'card sale separated from food revenue');
  assert.equal(report.summary.giftCards.redeemed, 130000, 'gift-card provider captured');
  assert.equal(report.summary.revenue, 330000, 'revenue = food captured + card sales');
  assert.equal(
    report.summary.giftCards.circulating,
    200000 + 170000 + 80000,
    'circulating = Σ active balances (sale card + manual remainder + expiring)',
  );
  const gcRow = report.rows.find((row) => row.key === 'gift-card');
  assert.equal(gcRow.revenue, 130000, 'byProvider gift-card row');
  console.log('[ordering-test] reports: sold/redeemed/circulating separated from food revenue');

  // ── Cash closing counts provider_code='cash' only → today moved card+test money only.
  const closing = await app.plugin('ordering').service('cash-closing').summary('Q1', today, systemCtx);
  const cashExpected = (closing.rows ?? []).reduce((sum, row) => sum + row.systemAmount, 0);
  assert.equal(cashExpected, 0, 'gift-card and test payments never reach the cash closing');
  console.log('[ordering-test] cash closing unchanged by card payments');

  // ── Export CSV: the card column shows `•••• last4` for the redeemed order. ───────────
  await app.listen();
  const staff = await seedAdminHttpStaff(app, {
    actions: ['order.read', 'export', 'report.read'],
    scopes: { quanly: { allLocations: true, locationRefs: [] } },
  });
  const exportRes = await fetch(
    `http://127.0.0.1:${process.env.PORT}/ordering/orders/export?from=${today}&to=${today}&branch=Q1`,
    { headers: { authorization: `Bearer ${await staff.tokenOf('quanly')}` } },
  );
  assert.equal(exportRes.status, 200, 'export must succeed');
  const csv = await exportRes.text();
  assert.ok(csv.includes('"Thẻ quà tặng"'), 'card column in the header');
  assert.ok(csv.includes(`•••• ${manual.last4}`), 'redeemed order shows the masked card');
  assert.ok(!csv.includes(manual.code) && !csv.includes(manual.code.replaceAll('-', '')),
    'no plaintext code in the CSV');
  console.log('[ordering-test] export CSV: masked •••• last4, no plaintext');

  // ── Expiry job: due card → expired + one `expire` row; a rerun writes nothing. ───────
  const past = new Date(Date.now() - 60_000).toISOString();
  await knex(app)('plugins_ordering_gift_card').where({ id: expiring.id }).update({ expires_at: past });
  const first = await runGiftCardExpiry(app, { owner: `test:${process.pid}` });
  assert.equal(first.ran, true);
  assert.equal(first.expired, 1);
  const expiredRow = await cardRow(expiring.id);
  assert.equal(expiredRow.status, 'expired');
  assert.equal(Number(expiredRow.balance), 0);
  const expireLedger = (await ledgerOf(expiring.id)).filter((row) => row.kind === 'expire');
  assert.equal(expireLedger.length, 1, 'one expire ledger row');
  assert.equal(Number(expireLedger[0].amount), -80000);
  // The report bounds expire rows by UTC `created_at`; pin the row inside today's range so
  // the assertion holds whatever the wall clock is (the figure itself is what we verify).
  await knex(app)('plugins_ordering_gift_card_ledger')
    .where({ id: expireLedger[0].id })
    .update({ created_at: `${today}T12:00:00Z` });
  const second = await runGiftCardExpiry(app, { owner: `test:${process.pid}` });
  assert.equal(second.expired, 0, 'rerun is a no-op');
  assert.equal((await ledgerOf(expiring.id)).filter((row) => row.kind === 'expire').length, 1);
  const after = await reports.sales(range, systemCtx);
  assert.equal(after.summary.giftCards.circulating, 370000, 'expired balance left circulation');
  assert.equal(after.summary.giftCards.expired, 80000, 'expired write-off inside the range');
  console.log('[ordering-test] gift-card-expiry: expire row once, idempotent, circulating updated');

  // ── Retention: sealed plaintext dies after sealedCodeHours; the hash survives. ───────
  const sealedBefore = await knex(app)('plugins_ordering_gift_card')
    .whereNotNull('sealed_code')
    .count('* as n')
    .first();
  assert.ok(Number(sealedBefore.n) >= 2, 'issued cards still sealed');
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  await knex(app)('plugins_ordering_gift_card')
    .whereNotNull('sealed_code')
    .update({ issued_at: old });
  const retention = await runRetention(app, { owner: `test:${process.pid}` });
  assert.equal(retention.ran, true);
  assert.ok(retention.sealsPurged >= 2, 'seals purged');
  const sealedAfter = await knex(app)('plugins_ordering_gift_card')
    .whereNotNull('sealed_code')
    .count('* as n')
    .first();
  assert.equal(Number(sealedAfter.n), 0, 'no sealed code left');
  const hashKept = await cardRow(expiring.id);
  assert.ok(hashKept.codeHash && hashKept.last4, 'hash + last4 kept after the purge');
  console.log('[ordering-test] retention: sealed code purged, HMAC + last4 kept');

  // ── Probing alert: low thresholds via the rules store; wrong codes open one alert
  // that bumps and escalates to critical. ─────────────────────────────────────────────
  await alertRules.put(
    {
      'gift-card-probing': {
        enabled: true,
        threshold: 5,
        criticalThreshold: 8,
        aggregationMinutes: 60,
        recipients: ['ops.read'],
      },
    },
    systemCtx,
  );
  console.log('[ordering-test] probing rule:', JSON.stringify(await alertRules.ruleOf('gift-card-probing')));
  const ip = { 'x-forwarded-for': '203.0.113.77' };
  const probe = () =>
    fetch(`http://127.0.0.1:${process.env.PORT}/api/v1/ordering/gift-cards/balance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...ip },
      // The test captcha accepts 'pass' — past 3 failures every probe must carry it.
      body: JSON.stringify({ code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', captchaToken: 'pass' }),
    });
  const firstProbe = await probe();
  console.log('[ordering-test] probe response:', firstProbe.status, JSON.stringify(await firstProbe.json()));
  for (let i = 0; i < 9; i += 1) await probe();
  const allProbing = await alerts().findMany({ where: { alertCode: 'gift-card-probing' } });
  console.log('[ordering-test] probing rows:', JSON.stringify(allProbing.map((r) => ({ k: r.dedupeKey, s: r.severity, c: r.count }))));
  const probing = allProbing.filter((row) => row.dedupeKey === 'gift-card-probing:203.0.113.77');
  assert.equal(probing.length, 1, 'one deduped alert per IP');
  assert.equal(probing[0].severity, 'critical', 'escalated once attempts passed criticalThreshold');
  assert.ok(probing[0].count >= 6, 'attempts ≥ threshold bumped the live alert');
  console.log('[ordering-test] probing alert: opens once, bumps, escalates to critical');

  console.log('[ordering-test] gift-card-report: all step-6 assertions passed');
});
