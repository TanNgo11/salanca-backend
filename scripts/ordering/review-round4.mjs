// Real PostgreSQL regressions. Run on salanca_ordering_review_fixes after build:ordering.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withApp, seedBranches, seedMenu, basicOrderInput, services, systemCtx } from './_harness.mjs';
import { deferred, interceptQuery } from './_review-race.mjs';

// Hold the first operation just after its critical read. Start the second on a separate
// backend and observe either its competing read (broken code) or a real lock wait (fixed).
// Always release before asserting; no sleeps and no deadlock hidden by a mock service.
async function contend(app, targets, first, second) {
  const held = deferred(), release = deferred();
  let reads = 0, secondRead = false, secondPid;
  const restores = targets.map(([uid, method, matches]) => interceptQuery(app, uid, method, async (original, args) => {
    const result = await original(args);
    if (matches(args) && reads++ < 2) {
      if (reads === 1) held.resolve(); else secondRead = true;
      await release.promise;
    }
    return result;
  }));
  const run = (operation, isSecond) => app.db.transaction(async ({ trx }) => {
    const { rows } = await trx.raw('SELECT pg_backend_pid() AS pid');
    if (isSecond) secondPid = rows[0].pid;
    return operation();
  });
  const one = run(first, false);
  // Attach rejection handling immediately so failed setup cannot become unhandled.
  const firstOutcome = one.then(value => ({ value }), error => ({ error }));
  let two;
  try {
    await Promise.race([held.promise, firstOutcome.then(result => {
      if (result.error) throw result.error;
      throw new Error('first operation completed without reaching the test barrier');
    })]);
    two = run(second, true);
    const secondOutcome = two.then(value => ({ value }), error => ({ error }));
    const deadline = Date.now() + 15000;
    let blocked = false;
    while (!secondRead && !blocked && Date.now() < deadline) {
      const { rows } = await app.db.connection.raw(
        "SELECT wait_event_type FROM pg_stat_activity WHERE pid = ?", [secondPid ?? -1],
      );
      blocked = rows[0]?.wait_event_type === 'Lock';
    }
    release.resolve();
    const results = await Promise.all([firstOutcome, secondOutcome]);
    assert.ok(secondRead || blocked, 'second operation must reach the competing read or wait for a lock');
    for (const result of results) if (result.error) throw result.error;
    return results.map(result => result.value);
  } finally {
    release.resolve();
    await Promise.allSettled([one, two].filter(Boolean));
    for (const restore of restores.reverse()) restore();
  }
}

