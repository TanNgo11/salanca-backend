// O15: every audited staff action writes exactly one admin-change-log row with the actor, branch,
// order, category and label — and no customer data. Covers the order flow (via the timeline hook),
// the payment link, catalog edits through the Document Service (no duplicate row for categories).
import assert from 'node:assert/strict';

import {
  basicOrderInput,
  seedAdminHttpStaff,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  await app.listen();
  const { order } = services(app);
  const logs = () => app.db.query('plugin::ordering.admin-change-log');
  const staff = await seedAdminHttpStaff(app, {
    scopes: { quanly: { allLocations: false, locationRefs: ['Q1'] } },
  });
  const actorRef = `admin:${staff.users.quanly.id}`;
  const as = staff.as.quanly;

  /** Rows written since `afterId` for one action. */
  const rowsSince = async (afterId, action) =>
    logs().findMany({ where: { id: { $gt: afterId }, action }, orderBy: { id: 'asc' } });
  const lastId = async () => (await logs().findOne({ orderBy: { id: 'desc' }, select: ['id'] }))?.id ?? 0;
  const place = async () => (await order.createOrder(basicOrderInput(), systemCtx)).order;

  /** Runs `fn`, then asserts exactly one row of `action` with the order context and no PII. */
  const expectOne = async (action, fn, check = () => undefined) => {
    const before = await lastId();
    const result = await fn();
    const rows = await rowsSince(before, action);
    assert.equal(rows.length, 1, `${action}: exactly one change-log row (got ${rows.length})`);
    const [row] = rows;
    assert.equal(row.actorRef, actorRef, `${action}: actor`);
    assert.ok(row.category && row.category !== 'other', `${action}: category from the catalog`);
    const text = JSON.stringify(row.changes ?? {});
    assert.doesNotMatch(text, /Khách test|\+84900000001|0900000001/, `${action}: no customer data`);
    check(row, result);
    return row;
  };

  try {
    // ── Order flow (timeline hook) ──────────────────────────────────────────────
    const first = await place();
    const firstId = first.order.id;
    const accepted = await expectOne('order.transition', () =>
      as('POST', `/orders/${firstId}/transition`, { to: 'preparing' }),
      (row) => {
        assert.equal(row.orderId, firstId);
        assert.equal(row.entityLabel, first.order.code);
        assert.equal(row.locationRef, 'Q1');
        assert.equal(row.category, 'order');
        assert.deepEqual(row.changes.status, { before: 'awaiting-acceptance', after: 'preparing' });
        assert.ok(row.requestId, 'an admin request carries a request id');
      },
    );
    const lineId = first.lines.find((line) => line.sellableUid === 'tra-dao').id;
    await expectOne('order.line-cancel', () =>
      as('POST', `/orders/${firstId}/lines/${lineId}/cancel`, { quantity: 1, reason: 'Khách test đổi ý' }),
      (row) => {
        assert.equal(row.changes.quantity.after, 1);
        assert.equal(row.changes.reasonCode, undefined, 'free-text reason is not stored');
      },
    );
    await as('POST', `/orders/${firstId}/transition`, { to: 'ready' });
    const handoverBefore = await lastId();
    const handover = await as('POST', `/orders/${firstId}/cash-handover`, { method: 'cash' });
    assert.equal(handover.status, 200, JSON.stringify(handover.body));
    const capture = await rowsSince(handoverBefore, 'payment.cash-capture');
    const complete = await rowsSince(handoverBefore, 'order.complete');
    assert.equal(capture.length, 1, 'cash handover logs one cash capture');
    assert.equal(complete.length, 1, 'cash handover logs one completion');
    assert.equal(capture[0].category, 'money');
    assert.equal(capture[0].requestId, complete[0].requestId, 'one request id for the handover');
    assert.notEqual(capture[0].requestId, accepted.requestId, 'a new request gets a new id');

    const second = await place();
    await expectOne('order.reject', () =>
      as('POST', `/orders/${second.order.id}/transition`, {
        to: 'rejected',
        reasonCode: 'other',
        note: 'Khách test 0900000001 gọi hủy',
      }),
      (row) => assert.deepEqual(row.changes.status, { before: 'awaiting-acceptance', after: 'rejected' }),
    );

    const third = await place();
    await expectOne('order.cancel', () =>
      as('POST', `/orders/${third.order.id}/cancel`, { reasonCode: 'other', note: 'Khách test hủy' }),
      (row) => assert.equal(row.changes.status.after, 'canceled'),
    );

    // ── Payment link (prepay branch with SePay test settings) ──────────────────────
    const branches = app.db.query('plugin::ordering.branch');
    const q1 = await branches.findOne({ where: { code: 'Q1' } });
    await branches.update({
      where: { id: q1.id },
      data: {
        fulfillment: {
          pickup: { enabled: true, paymentTiming: 'prepay', paymentProviders: ['sepay'], paymentTimeoutMinutes: 15 },
        },
      },
    });
    const prepaid = await place();
    await expectOne('payment-link.issue', () => as('POST', `/orders/${prepaid.order.id}/payment-link`), (row, res) => {
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(row.orderId, prepaid.order.id);
      assert.doesNotMatch(JSON.stringify(row.changes), /#p=|https?:/, 'never the link or token');
    });

    // ── Catalog: Document Service middleware + category service (no duplicates) ────
    const category = await expectOne('catalog-category.create', () =>
      as('POST', '/categories', { name: { vi: 'Đồ uống O15', en: 'Drinks O15' } }),
      (row, res) => assert.equal(res.status, 201, JSON.stringify(res.body)),
    );
    assert.equal(category.category, 'catalog');

    const product = await app.documents('plugin::ordering.catalog-product').create({
      data: { productType: 'food', status: 'active', sellOnline: true, fulfillmentKinds: ['pickup'], name: { vi: 'Trà O15' } },
    });
    const variant = await app.documents('plugin::ordering.catalog-variant').create({
      data: { product: product.documentId, name: { vi: 'Ly lớn' }, sku: 'O15-L' },
    });
    const price = await app.documents('plugin::ordering.catalog-price').create({
      data: { variant: variant.documentId, amount: 65000, currency: 'VND' },
    });
    const priceBefore = await lastId();
    await app.documents('plugin::ordering.catalog-price').update({
      documentId: price.documentId,
      data: { amount: 60000 },
    });
    const priceRows = await rowsSince(priceBefore, 'catalog-price.update');
    assert.equal(priceRows.length, 1, 'one row for a price edit');
    assert.equal(Number(priceRows[0].changes.amount.before), 65000);
    assert.equal(Number(priceRows[0].changes.amount.after), 60000);
    assert.equal(priceRows[0].category, 'catalog');
    const productRow = (await logs().findMany({ where: { action: 'catalog-product.create', entityId: product.documentId } }))[0];
    assert.equal(productRow.entityLabel, 'Trà O15', 'catalog rows carry the item name as label');

    // O8: promotions have their own category; codes are logged by their last 4 characters only.
    await expectOne(
      'promotion.create',
      async () => {
        const res = await as('POST', '/promotions', {
          name: { vi: 'Giảm O15' },
          kind: 'code',
          discountType: 'amount',
          value: 10000,
          target: { kind: 'order', refs: [] },
          receiveKinds: ['pickup'],
          startsAt: '2026-01-01T00:00:00.000Z',
          code: 'AUDITMA2026',
        });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        return res;
      },
      (row) => {
        assert.equal(row.category, 'promotion');
        assert.equal(row.entityLabel, 'Giảm O15');
        assert.doesNotMatch(JSON.stringify(row.changes ?? {}), /AUDITMA2026/, 'the full code stays out of the log');
      },
    );

    console.log('[ordering-test] audit coverage: order flow, cash, reject, cancel, payment link, catalog, promotion — one row each');
  } finally {
    await staff.cleanup();
  }
});
