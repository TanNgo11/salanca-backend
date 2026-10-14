// Regressions from the post-O11 review: (1) a branch-scoped staff member sees only their
// branches' orders on a customer profile and in its export; (2) a customer cancel of a paid
// order refunds it in the same transaction; (3) customers backfilled by the O11 migration get
// a documentId; (4) two concurrent "add line" calls on one cart both persist.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_review_fixes node scripts/ordering/review-extra.mjs
import assert from 'node:assert/strict';

import { o11CustomerDocumentIdsMigration } from '../../src/plugins/ordering/dist/server/src/migrations/0009b-o11-customer-document-ids.js';
import { newDocumentId } from '../../src/plugins/ordering/dist/server/src/migrations/document-id.js';
import { basicOrderInput, cleanupStaff, seedBranches, seedMenu, seedStaff, services, systemCtx, withApp } from './_harness.mjs';

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const plugin = app.plugin('ordering');
  const { order, payment } = services(app);
  const staff = await seedStaff(app);
  const lanCtx = { actor: staff.lan.actor };
  try {
    // ── 1. Scope on the customer profile and its export ─────────────────────────────────
    const phone = '+84907770001';
    const atQ1 = await order.createOrder(basicOrderInput({ adjustments: [], contact: { name: 'Khách', phone } }), systemCtx);
    const atQ3 = await order.createOrder(
      basicOrderInput({ adjustments: [], locationRef: 'Q3', receiveMethod: { kind: 'pickup', locationRef: 'Q3' }, contact: { name: 'Khách', phone } }),
      systemCtx,
    );
    const linked = await app.db.query('plugin::ordering.order').findOne({
      where: { id: atQ1.order.order.id },
      populate: { customer: true },
    });
    assert.ok(linked.customer, 'the order is linked to a customer profile');
    const documentId = linked.customer.documentId;
    const detail = await plugin.service('admin-customers').detail(documentId, lanCtx);
    const codes = detail.orders.map((row) => row.code);
    assert.ok(codes.includes(atQ1.order.order.code), 'Q1 staff see the Q1 order');
    assert.ok(!codes.includes(atQ3.order.order.code), 'Q1 staff do not see the Q3 order on the profile');
    const exported = await plugin.service('data-rights').exportForStaff(documentId, lanCtx);
    assert.deepEqual(exported.orders.map((row) => row.code), [atQ1.order.order.code], 'export is scoped too');
    const allDetail = await plugin.service('admin-customers').detail(documentId, { actor: staff.keToan.actor });
    assert.equal(allDetail.orders.length, 2, 'all-location staff still see both');
    console.log('[ordering-test] review: customer profile and export show only in-scope orders');

    // ── 2. Customer cancel of a paid order refunds it ──────────────────────────────────
    const paid = await order.createOrder(basicOrderInput({ adjustments: [], contact: { name: 'Khách', phone: '+84907770002' } }), systemCtx);
    const paidId = paid.order.order.id;
    const intent = await payment.createPayment({ orderId: paidId, providerCode: 'test' }, systemCtx);
    await payment.capturePayment({ paymentId: intent.id, amount: 100000, providerTransactionId: 'review-cancel' }, systemCtx);
    await plugin.service('storefront').cancelByToken(paid.publicToken, 'đổi ý', { actor: { kind: 'customer' } });
    const after = await order.getOrder(paidId, systemCtx);
    assert.equal(after.order.status, 'canceled');
    const refunds = await app.db.query('plugin::ordering.refund').findMany({ where: { order: paidId } });
    assert.equal(refunds.length, 1, 'the self-cancel created a refund');
    assert.equal(Number(refunds[0].amount), 100000);
    console.log('[ordering-test] review: a customer cancel of a paid order refunds 100.000 in the same transaction');

    // ── 3. Customers backfilled by raw SQL get a documentId ─────────────────────────────
    assert.match(newDocumentId(), /^[a-z][a-z0-9]{23}$/);
    const knex = app.db.connection;
    const [raw] = await knex('plugins_ordering_customer')
      .insert({ phone: '+84907770003', phone_hash: `review-${Date.now()}`, status: 'unverified', order_count: 0, total_spent: 0, created_at: new Date(), updated_at: new Date() })
      .returning('id');
    const rawId = Number(raw.id ?? raw);
    assert.equal((await knex('plugins_ordering_customer').where({ id: rawId }).first('document_id')).document_id, null);
    await knex.transaction((trx) => o11CustomerDocumentIdsMigration.up(trx));
    const filled = (await knex('plugins_ordering_customer').where({ id: rawId }).first('document_id')).document_id;
    assert.match(filled, /^[a-z][a-z0-9]{23}$/, 'the migration filled the missing documentId');
    const opened = await app.db.query('plugin::ordering.customer').findOne({ where: { documentId: filled } });
    assert.equal(opened.id, rawId, 'the profile opens by its new documentId');
    console.log('[ordering-test] review: backfilled customers get a documentId and open by it');

    // ── 4. Concurrent adds on one cart keep both lines ─────────────────────────────────
    const carts = plugin.service('cart');
    const { row } = await carts.create({ locationRef: 'Q1', receiveMethod: { kind: 'pickup' } }, { customerId: null }, systemCtx);
    const results = await Promise.all([
      carts.addLine(row, { sellableUid: 'bun-bo', quantity: 1 }, systemCtx),
      carts.addLine(row, { sellableUid: 'tra-dao', quantity: 1 }, systemCtx),
      carts.addLine(row, { sellableUid: 'goi-cuon', quantity: 2 }, systemCtx),
    ]);
    assert.equal(results.length, 3);
    const stored = await app.db.query('plugin::ordering.cart').findOne({ where: { id: row.id } });
    const lines = typeof stored.lines === 'string' ? JSON.parse(stored.lines) : stored.lines;
    assert.deepEqual(lines.map((line) => line.sellableUid).sort(), ['bun-bo', 'goi-cuon', 'tra-dao'], 'no add is lost');
    console.log('[ordering-test] review: three concurrent adds on one cart keep all three lines');
  } finally {
    await cleanupStaff(app, staff);
  }
});
