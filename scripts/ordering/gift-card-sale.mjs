import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import {
  basicOrderInput,
  seedBranches,
  seedMenu,
  seedStaff,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

// O9 step 3 — the digital gift-card sale: a `gift-card` product type sells through a dedicated
// `gift-card` workflow (awaiting-payment → issued), capture advances the group and the outbox
// consumer mints exactly one card per line unit, seals the code, and mails the recipient.
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
  lines: [{ sellableUid: 'card-200k', quantity: 2 }],
  receiveMethod: {
    kind: 'digital',
    recipientEmail: 'giftee@example.invalid',
    recipientName: 'Lan',
    message: 'Chúc mừng!',
  },
  contact: { name: 'Buyer', phone: '+84900000002', email: 'buyer@example.invalid' },
  consent: { policyVersion: 'v1', channel: 'web-checkout' },
  payment: { providerCode: 'test' },
  origin: { kind: 'storefront' },
  ...overrides,
});

withApp(async (app) => {
  const { order, payment, giftCard } = services(app);
  const matching = app.plugin('ordering').service('payment-matching');
  const dispatch = () => runOutboxDispatcher(app, { owner: `test:${process.pid}` });
  await seedBranches(app);
  seedMenu(app);
  const capture = app.plugin('ordering').service('registry').notificationProvider('email');
  const branchRows = app.db.query('plugin::ordering.branch');
  const q1 = await branchRows.findOne({ where: { code: 'Q1' } });
  // A digital storefront sale prepays through the branch's online providers.
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
    cardSellable({
      ref: { uid: 'card-zero' },
      productType: 'gift-card',
      title: 'Thẻ 0đ',
      listPrice: { amount: 0, currency: 'VND' },
    }),
  ]);
  const cardsOf = (orderId) =>
    app.db.query('plugin::ordering.gift-card').findMany({
      where: { order: { id: orderId } },
      populate: { orderLine: true },
      orderBy: { id: 'asc' },
    });

  // --- happy path: create → initiate → capture → issue → mail ---------------------------
  const created = await order.createOrder(digitalInput(), systemCtx);
  const orderId = created.order.order.id;
  assert.equal(created.order.groups.length, 1);
  assert.equal(created.order.groups[0].workflowName, 'gift-card');
  assert.equal(created.order.groups[0].status, 'awaiting-payment');
  assert.equal(created.order.order.totalAmount, 400000);
  assert.equal((await cardsOf(orderId)).length, 0, 'no card before capture');
  console.log('[ordering-test] digital order created: gift-card workflow, awaiting-payment, 0 cards');

  const pay = await payment.createPayment({ orderId, providerCode: 'test' }, systemCtx);
  await payment.capturePayment(
    { paymentId: pay.id, amount: 400000, providerTransactionId: 'gc-txn-1' },
    systemCtx,
  );
  await matching.advanceIfPaid(orderId, systemCtx);
  let agg = await order.getOrder(orderId, systemCtx);
  assert.equal(agg.groups[0].status, 'issued');
  assert.equal(agg.order.status, 'completed');
  assert.equal(agg.order.paymentStatus, 'paid');
  assert.equal((await cardsOf(orderId)).length, 0, 'issuance waits for the outbox, not capture');
  console.log('[ordering-test] captured → group issued, order completed, cards still pending outbox');

  await dispatch();
  const cards = await cardsOf(orderId);
  assert.equal(cards.length, 2);
  for (const card of cards) {
    assert.equal(Number(card.balance), 200000);
    assert.equal(Number(card.initialAmount), 200000);
    assert.equal(card.status, 'active');
    assert.equal(card.source, 'sale');
    assert.ok(card.codeHash && !card.codeHash.includes('-'), 'hash only, no plaintext code');
    assert.ok(card.sealedCode, 'sealed copy kept for the staff reveal');
    assert.ok(card.orderLine?.id, 'linked to its line');
  }
  const ledger = await app.db
    .query('plugin::ordering.gift-card-ledger')
    .findMany({ where: { kind: 'issue' } });
  assert.equal(ledger.length, 2);
  const issuedEvents = await app.db.query('plugin::ordering.outbox').findMany({
    where: { type: 'gift-card.issued' },
  });
  assert.equal(issuedEvents.length, 2);
  console.log('[ordering-test] dispatch → 2 active cards (hash+seal only), 2 issue ledger rows, 2 webhook events');

  // Recipient mail carries the plaintext codes — the only surface besides staff reveal.
  const mail = capture.sent.find((item) => item.template === 'customer.gift-card-issued');
  assert.ok(mail, 'recipient mail sent');
  assert.equal(mail.to, 'giftee@example.invalid');
  const codeLines = mail.text.match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/g) ?? [];
  assert.equal(codeLines.length, 2);
  const hashes = new Set(cards.map((card) => card.codeHash));
  const { createHmac } = await import('node:crypto');
  const key = Buffer.from(process.env.ORDERING_ENCRYPTION_KEY, 'base64');
  for (const code of codeLines) {
    const hash = createHmac('sha256', key)
      .update(`gift-card:${code.replaceAll('-', '')}`)
      .digest('hex');
    assert.ok(hashes.has(hash), `mailed code hashes to a real card`);
  }
  assert.ok(!mail.text.includes('buyer@example.invalid'));
  console.log('[ordering-test] mail → recipient only, codes hash-match the issued cards');

  // --- exactly-once: replay the same outbox event and re-dispatch -----------------------
  const { rows: transitioned } = await app.db.connection.raw(
    `SELECT id FROM plugins_ordering_outbox WHERE type = 'fulfillment-group.transitioned'`,
  );
  for (const { id } of transitioned) {
    const event = await app.db.query('plugin::ordering.outbox').findOne({ where: { id } });
    await giftCard.onGroupIssued(event);
  }
  await dispatch();
  assert.equal((await cardsOf(orderId)).length, 2, 'replayed issuance adds no cards');
  const mailsAfter = capture.sent.filter(
    (item) => item.template === 'customer.gift-card-issued',
  );
  assert.equal(mailsAfter.length, 1, 'delivery log dedupes the recipient mail');
  console.log('[ordering-test] consumer replay + re-dispatch → still 2 cards, 1 mail');

  // --- negative rules ------------------------------------------------------------------
  // Food cannot ride a digital order; a card cannot ride a pickup order.
  await assert.rejects(
    order.createOrder(digitalInput({ lines: [{ sellableUid: 'bun-bo', quantity: 1 }] }), systemCtx),
    (error) => error?.code === 'LINE_INVALID',
  );
  await assert.rejects(
    order.createOrder(
      basicOrderInput({
        lines: [{ sellableUid: 'card-200k', quantity: 1 }],
        payment: { providerCode: 'cash' },
      }),
      systemCtx,
    ),
    (error) => error?.code === 'LINE_INVALID',
  );
  console.log('[ordering-test] food line in digital / card line in pickup → LINE_INVALID');

  // A public sale must reach a mailbox (recipient or contact), scanned stock is staff-only.
  await assert.rejects(
    order.createOrder(
      digitalInput({
        receiveMethod: { kind: 'digital' },
        contact: { name: 'Buyer', phone: '+84900000003' },
      }),
      systemCtx,
    ),
    (error) => error?.code === 'VALIDATION_ERROR',
  );
  await assert.rejects(
    order.createOrder(
      digitalInput({ receiveMethod: { kind: 'digital', physicalCodes: ['AAAA-AAAA-AAAA-AAAA'] } }),
      systemCtx,
    ),
    (error) => error?.code === 'VALIDATION_ERROR',
  );
  console.log('[ordering-test] no mailbox / public physicalCodes → VALIDATION_ERROR');

  // Denominations are the catalog price — zero-priced stock and over-cap orders fail.
  await assert.rejects(
    order.createOrder(digitalInput({ lines: [{ sellableUid: 'card-zero', quantity: 1 }] }), systemCtx),
    (error) => error?.code === 'LINE_INVALID',
  );
  const max = app.config.get('plugin::ordering.giftCards').maxCardsPerOrder;
  await assert.rejects(
    order.createOrder(
      digitalInput({ lines: [{ sellableUid: 'card-200k', quantity: max + 1 }] }),
      systemCtx,
    ),
    (error) => error?.code === 'VALIDATION_ERROR',
  );
  console.log('[ordering-test] 0đ denomination → LINE_INVALID; >maxCardsPerOrder → VALIDATION_ERROR');

  // Gift cards disabled rejects the sale entirely.
  app.config.set('plugin::ordering.giftCards.enabled', false);
  await assert.rejects(
    order.createOrder(digitalInput(), systemCtx),
    (error) => error?.code === 'GIFT_CARD_NOT_ALLOWED',
  );
  app.config.set('plugin::ordering.giftCards.enabled', true);
  console.log('[ordering-test] giftCards.enabled=false → GIFT_CARD_NOT_ALLOWED');

  // Ordinary promotions never reach a digital cart: an entered code fails the receiveKinds gate.
  const promo = await app.db.query('plugin::ordering.promotion').create({
    data: {
      name: { vi: 'Giảm 10%' },
      kind: 'code',
      discountType: 'percent',
      value: 10,
      target: { kind: 'order', refs: [] },
      minSubtotal: 0,
      locationRefs: null,
      receiveKinds: ['pickup', 'delivery'],
      startsAt: '2020-01-01T00:00:00.000Z',
      weekdays: [],
      timeRanges: [],
      firstOrderOnly: false,
      stackable: false,
      priority: 0,
      active: true,
      usedCount: 0,
    },
  });
  await app.db.query('plugin::ordering.promotion-code').create({
    data: { promotionId: promo.id, code: 'WELCOME10', usedCount: 0, active: true },
  });
  await assert.rejects(
    order.createOrder(digitalInput({ promotionCode: 'WELCOME10' }), systemCtx),
    (error) => error?.code === 'PROMOTION_NOT_ELIGIBLE',
  );
  console.log('[ordering-test] pickup/delivery promotion on a digital cart → PROMOTION_NOT_ELIGIBLE');

  // --- counter sale: staff scans preprinted stock, cash at the counter --------------------
  const staff = await seedStaff(app);
  const lanCtx = { actor: staff.lan.actor };
  const adminOrders = app.plugin('ordering').service('admin-orders');
  const issue = (input) =>
    app.db.transaction(async ({ trx }) => giftCard.issueInTransaction(trx, input, systemCtx));
  const stock1 = await issue({ amount: 200000, source: 'batch' });
  const stock2 = await issue({ amount: 200000, source: 'batch' });

  const counter = await order.createOrder(
    digitalInput({
      receiveMethod: { kind: 'digital', physicalCodes: [stock1.code, stock2.code] },
      contact: { name: 'Counter', phone: '+84900000005' },
      payment: { providerCode: 'cash' },
      origin: { kind: 'staff-draft', actorRef: 'staff:lan' },
    }),
    lanCtx,
  );
  assert.equal(counter.order.order.status, 'draft');
  await order.confirmDraft(counter.order.order.id, lanCtx);
  await adminOrders.cashHandover(counter.order.order.id, { method: 'cash' }, lanCtx);
  const counterAgg = await order.getOrder(counter.order.order.id, systemCtx);
  assert.equal(counterAgg.groups[0].status, 'issued');
  await dispatch();
  const counterCards = await cardsOf(counter.order.order.id);
  assert.equal(counterCards.length, 2);
  const soldIds = new Set([stock1.id, stock2.id]);
  for (const card of counterCards) {
    assert.ok(soldIds.has(card.id), 'the scanned stock itself is sold, not a fresh mint');
    assert.equal(card.source, 'batch');
    assert.equal(card.status, 'active');
    assert.equal(Number(card.balance), 200000);
  }
  const activations = await app.db
    .query('plugin::ordering.gift-card-ledger')
    .findMany({ where: { kind: 'activate' } });
  assert.equal(activations.length, 2);
  const issuedCount = capture.sent.filter(
    (item) => item.template === 'customer.gift-card-issued',
  ).length;
  assert.equal(issuedCount, 1, 'no mailbox on a counter sale → no card mail');
  console.log('[ordering-test] counter sale: scanned stock activated on cash handover, no mail');

  // Scan rules: exactly one per unit, each a sellable preprinted card of the line's amount.
  await assert.rejects(
    order.createOrder(
      digitalInput({
        receiveMethod: {
          kind: 'digital',
          physicalCodes: [stock1.code, stock2.code, stock1.code],
        },
        contact: { name: 'Counter', phone: '+84900000006' },
        payment: { providerCode: 'cash' },
        origin: { kind: 'staff-draft' },
      }),
      lanCtx,
    ),
    (error) => error?.code === 'VALIDATION_ERROR' || error?.code === 'GIFT_CARD_INVALID',
  );
  await assert.rejects(
    order.createOrder(
      digitalInput({
        receiveMethod: { kind: 'digital', physicalCodes: [stock1.code, stock2.code] },
        contact: { name: 'Counter', phone: '+84900000007' },
        payment: { providerCode: 'cash' },
        origin: { kind: 'staff-draft' },
      }),
      lanCtx,
    ),
    (error) => error?.code === 'GIFT_CARD_INVALID',
    'already-sold stock fails the counter check',
  );
  console.log('[ordering-test] extra scan → rejected; rescanning sold stock → GIFT_CARD_INVALID');

  // A denomination mismatch passes the counter check but is refused transactionally.
  const wrong1 = await issue({ amount: 50000, source: 'batch' });
  const wrong2 = await issue({ amount: 50000, source: 'batch' });
  const mismatch = await order.createOrder(
    digitalInput({
      receiveMethod: { kind: 'digital', physicalCodes: [wrong1.code, wrong2.code] },
      contact: { name: 'Counter', phone: '+84900000008' },
      payment: { providerCode: 'cash' },
      origin: { kind: 'staff-draft' },
    }),
    lanCtx,
  );
  await order.confirmDraft(mismatch.order.order.id, lanCtx);
  await adminOrders.cashHandover(mismatch.order.order.id, { method: 'cash' }, lanCtx);
  const groupId = (await order.getOrder(mismatch.order.order.id, systemCtx)).groups[0].id;
  await assert.rejects(
    giftCard.onGroupIssued({
      payload: {
        orderId: mismatch.order.order.id,
        groupId,
        to: 'issued',
        workflowName: 'gift-card',
      },
    }),
    (error) => error?.code === 'GIFT_CARD_INVALID',
  );
  assert.equal(
    await app.db
      .query('plugin::ordering.gift-card')
      .count({ where: { order: { id: mismatch.order.order.id } } }),
    0,
  );
  console.log('[ordering-test] 50k stock on a 200k line → GIFT_CARD_INVALID at issuance, no cards');

  console.log('[ordering-test] done');
});
