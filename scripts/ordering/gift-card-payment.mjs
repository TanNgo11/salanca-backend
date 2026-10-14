// O9 step 4 — a gift card pays for a food order. The code arrives as a co-payment
// (`payment.giftCardCode`): the debit lands inside the order transaction, the payment row
// is captured at once, partial application leaves the remainder to the real provider, and
// every cancel-terminal path (staff cancel, customer cancel, payment expiry) returns the
// value to the card through the refund — card before cash — with the ledger as the audit.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { runPaymentExpiry } from '../../src/plugins/ordering/dist/server/src/jobs/payment-expiry.js';
import {
  basicOrderInput,
  seedBranches,
  seedMenu,
  seedStaff,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const MINUTE = 60_000;

withApp(async (app) => {
  const { order, giftCard, transition, lineCancel } = services(app);
  const adminOrders = app.plugin('ordering').service('admin-orders');
  const dispatch = () => runOutboxDispatcher(app, { owner: `test:${process.pid}` });
  await seedBranches(app);
  seedMenu(app);
  const staff = await seedStaff(app);
  const lanCtx = { actor: staff.lan.actor };
  const storefront = app.plugin('ordering').service('storefront');

  const issue = (input) =>
    app.db.transaction(async ({ trx }) => giftCard.issueInTransaction(trx, input, systemCtx));
  const cardRow = (id) => app.db.query('plugin::ordering.gift-card').findOne({ where: { id } });
  const ledgerOf = (id) =>
    app.db.query('plugin::ordering.gift-card-ledger').findMany({
      where: { card: { id } },
      populate: { payment: true, order: true, refund: true },
      orderBy: { id: 'asc' },
    });
  const ledgerSum = async (id) =>
    (await ledgerOf(id)).reduce((sum, row) => sum + Number(row.amount), 0);
  const gcPaymentsOf = (orderId) =>
    app.db.query('plugin::ordering.payment').findMany({
      where: { order: { id: orderId }, providerCode: 'gift-card' },
    });
  const refundRowsOf = (paymentId) =>
    app.db.query('plugin::ordering.refund').findMany({
      where: { payment: { id: paymentId } },
    });

  const foodInput = (overrides = {}) =>
    basicOrderInput({
      adjustments: [],
      lines: [{ sellableUid: 'bun-bo', quantity: 2 }],
      ...overrides,
    });
  // bun-bo ×2 = 130000
  const TOTAL = 130000;

  // --- full payment: card covers the whole order --------------------------------------
  const full = await issue({ amount: 300000, source: 'manual' });
  const fullOrder = await order.createOrder(
    foodInput({ payment: { providerCode: 'cash', giftCardCode: full.code } }),
    systemCtx,
  );
  const fullId = fullOrder.order.order.id;
  let agg = await order.getOrder(fullId, systemCtx);
  let gcPayments = await gcPaymentsOf(fullId);
  assert.equal(gcPayments.length, 1);
  assert.equal(Number(gcPayments[0].capturedAmount), TOTAL);
  assert.equal(Number(gcPayments[0].requestedAmount), TOTAL);
  assert.equal(gcPayments[0].status, 'captured');
  assert.equal(gcPayments[0].providerReference, `gift-card:${full.last4}`);
  assert.equal(agg.order.paymentStatus, 'paid');
  assert.equal(agg.groups[0].status, 'awaiting-acceptance');
  assert.equal(Number((await cardRow(full.id)).balance), 300000 - TOTAL);
  let ledger = await ledgerOf(full.id);
  const redeemRow = ledger.find((row) => row.kind === 'redeem');
  assert.ok(redeemRow, 'redeem ledger row written');
  assert.equal(Number(redeemRow.amount), -TOTAL);
  assert.equal(redeemRow.order?.id, fullId);
  assert.equal(redeemRow.payment?.id, gcPayments[0].id);
  console.log('[ordering-test] full card payment → captured gift-card payment, paid order, redeem ledger');

  // Public view: card surfaces as last4 + amounts only — the code itself never appears.
  const view = await storefront.viewByToken(fullOrder.publicToken, systemCtx);
  assert.equal(view.giftCards.length, 1);
  assert.equal(view.giftCards[0].last4, full.last4);
  assert.equal(view.giftCards[0].paid, TOTAL);
  assert.equal(view.totals.due, 0);
  assert.ok(!JSON.stringify(view).includes(full.code.replaceAll('-', '')), 'no code in the view');
  console.log('[ordering-test] token view → giftCards:[last4+amounts], no plaintext code');

  // --- partial payment + cash remainder ------------------------------------------------
  const partial = await issue({ amount: 50000, source: 'manual' });
  const partOrder = await order.createOrder(
    foodInput({ payment: { providerCode: 'cash', giftCardCode: partial.code } }),
    systemCtx,
  );
  const partId = partOrder.order.order.id;
  agg = await order.getOrder(partId, systemCtx);
  gcPayments = await gcPaymentsOf(partId);
  assert.equal(Number(gcPayments[0].capturedAmount), 50000);
  assert.equal(agg.order.paymentStatus, 'partially-paid');
  assert.equal(Number((await cardRow(partial.id)).balance), 0);
  const partView = await storefront.viewByToken(partOrder.publicToken, systemCtx);
  assert.equal(partView.totals.due, TOTAL - 50000);
  console.log('[ordering-test] 50k card on a 130k order → captured 50k, due 80k to cash');

  // Customer cancel returns the card value through the close consumer (no refundHeld here).
  await transition.cancelOrder({ orderId: partId, reason: 'khách đổi ý' }, systemCtx);
  await dispatch();
  assert.equal(Number((await cardRow(partial.id)).balance), 50000, 'card restored');
  gcPayments = await gcPaymentsOf(partId);
  assert.equal(Number(gcPayments[0].refundedAmount), 50000);
  ledger = await ledgerOf(partial.id);
  const refundRow = ledger.find((row) => row.kind === 'refund');
  assert.ok(refundRow, 'refund ledger row written');
  assert.equal(Number(refundRow.amount), 50000);
  assert.equal((await refundRowsOf(gcPayments[0].id)).length, 1);
  // Replay: the same close event delivered twice credits nothing more.
  const { rows: closes } = await app.db.connection.raw(
    `SELECT id FROM plugins_ordering_outbox
      WHERE type = 'fulfillment-group.transitioned' AND payload->>'orderId' = ?`,
    [String(partId)],
  );
  assert.ok(closes.length > 0);
  for (const { id } of closes) {
    const event = await app.db.query('plugin::ordering.outbox').findOne({ where: { id } });
    await giftCard.onGroupClosed(event);
  }
  await dispatch();
  assert.equal(Number((await cardRow(partial.id)).balance), 50000, 'replayed close adds no credit');
  assert.equal(
    (await ledgerOf(partial.id)).filter((row) => row.kind === 'refund').length,
    1,
    'still one refund ledger row',
  );
  console.log('[ordering-test] customer cancel → card restored via outbox; replay is a no-op');

  // --- staff cancel: refundHeld credits inside its transaction ---------------------------
  const staffCard = await issue({ amount: 60000, source: 'manual' });
  const staffOrder = await order.createOrder(
    foodInput({ payment: { providerCode: 'cash', giftCardCode: staffCard.code } }),
    systemCtx,
  );
  const staffOrderId = staffOrder.order.order.id;
  await adminOrders.cancel(staffOrderId, { reasonCode: 'customer-request', note: 'đổi ý' }, lanCtx);
  assert.equal(
    Number((await cardRow(staffCard.id)).balance),
    60000,
    'refundHeld returns value in the cancel transaction',
  );
  await dispatch();
  assert.equal(
    (await ledgerOf(staffCard.id)).filter((row) => row.kind === 'refund').length,
    1,
    'outbox close after refundHeld is a no-op',
  );
  console.log('[ordering-test] staff cancel → refundHeld credits the card; close event dedupes');

  // --- payment expiry restores a partially-covered prepay order ---------------------------
  const branches = app.db.query('plugin::ordering.branch');
  const q1 = await branches.findOne({ where: { code: 'Q1' } });
  await branches.update({
    where: { id: q1.id },
    data: {
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'prepay',
          paymentProviders: ['cash', 'test'],
          paymentTimeoutMinutes: 15,
          schedule: { businessDayPolicy: { cutoffLocalTime: '04:00' } },
        },
      },
    },
  });
  const expiryCard = await issue({ amount: 40000, source: 'manual' });
  const expOrder = await order.createOrder(
    foodInput({ payment: { providerCode: 'test', giftCardCode: expiryCard.code } }),
    systemCtx,
  );
  const expId = expOrder.order.order.id;
  agg = await order.getOrder(expId, systemCtx);
  assert.equal(agg.groups[0].status, 'awaiting-payment', 'partial card leaves the group unpaid');
  await app.db.query('plugin::ordering.order').update({
    where: { id: expId },
    data: { placedAt: new Date(Date.now() - 16 * MINUTE) },
  });
  const sweep = await runPaymentExpiry(app, { owner: 'expiry' });
  assert.equal(sweep.expired, 1);
  await dispatch();
  assert.equal(Number((await cardRow(expiryCard.id)).balance), 40000, 'expiry restores the card');
  console.log('[ordering-test] payment expiry → group expired, card value restored via outbox');

  // --- line cancel: a card-paid order refunds its line to the card first ------------------
  const lineCard = await issue({ amount: 300000, source: 'manual' });
  const lineOrder = await order.createOrder(
    foodInput({
      lines: [
        { sellableUid: 'bun-bo', quantity: 1 },
        { sellableUid: 'tra-dao', quantity: 1 },
      ],
      payment: { providerCode: 'cash', giftCardCode: lineCard.code },
    }),
    systemCtx,
  );
  const lineOrderId = lineOrder.order.order.id;
  agg = await order.getOrder(lineOrderId, systemCtx);
  const traDao = agg.lines.find((line) => line.titleSnapshot === 'Trà đào');
  await lineCancel.cancelLineQuantity(
    { orderId: lineOrderId, lineId: traDao.id, quantity: 1, reason: 'hết đào' },
    lanCtx,
  );
  assert.equal(
    Number((await cardRow(lineCard.id)).balance),
    300000 - 110000 + 45000,
    'the canceled line returns to the card',
  );
  console.log('[ordering-test] line cancel on a card-paid order → refund rides the card');

  // Card paid part of the order (30k of 110k), cash the rest: cancelling trà đào (45k) splits
  // the refund — the card takes back at most what it paid, cash takes the rest.
  const splitCard = await issue({ amount: 30000, source: 'manual' });
  const splitOrder = await order.createOrder(
    foodInput({
      lines: [
        { sellableUid: 'bun-bo', quantity: 1 },
        { sellableUid: 'tra-dao', quantity: 1 },
      ],
      payment: { providerCode: 'cash', giftCardCode: splitCard.code },
    }),
    systemCtx,
  );
  const splitId = splitOrder.order.order.id;
  const cashPay = await services(app).payment.createPayment(
    { orderId: splitId, providerCode: 'cash' },
    systemCtx,
  );
  await services(app).payment.capturePayment(
    { paymentId: cashPay.id, amount: 80000, providerTransactionId: 'cash-split' },
    systemCtx,
  );
  agg = await order.getOrder(splitId, systemCtx);
  await lineCancel.cancelLineQuantity(
    {
      orderId: splitId,
      lineId: agg.lines.find((line) => line.titleSnapshot === 'Trà đào').id,
      quantity: 1,
      reason: 'hết đào',
    },
    lanCtx,
  );
  const splitRefunds = await app.db.query('plugin::ordering.refund').findMany({
    where: { order: { id: splitId } },
    populate: { payment: true },
  });
  const byProvider = Object.fromEntries(
    splitRefunds.map((row) => [row.payment.providerCode, Number(row.amount)]),
  );
  assert.deepEqual(byProvider, { 'gift-card': 30000, cash: 15000 }, 'card first, capped, rest to cash');
  assert.equal(Number((await cardRow(splitCard.id)).balance), 30000, 'card got back what it paid');
  console.log('[ordering-test] line cancel split → 30k back to the card, 15k to cash');

  // --- concurrency: two orders race one card ----------------------------------------------
  const raceCard = await issue({ amount: 100000, source: 'manual' });
  const raceInput = () =>
    foodInput({
      lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
      payment: { providerCode: 'cash', giftCardCode: raceCard.code },
    });
  const race = await Promise.all(
    [raceInput(), raceInput(), raceInput()].map((input) =>
      order
        .createOrder(input, systemCtx)
        .then((result) => ({ ok: true, orderId: result.order.order.id }))
        .catch((error) => ({ ok: false, code: error?.code })),
    ),
  );
  const raceCardRow = await cardRow(raceCard.id);
  assert.equal(Number(raceCardRow.balance), 0, 'card drained, never negative');
  const raceDebit = (await ledgerOf(raceCard.id))
    .filter((row) => row.kind === 'redeem')
    .reduce((sum, row) => sum - Number(row.amount), 0);
  assert.equal(raceDebit, 100000, 'redeem ledger totals the full balance');
  const won = race.filter((result) => result.ok);
  assert.ok(won.length >= 2, 'first debit + partial retry both land');
  let capturedSum = 0;
  for (const { orderId } of won) {
    for (const row of await gcPaymentsOf(orderId)) capturedSum += Number(row.capturedAmount);
  }
  assert.equal(capturedSum, 100000, 'captured amounts equal the debited total');
  assert.equal(await ledgerSum(raceCard.id), 0, 'ledger replays to the card balance');
  console.log(
    `[ordering-test] race: ${won.length}/3 orders shared 100k — no overdraw, Σ ledger = balance`,
  );

  // A fourth order on the drained card fails at debit time.
  await assert.rejects(
    order.createOrder(
      foodInput({
        lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
        payment: { providerCode: 'cash', giftCardCode: raceCard.code },
      }),
      systemCtx,
    ),
    (error) => error?.code === 'GIFT_CARD_INSUFFICIENT',
  );
  console.log('[ordering-test] drained card at create → GIFT_CARD_INSUFFICIENT');

  // --- quote metadata: unusable codes report a reason, never throw -------------------------
  const quoteFor = async (giftCardCode) =>
    order.quote(
      foodInput({
        lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
        payment: { providerCode: 'cash', giftCardCode },
      }),
      systemCtx,
    );
  let quoted = await quoteFor('AAAA-AAAA-AAAA-AAAA');
  assert.equal(quoted.giftCard.reason, 'invalid');
  const blocked = await issue({ amount: 80000, source: 'manual' });
  await giftCard.block(blocked.id, 'báo mất', systemCtx);
  quoted = await quoteFor(blocked.code);
  assert.equal(quoted.giftCard.reason, 'invalid');
  assert.equal(quoted.giftCard.last4, null, 'a blocked card does not confirm it exists');
  quoted = await quoteFor(raceCard.code);
  assert.equal(quoted.giftCard.reason, 'insufficient');
  const stale = await issue({
    amount: 80000,
    source: 'manual',
    expiresAt: new Date(Date.now() - MINUTE),
  });
  quoted = await quoteFor(stale.code);
  assert.equal(quoted.giftCard.reason, 'expired');
  const rich = await issue({ amount: 200000, source: 'manual' });
  quoted = await quoteFor(rich.code);
  assert.equal(quoted.giftCard.applied, 65000, 'applied = min(balance, total)');
  assert.equal(quoted.giftCard.balanceAfter, 200000 - 65000);
  assert.equal(quoted.giftCard.last4, rich.last4);
  assert.equal(quoted.totals.dueAfterGiftCard, 0, 'card covers the quote');
  console.log('[ordering-test] quote → invalid/blocked/expired/insufficient reasons, applied cap');

  // --- a card can never buy a card ----------------------------------------------------------
  const cardSellable = {
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
    ref: { uid: 'card-100k' },
    productType: 'gift-card',
    title: 'Thẻ 100k',
    listPrice: { amount: 100000, currency: 'VND' },
  };
  app.plugin('ordering').service('registry').catalogAdapter('test-catalog').seed([cardSellable]);
  const digitalInput = {
    idempotencyKey: randomUUID(),
    locationRef: 'Q1',
    lines: [{ sellableUid: 'card-100k', quantity: 1 }],
    receiveMethod: { kind: 'digital', recipientEmail: 'x@example.invalid' },
    contact: { name: 'Buyer', phone: '+84900000009', email: 'x@example.invalid' },
    consent: { policyVersion: 'v1', channel: 'web-checkout' },
    payment: { providerCode: 'test', giftCardCode: rich.code },
    origin: { kind: 'storefront' },
  };
  await assert.rejects(order.createOrder(digitalInput, systemCtx), (error) => {
    assert.equal(error?.code, 'GIFT_CARD_NOT_ALLOWED');
    assert.equal(error?.details?.reason, 'buying-gift-card');
    return true;
  });
  await assert.rejects(order.quote(digitalInput, systemCtx), (error) => {
    assert.equal(error?.code, 'GIFT_CARD_NOT_ALLOWED');
    assert.equal(error?.details?.reason, 'buying-gift-card');
    return true;
  });
  assert.equal(Number((await cardRow(rich.id)).balance), 200000, 'no debit on the refused cart');
  console.log('[ordering-test] card code on a digital cart → GIFT_CARD_NOT_ALLOWED, no debit');

  // --- wrong code at create ------------------------------------------------------------------
  await assert.rejects(
    order.createOrder(
      foodInput({
        lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
        payment: { providerCode: 'cash', giftCardCode: 'BBBB-BBBB-BBBB-BBBB' },
      }),
      systemCtx,
    ),
    (error) => error?.code === 'GIFT_CARD_INVALID',
  );
  console.log('[ordering-test] unknown code at create → GIFT_CARD_INVALID');

  // --- balance endpoint: safe view, inactive stock invisible ---------------------------------
  const staffGift = app.plugin('ordering').service('storefront');
  let seen = await staffGift.giftCardBalance(rich.code, systemCtx);
  assert.deepEqual({ ...seen, expiresAt: seen.expiresAt ? 'date' : null }, {
    last4: rich.last4,
    status: 'active',
    balance: 200000,
    currency: 'VND',
    expiresAt: 'date',
  });
  seen = await staffGift.giftCardBalance('ZZZZ-ZZZZ-ZZZZ-ZZZZ', systemCtx);
  assert.equal(seen, null, 'unknown code → null (probing gets no oracle)');
  const stock = await issue({ amount: 100000, source: 'batch' });
  seen = await staffGift.giftCardBalance(stock.code, systemCtx);
  assert.equal(seen, null, 'unsold batch stock → null (shelf stock is invisible)');
  seen = await staffGift.giftCardBalance(blocked.code, systemCtx);
  assert.equal(seen, null, 'blocked card → null (same non-oracle as redemption)');
  console.log('[ordering-test] balance view → safe fields; unknown/inactive/blocked all null');

  // --- invariant sweep: every touched card replays Σ ledger = balance --------------------------
  const allCards = await app.db.query('plugin::ordering.gift-card').findMany({ select: ['id', 'balance'] });
  for (const card of allCards) {
    if (card.id === stock.id) continue; // inactive batch stock has no ledger by design
    assert.equal(await ledgerSum(card.id), Number(card.balance), `card ${card.id} Σ ledger = balance`);
  }
  // No plaintext anywhere: payments and outbox payloads carry last4 at most.
  const allPayments = await app.db.query('plugin::ordering.payment').findMany({
    where: { providerCode: 'gift-card' },
  });
  for (const row of allPayments) {
    assert.match(row.providerReference, /^gift-card:[A-Z2-9]{4}$/);
  }
  console.log('[ordering-test] Σ ledger = balance on every card; payment refs carry last4 only');

  console.log('[ordering-test] done');
});
