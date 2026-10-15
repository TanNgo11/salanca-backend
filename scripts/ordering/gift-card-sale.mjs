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

  // Issued card value is never refunded to cash: a full refund of the sale is refused, while
  // money above the face value (an overpaid second capture) may still go back.
  const refunds = app.plugin('ordering').service('refund');
  await assert.rejects(
    refunds.createRefund(
      { paymentId: pay.id, amount: 400000, reason: 'khách đổi ý', idempotencyKey: `gc-refund-${randomUUID()}` },
      systemCtx,
    ),
    (error) => error?.code === 'GIFT_CARD_NOT_ALLOWED' && error.details?.reason === 'card-sale-refund',
    'refunding an issued card sale is refused',
  );
  const extra = await payment.createPayment({ orderId, providerCode: 'test', amount: 50000 }, systemCtx);
  await payment.capturePayment(
    { paymentId: extra.id, amount: 50000, providerTransactionId: 'gc-txn-overpay' },
    systemCtx,
  );
  const overpay = await refunds.createRefund(
    { paymentId: extra.id, amount: 50000, reason: 'trả dư', idempotencyKey: `gc-refund-${randomUUID()}` },
    systemCtx,
  );
  assert.equal(Number(overpay.refund.amount), 50000, 'the overpaid part refunds');
  await assert.rejects(
    refunds.createRefund(
      { paymentId: pay.id, amount: 1, reason: 'thêm', idempotencyKey: `gc-refund-${randomUUID()}` },
      systemCtx,
    ),
    (error) => error?.code === 'GIFT_CARD_NOT_ALLOWED',
    'nothing beyond the overpay',
  );
  console.log('[ordering-test] card sale: issued value not refundable, overpay refunds');
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
  await assert.rejects(
    order.createOrder(
      digitalInput({
        adjustments: [{ kind: 'discount', code: 'staff-50k', label: 'Giảm tay', amount: -50000 }],
        origin: { kind: 'staff-draft' },
        payment: { providerCode: 'cash' },
      }),
      systemCtx,
    ),
    (error) => error?.code === 'GIFT_CARD_NOT_ALLOWED' && error.details?.reason === 'card-discount',
    'a staff discount cannot lower a card sale',
  );
  console.log('[ordering-test] manual discount on a card sale → GIFT_CARD_NOT_ALLOWED');

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

  // The order never stores the scanned codes — only the resolved card ids.
  const counterRow = await app.db.query('plugin::ordering.order').findOne({
    where: { id: counter.order.order.id },
    populate: { fulfillmentGroups: true },
  });
  const storedJson = JSON.stringify(counterRow);
  for (const code of [stock1.code, stock2.code]) {
    assert.ok(!storedJson.includes(code) && !storedJson.includes(code.replaceAll('-', '')), 'no code stored');
  }
  assert.deepEqual(counterRow.receiveMethod.physicalCardIds, [stock1.id, stock2.id]);
  const detail = await adminOrders.detail(counter.order.order.id, lanCtx);
  assert.ok(!JSON.stringify(detail).includes(stock1.code), 'admin detail shows no code');
  console.log('[ordering-test] counter sale stores card ids, never the scanned codes');

  // Every scan problem fails at create, while staff are still at the counter — a paid order
  // can no longer get stuck in issuance.
  const counterInput = (physicalCodes, phone) =>
    digitalInput({
      receiveMethod: { kind: 'digital', physicalCodes },
      contact: { name: 'Counter', phone },
      payment: { providerCode: 'cash' },
      origin: { kind: 'staff-draft' },
    });
  const wrong1 = await issue({ amount: 50000, source: 'batch' });
  const wrong2 = await issue({ amount: 50000, source: 'batch' });
  await assert.rejects(
    order.createOrder(counterInput([wrong1.code, wrong2.code], '+84900000008'), lanCtx),
    (error) => error?.code === 'GIFT_CARD_INVALID' && /denomination/.test(error.message),
    '50k stock on a 200k line is refused at create',
  );
  const fresh1 = await issue({ amount: 200000, source: 'batch' });
  const fresh2 = await issue({ amount: 200000, source: 'batch' });
  await assert.rejects(
    order.createOrder(counterInput([fresh1.code, fresh1.code], '+84900000009'), lanCtx),
    (error) => error?.code === 'VALIDATION_ERROR' && /twice/.test(error.message),
    'the same card scanned twice is refused',
  );
  // Two drafts racing one card: exactly one holds it.
  const fresh3 = await issue({ amount: 200000, source: 'batch' });
  const raced = await Promise.allSettled([
    order.createOrder(counterInput([fresh1.code, fresh2.code], '+84900000010'), lanCtx),
    order.createOrder(counterInput([fresh2.code, fresh3.code], '+84900000011'), lanCtx),
  ]);
  assert.equal(raced.filter((result) => result.status === 'fulfilled').length, 1, 'one draft wins the card');
  const lost = raced.find((result) => result.status === 'rejected');
  assert.equal(lost.reason?.code, 'GIFT_CARD_INVALID');
  // Deleting the winning draft releases its cards.
  const winner = raced.find((result) => result.status === 'fulfilled').value;
  await adminOrders.deleteDraft(winner.order.order.id, lanCtx);
  const retry = await order.createOrder(counterInput([fresh2.code, fresh3.code], '+84900000012'), lanCtx);
  assert.equal(retry.order.order.status, 'draft', 'a deleted draft no longer holds its cards');
  console.log('[ordering-test] scans: denomination, duplicate and reservation checked at create');

  // --- money can leave between `issued` and the consumer (audit O-04 remainder) ----------
  // A refund taken through another channel (a wallet/transfer refund on another payment, or a
  // `refund-due` row) shrinks what the order holds while the issuance event is still queued. The
  // consumer must refuse to mint cards the order cannot back, raise one alert, and issue once the
  // money is back — never mint an active card against a refunded order. Runs last: it issues a
  // card and mails the recipient, and the counter-sale checks above count those globally.
  {
    const drained = await order.createOrder(
      digitalInput({ lines: [{ sellableUid: 'card-200k', quantity: 1 }] }),
      systemCtx,
    );
    const drainedId = drained.order.order.id;
    const drainedPay = await payment.createPayment({
      orderId: drainedId,
      providerCode: 'test',
      amount: 200000,
    }, systemCtx);
    await payment.capturePayment(
      { paymentId: drainedPay.id, amount: 200000, providerTransactionId: randomUUID() },
      systemCtx,
    );
    await matching.advanceIfPaid(drainedId, systemCtx);
    assert.equal((await order.getOrder(drainedId, systemCtx)).groups[0].status, 'issued');

    const knex = app.db.connection;
    const pendingRefund = await app.db.query('plugin::ordering.refund').create({
      data: {
        amount: 200000,
        currency: 'VND',
        reason: 'refund through another channel',
        actorRef: 'audit',
        status: 'pending',
      },
    });
    await knex('plugins_ordering_refund_order_lnk').insert({
      refund_id: pendingRefund.id,
      order_id: drainedId,
    });
    await knex('plugins_ordering_refund_payment_lnk').insert({
      refund_id: pendingRefund.id,
      payment_id: drainedPay.id,
    });

    const issuedEvents = await app.db.query('plugin::ordering.outbox').findMany({
      where: { type: 'fulfillment-group.transitioned' },
    });
    const issuedEvent = issuedEvents.find(
      (row) => row.payload?.orderId === drainedId && row.payload?.to === 'issued',
    );
    assert.ok(issuedEvent, 'the group-issued event exists');

    await giftCard.onGroupIssued(issuedEvent);
    const refusedCards = await cardsOf(drainedId);
    const alerts = await app.db.query('plugin::ordering.ops-alert').findMany({
      where: { alertCode: 'gift-card-underfunded' },
    });
    console.log(
      `[ordering-test] underfunded issuance: cards=${refusedCards.length} alerts=${alerts.length}`,
    );
    assert.equal(refusedCards.length, 0, 'no card is minted without the money behind it');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].status, 'open');
    assert.equal(alerts[0].severity, 'critical');
    assert.equal(alerts[0].dedupeKey, `gift-card-underfunded:${drainedId}`);
    assert.equal(alerts[0].aggregateRef, `order:${drainedId}`);
    assert.equal(
      (await app.db.query('plugin::ordering.gift-card-ledger').count({ where: { order: drainedId } })),
      0,
      'no ledger row either',
    );

    // The money is available again (the refund was withdrawn): a redelivered event issues.
    await knex('plugins_ordering_refund').where({ id: pendingRefund.id }).update({ status: 'settled' });
    await giftCard.onGroupIssued(issuedEvent);
    const retried = await cardsOf(drainedId);
    console.log(`[ordering-test] underfunded retry: cards=${retried.length}`);
    assert.equal(retried.length, 1, 'the card is issued once the money is back');
    assert.equal(Number(retried[0].initialAmount), 200000);
    assert.equal(retried[0].status, 'active');
  }

  console.log('[ordering-test] done');
});