await withApp(async app => {
  app.cron.stop();
  await seedBranches(app);
  const plugin = app.plugin('ordering');
  const q = name => app.db.query(`plugin::ordering.${name}`);
  const auth = plugin.service('customer-auth');
  const capture = plugin.service('registry').notificationProvider('email');
  const challenge = async target => {
    const reply = await auth.requestOtp({ channel: 'email', target }, systemCtx);
    const code = capture.sent.at(-1)?.text.match(/\b(\d{6})\b/)?.[1];
    assert.ok(code, 'test notification provider captures the OTP internally');
    return { ...reply, code };
  };
  let failures = 0;
  const test = async (name, fn) => {
    try { await fn(); console.log(`[review-round4] ${name} PASS`); }
    catch (error) { failures++; console.error(`[review-round4] ${name} FAIL: ${error.code ?? error.message}`); }
  };

  await test('one profile for concurrent mailbox signup', async () => {
    const email = 'round4-new@example.invalid';
    const inputs = [await challenge(email), await challenge(email)];
    const values = await contend(app, [
      ['plugin::ordering.customer', 'findOne', args => args.where?.email === email],
    ], () => auth.verifyOtp(inputs[0], systemCtx), () => auth.verifyOtp(inputs[1], systemCtx));
    assert.equal(await q('customer').count({ where: { email } }), 1, 'one mailbox must create one profile');
    assert.equal(values[0].customer.id === values[1].customer.id, true, 'both sessions bind the same profile');
    assert.ok(await auth.resolveSession(values[0].token, systemCtx));
    assert.ok(await auth.resolveSession(values[1].token, systemCtx));
  });

  await test('session cap with parallel verification and standalone issuance', async () => {
    const person = await q('customer').create({ data: { email: 'round4-cap@example.invalid', emailVerifiedAt: new Date(), status: 'active' } });
    const cap = app.config.get('plugin::ordering').customers.maxSessions;
    for (let i = 0; i < cap; i++) await auth.issueSession(person, systemCtx);
    const inputs = [await challenge(person.email), await challenge(person.email)];
    const target = [['plugin::ordering.customer-session', 'findMany', args => args.where?.customer === person.id]];
    await contend(app, target, () => auth.verifyOtp(inputs[0], systemCtx), () => auth.verifyOtp(inputs[1], systemCtx));
    const live = () => q('customer-session').count({ where: { customer: person.id, revokedAt: null, expiresAt: { $gt: new Date() } } });
    assert.equal(await live(), cap, 'parallel verification must enforce maxSessions');
    await contend(app, target, () => auth.issueSession(person, systemCtx), () => auth.issueSession(person, systemCtx));
    assert.equal(await live(), cap, 'standalone calls must also enforce maxSessions');
  });

  app.config.set('plugin::ordering.catalog.adapter', 'ordering-catalog');
  const doc = name => app.documents(`plugin::ordering.${name}`);
  const product = await doc('catalog-product').create({ data: { productType: 'food', status: 'active', sellOnline: true, fulfillmentKinds: ['pickup', 'delivery'], name: { vi: 'Review price' } } });
  const variant = await doc('catalog-variant').create({ data: { product: product.documentId, isDefault: true, rank: 0, name: { vi: 'Default' }, sku: 'ROUND4' } });
  await doc('catalog-price').create({ data: { variant: variant.documentId, amount: 45000, currency: 'VND' } });
  const lists = plugin.service('price-list');
  const input = amount => ({ name: { vi: 'Review list' }, kind: 'override', priority: 50, active: true, lines: [{ variantId: variant.documentId, amount }] });
  const list = await lists.create(input(40000), systemCtx);
  const quote = async () => (await services(app).order.quote(basicOrderInput({ lines: [{ sellableUid: product.documentId, quantity: 1 }], adjustments: [] }), systemCtx)).lines[0].unitAmount;

  await test('failed price update preserves metadata, prices, quote and audit', async () => {
    assert.equal(await quote(), 40000);
    const audits = await q('admin-change-log').count({ where: { action: 'price-list.update', entityId: String(list.item.id) } });
    const restore = interceptQuery(app, 'plugin::ordering.catalog-price', 'create', async () => { throw new Error('injected-write-failure'); });
    try { await assert.rejects(() => lists.update(list.item.id, input(30000), systemCtx), /injected-write-failure/); }
    finally { restore(); }
    assert.equal(await quote(), 40000, 'failed update must preserve the live quote');
    assert.equal((await lists.get(list.item.id)).item.lines[0].amount, 40000);
    assert.equal(await q('catalog-price').count({ where: { priceList: list.item.id } }), 1);
    assert.equal(await q('admin-change-log').count({ where: { action: 'price-list.update', entityId: String(list.item.id) } }), audits);
  });
  await test('failed price creation rolls back list and audit', async () => {
    const before = await q('price-list').count({});
    const restore = interceptQuery(app, 'plugin::ordering.catalog-price', 'create', async () => { throw new Error('injected-write-failure'); });
    try { await assert.rejects(() => lists.create(input(31000), systemCtx), /injected-write-failure/); }
    finally { restore(); }
    assert.equal(await q('price-list').count({}), before);
  });
  await test('overlapping price updates produce one coherent override', async () => {
    // Restore baseline even on old code whose preceding failure removed prices.
    await lists.update(list.item.id, input(40000), systemCtx);
    await contend(app, [['plugin::ordering.catalog-price', 'findMany', args => args.where?.priceList === list.item.id]],
      () => lists.update(list.item.id, input(32000), systemCtx),
      () => lists.update(list.item.id, input(33000), systemCtx));
    const rows = await q('catalog-price').findMany({ where: { priceList: list.item.id } });
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].amount), (await lists.get(list.item.id)).item.lines[0].amount);
    assert.equal(await quote(), Number(rows[0].amount));
  });

  seedMenu(app);
  const { order, payment, refund, lineCancel } = services(app);
  for (const cancelFirst of [true, false]) await test(`cancel/refund line-before-payment (${cancelFirst ? 'cancel' : 'refund'} first)`, async () => {
    const created = await order.createOrder(basicOrderInput({ adjustments: [] }), systemCtx);
    const orderId = created.order.order.id;
    const lineId = created.order.lines.find(line => line.quantity >= 2).id;
    const intent = await payment.createPayment({ orderId, providerCode: 'test' }, systemCtx);
    // Paid in full: a line cancel refunds only money held above what is still owed.
    await payment.capturePayment({ paymentId: intent.id, amount: created.order.order.totalAmount, providerTransactionId: randomUUID() }, systemCtx);
    const cancel = () => lineCancel.cancelLineQuantity({ orderId, lineId, quantity: 1, reason: 'Review' }, systemCtx);
    const returned = () => refund.createRefund({ paymentId: intent.id, lines: [{ lineId, quantity: 1 }], reason: 'Review', idempotencyKey: randomUUID() }, systemCtx);
    await contend(app, [
      ['plugin::ordering.order-line', 'findOne', args => args.where?.id === lineId],
      ['plugin::ordering.payment', 'findOne', args => args.where?.id === intent.id && !args.select],
    ], cancelFirst ? cancel : returned, cancelFirst ? returned : cancel);
    const line = await q('order-line').findOne({ where: { id: lineId } });
    assert.equal(line.canceledQuantity, 1); assert.equal(line.returnedQuantity, 1);
    const refunds = await q('refund').findMany({ where: { order: orderId } });
    assert.equal(refunds.length, 2);
    assert.equal(refunds.reduce((sum, row) => sum + Number(row.amount), 0), Number(line.lineTotalAmount));
  });
  if (failures) throw new Error(`${failures} fourth-review regression(s) failed`);
});
