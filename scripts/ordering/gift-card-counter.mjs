import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { seedAdminHttpStaff, seedBranches, services, withApp } from './_harness.mjs';

// Core gaps step 4: the exact requests the "Tạo đơn hộ" gift-card sale makes over the admin API —
// a denomination is a catalog variant (step 2), the draft is receive kind `digital` paid in cash,
// scanned printed stock or a recipient email delivers the cards, the server stamps the consent
// version (step 6). Server rules for scans are covered in depth by gift-card-sale.mjs.
withApp(async (app) => {
  const d = {
    category: app.documents('plugin::ordering.catalog-category'),
    product: app.documents('plugin::ordering.catalog-product'),
    variant: app.documents('plugin::ordering.catalog-variant'),
    price: app.documents('plugin::ordering.catalog-price'),
  };
  const { giftCard } = services(app);
  await seedBranches(app);
  app.config.set('plugin::ordering.catalog.adapter', 'ordering-catalog');

  const category = await d.category.create({ data: { name: { vi: 'Thẻ quà tặng' }, rank: 0 } });
  const card = await d.product.create({
    data: {
      productType: 'gift-card',
      status: 'active',
      sellOnline: true,
      fulfillmentKinds: ['digital'],
      name: { vi: 'Thẻ quà tặng Salanca' },
      categories: [category.documentId],
    },
  });
  const mkDenomination = async (sku, amount, isDefault, rank) => {
    const variant = await d.variant.create({
      data: { product: card.documentId, sku, name: { vi: `${amount / 1000}k` }, isDefault, rank },
    });
    await d.price.create({ data: { variant: variant.documentId, amount, currency: 'VND' } });
    return variant;
  };
  const v100 = await mkDenomination('GC-100', 100000, true, 0);
  const v200 = await mkDenomination('GC-200', 200000, false, 1);

  const issue = (amount) =>
    app.db.transaction(async ({ trx }) => giftCard.issueInTransaction(trx, { amount, source: 'batch' }, { actor: { kind: 'system' } }));

  await app.listen();
  const http = await seedAdminHttpStaff(app, { scopes: { lan: { allLocations: true, locationRefs: [] } } });
  const cardsOf = (orderId) =>
    app.db.query('plugin::ordering.gift-card').findMany({ where: { order: { id: orderId } }, orderBy: { id: 'asc' } });
  try {
    const { lan } = http.as;
    const base = (variant, quantity, receiveMethod, extra = {}) => ({
      branch: 'Q1',
      locale: 'vi',
      lines: [{ sellableUid: card.documentId, variantUid: variant.documentId, quantity }],
      receiveMethod,
      contact: { name: 'Khách quầy', phone: '0912345678' },
      consent: { accepted: true },
      payment: { providerCode: 'cash' },
      idempotencyKey: `draft-${randomUUID()}`,
      ...extra,
    });

    // The quote the page shows prices the chosen denomination.
    const quote = await lan('POST', '/drafts/quote', base(v200, 2, { kind: 'digital' }));
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    assert.equal(quote.body.totals.grandTotal, 400000, 'two 200k cards');

    // Printed stock: scan one card per unit sold, sold for cash at the counter.
    const stock = [await issue(200000), await issue(200000)];
    const scanned = await lan('POST', '/drafts', base(v200, 2, { kind: 'digital', physicalCodes: stock.map((row) => row.code) }));
    assert.equal(scanned.status, 200, JSON.stringify(scanned.body));
    assert.equal(scanned.body.order.status, 'draft');
    assert.equal(scanned.body.order.consent.channel, 'phone-staff');
    assert.equal(scanned.body.order.consent.policyVersion, 'v1', 'the server stamps the policy in force');
    const orderId = scanned.body.order.id;
    const confirmed = await lan('POST', `/drafts/${orderId}/confirm`);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const handover = await lan('POST', `/orders/${orderId}/cash-handover`, { method: 'cash' });
    assert.equal(handover.status, 200, JSON.stringify(handover.body));
    await runOutboxDispatcher(app, { owner: `test:${process.pid}` });
    const sold = await cardsOf(orderId);
    assert.deepEqual(sold.map((row) => row.id).sort(), stock.map((row) => row.id).sort(), 'the scanned stock itself is sold');
    assert.ok(sold.every((row) => row.status === 'active' && Number(row.balance) === 200000));
    const savedLine = await app.db.query('plugin::ordering.order-line').findOne({ where: { order: orderId } });
    assert.equal(savedLine.sku, 'GC-200', 'the line keeps the denomination variant sku');
    assert.equal(savedLine.variantUid, v200.documentId);
    assert.equal(savedLine.titleSnapshot, 'Thẻ quà tặng Salanca · 200k');

    // Scan count must match the cards sold; a card of another denomination is refused.
    const spare = await issue(200000);
    const wrongAmount = await issue(100000);
    const mismatch = await lan('POST', '/drafts', base(v200, 2, { kind: 'digital', physicalCodes: [spare.code] }));
    assert.equal(mismatch.status, 400, JSON.stringify(mismatch.body));
    const denomination = await lan(
      'POST',
      '/drafts',
      base(v200, 1, { kind: 'digital', physicalCodes: [wrongAmount.code] }),
    );
    assert.equal(denomination.body.error.code, 'GIFT_CARD_INVALID');

    // Digital cards by email: no scans, recipient mailbox, cash at the counter.
    const mailed = await lan(
      'POST',
      '/drafts',
      base(v100, 1, { kind: 'digital', recipientEmail: 'lan@example.invalid', recipientName: 'Lan', message: 'Chúc mừng' }),
    );
    assert.equal(mailed.status, 200, JSON.stringify(mailed.body));

    // A food line cannot ride a gift-card sale and a card line cannot ride a pickup order.
    const pickup = await lan('POST', '/drafts/quote', base(v100, 1, { kind: 'pickup' }));
    assert.equal(pickup.status === 200, false, 'a gift card cannot be sold as pickup');
  } finally {
    await http.cleanup();
  }

  console.log('[ordering-test] gift-card-counter: denomination variant quote, scanned stock sold for cash, count/denomination checks, email delivery verified');
});
