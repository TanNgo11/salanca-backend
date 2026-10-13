// O6 step 4: sales report — business-date range, scoped branches, groupings. Revenue and
// refunds come from the payment/refund ledgers; "sold orders" are open/completed orders;
// category/product rows read the order-line snapshots only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { seedAdminHttpStaff, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const orderInput = (locationRef, lines, overrides = {}) => ({
  idempotencyKey: randomUUID(),
  locationRef,
  locale: 'vi',
  lines,
  receiveMethod: { kind: 'pickup', locationRef },
  contact: { name: 'Khách test', phone: '+84900000001' },
  consent: { policyVersion: 'v1', channel: 'web-checkout' },
  origin: { kind: 'storefront' },
  ...overrides,
});

const move = async (call, orderId, to, extra = {}) => {
  const res = await call('POST', `/orders/${orderId}/transition`, { to, ...extra });
  assert.equal(res.status, 200, `transition ${to} must succeed (${JSON.stringify(res.body)})`);
};

const handover = async (call, orderId) => {
  const res = await call('POST', `/orders/${orderId}/cash-handover`, { method: 'cash' });
  assert.equal(res.status, 200, `cash-handover must succeed (${JSON.stringify(res.body)})`);
};

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const { order, transition, payment } = services(app);
  const adminOrders = app.plugin('ordering').service('admin-orders');
  const today = await adminOrders.todayFor('Q1');
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayDate = yesterday.toISOString().slice(0, 10);

  await app.listen();

  const staff = await seedAdminHttpStaff(app, {
    actions: ['order.read', 'order.process', 'payment.record-cash', 'refund.manage', 'report.read'],
    scopes: {
      quanly: { allLocations: false, locationRefs: ['Q1'] },
      ketoan: { allLocations: true, locationRefs: [] },
      nvq3: { allLocations: false, locationRefs: ['Q3'] },
      moi: null,
    },
  });

  const sales = (call, query) => call('GET', `/reports/sales?${query}`);

  try {
    // ── 1. Fixture: 3 paid + 1 paid-then-refunded today, 1 yesterday, 1 canceled, 1 Q3 test ──
    const totals = [
      [{ sellableUid: 'bun-bo', quantity: 2 }], // 130.000
      [{ sellableUid: 'tra-dao', quantity: 1 }], // 45.000
      [{ sellableUid: 'goi-cuon', quantity: 4 }], // 60.000
      [{ sellableUid: 'tra-dao', quantity: 2 }], // 90.000 — refunded 20.000 below
    ];
    const paidToday = [];
    for (const lines of totals) {
      const id = (await order.createOrder(orderInput('Q1', lines), systemCtx)).order.order.id;
      await move(staff.as.quanly, id, 'preparing');
      await move(staff.as.quanly, id, 'ready');
      await handover(staff.as.quanly, id);
      paidToday.push(id);
    }

    const refundRes = await staff.as.quanly('POST', `/orders/${paidToday[3]}/refunds`, {
      method: 'cash',
      amount: 20000,
      reason: 'khách đổi món',
    });
    assert.equal(refundRes.status, 200, JSON.stringify(refundRes.body));

    // Yesterday by business date (placed 01:30 VN today, before the 04:00 cutoff).
    const late = (await order.createOrder(
      orderInput('Q1', [{ sellableUid: 'tra-dao', quantity: 1 }], {
        placedAt: `${today}T01:30:00+07:00`,
      }),
      systemCtx,
    )).order.order.id;
    await move(staff.as.quanly, late, 'preparing');
    await move(staff.as.quanly, late, 'ready');
    await handover(staff.as.quanly, late);

    // Canceled before any payment: must not count anywhere.
    const doomed = (await order.createOrder(
      orderInput('Q1', [{ sellableUid: 'bun-bo', quantity: 1 }]),
      systemCtx,
    )).order.order.id;
    await transition.cancelOrder({ orderId: doomed, reason: 'khách đổi ý' }, systemCtx);

    // Q3 order captured through the 'test' provider (service-level, like payment-refund.mjs).
    const q3Order = (await order.createOrder(
      orderInput('Q3', [{ sellableUid: 'goi-cuon', quantity: 2 }]),
      systemCtx,
    )).order.order.id;
    const intent = await payment.createPayment({ orderId: q3Order, providerCode: 'test' }, systemCtx);
    const captured = await payment.capturePayment(
      { paymentId: intent.id, amount: intent.requestedAmount, providerTransactionId: `rep-${randomUUID()}` },
      systemCtx,
    );
    assert.equal(captured.payment.status, 'captured');
    console.log('[ordering-test] fixture: 4 paid Q1 today, 1 refunded, 1 yesterday, 1 canceled, 1 Q3 test');

    // ── 2. Day report for Q1 today matches the ledger exactly ───────────────────
    const day = await sales(staff.as.quanly, `branch=Q1&from=${today}&to=${today}&groupBy=day`);
    assert.equal(day.status, 200, JSON.stringify(day.body));
    const grossToday = 130000 + 45000 + 60000 + 90000;
    assert.equal(day.body.summary.orders, 4, 'four paid orders today (canceled and yesterday excluded)');
    assert.equal(day.body.summary.gross, grossToday);
    assert.equal(day.body.summary.refunded, 20000);
    const dbRevenue = await app.db
      .connection('plugins_ordering_payment as p')
      .join('plugins_ordering_payment_order_lnk as link', 'link.payment_id', 'p.id')
      .join('plugins_ordering_order as o', 'o.id', 'link.order_id')
      .where('o.location_ref', 'Q1')
      .where('p.status', 'captured')
      .where('p.business_date', today)
      .sum('p.captured_amount as total')
      .first();
    assert.equal(
      day.body.summary.revenue,
      Number(dbRevenue.total),
      'summary.revenue must equal Σ payment.captured_amount for the day',
    );
    assert.equal(day.body.summary.net, day.body.summary.revenue - 20000);
    assert.equal(day.body.summary.averageOrder, Math.round(grossToday / 4));
    assert.equal(day.body.summary.discount, 0, 'no promotion yet: no discount');
    assert.equal(day.body.rows.length, 1);
    assert.equal(day.body.rows[0].key, today);
    assert.equal(day.body.rows[0].revenue, day.body.summary.revenue);
    console.log('[ordering-test] day: orders 4, revenue matches Σ captured, refunded 20.000');

    // ── 3. Two-day range splits per business date ────────────────────────────────
    const span = await sales(
      staff.as.quanly,
      `branch=Q1&from=${yesterdayDate}&to=${today}&groupBy=day`,
    );
    assert.equal(span.status, 200);
    assert.equal(span.body.rows.length, 2, 'one row per business date with data');
    const yesterdayRow = span.body.rows.find((row) => row.key === yesterdayDate);
    assert.ok(yesterdayRow, 'yesterday must appear');
    assert.equal(yesterdayRow.orders, 1);
    assert.equal(yesterdayRow.revenue, 45000);
    assert.equal(
      span.body.rows.reduce((sum, row) => sum + row.revenue, 0),
      span.body.summary.revenue,
      'Σ day.revenue must equal summary.revenue',
    );
    console.log('[ordering-test] range: two day rows, Σ rows.revenue = summary.revenue');

    // ── 4. Category and product groupings read the order-line snapshots ──────────
    const category = await sales(
      staff.as.quanly,
      `branch=Q1&from=${today}&to=${today}&groupBy=category`,
    );
    assert.equal(category.status, 200);
    const main = category.body.rows.find((row) => row.key === 'mon-chinh');
    assert.ok(main, 'mon-chinh category row must exist');
    assert.equal(main.label, 'Món chính');
    assert.equal(main.quantity, 2 + 1 + 4 + 2, 'Σ (quantity − canceled) over sold lines');
    assert.equal(main.gross, grossToday);
    const product = await sales(
      staff.as.quanly,
      `branch=Q1&from=${today}&to=${today}&groupBy=product`,
    );
    assert.equal(product.status, 200);
    const bunBo = product.body.rows.find((row) => row.key === 'bun-bo');
    assert.ok(bunBo, 'bun-bo product row must exist');
    assert.equal(bunBo.label, 'Bún bò');
    assert.equal(bunBo.quantity, 2);
    const productGross = product.body.rows.reduce((sum, row) => sum + row.gross, 0);
    const categoryGross = category.body.rows.reduce((sum, row) => sum + row.gross, 0);
    assert.equal(productGross, categoryGross, 'Σ gross by product must equal Σ gross by category');
    console.log('[ordering-test] category/product: mon-chinh qty 9, gross totals match');

    // ── 5. Payment grouping + implicit branch scope ──────────────────────────────
    const byPayment = await sales(
      staff.as.quanly,
      `branch=Q1&from=${today}&to=${today}&groupBy=payment`,
    );
    assert.equal(byPayment.status, 200);
    const cashRow = byPayment.body.rows.find((row) => row.key === 'cash');
    assert.ok(cashRow, 'cash provider row must exist');
    assert.equal(cashRow.orders, 4);
    assert.equal(cashRow.revenue, grossToday);
    assert.equal(cashRow.refunded, 20000);
    const unscoped = await sales(
      staff.as.quanly,
      `from=${today}&to=${today}&groupBy=payment`,
    );
    assert.equal(unscoped.status, 200);
    assert.equal(unscoped.body.summary.orders, 4, 'quanly without branch still sees only Q1');
    assert.ok(!unscoped.body.rows.some((row) => row.key === 'test'), 'the Q3 test payment stays out');
    const allScope = await sales(
      staff.as.ketoan,
      `from=${today}&to=${today}&groupBy=payment`,
    );
    assert.equal(allScope.status, 200);
    const providerKeys = allScope.body.rows.map((row) => row.key).sort();
    assert.deepEqual(providerKeys, ['cash', 'test'], 'ketoan sees both providers across branches');
    console.log('[ordering-test] payment: cash row exact; scope narrows to Q1; ketoan sees cash+test');

    const byReceive = await sales(
      staff.as.quanly,
      `branch=Q1&from=${today}&to=${today}&groupBy=receive`,
    );
    assert.equal(byReceive.status, 200);
    const pickupRow = byReceive.body.rows.find((row) => row.key === 'pickup');
    assert.ok(pickupRow, 'pickup receive-method row must exist');
    assert.equal(pickupRow.orders, 4);
    assert.equal(pickupRow.gross, grossToday);

    // ── 6. Scope denials ─────────────────────────────────────────────────────────
    const denied = await sales(staff.as.nvq3, `branch=Q1&from=${today}&to=${today}`);
    assert.equal(denied.status, 404, 'out-of-scope branch must answer 404');
    const noScope = await sales(staff.as.moi, `from=${today}&to=${today}`);
    assert.equal(noScope.status, 403, 'unscoped staff must answer 403');
    assert.equal(noScope.body.error.code, 'SCOPE_REQUIRED');
    console.log('[ordering-test] scope: nvq3 → 404, moi → 403 SCOPE_REQUIRED');

    // ── 6b. O8 promotions: discount summary + groupBy=promotion (from order adjustments) ──
    const promo = await app.db.query('plugin::ordering.promotion').create({
      data: {
        name: { vi: 'Giảm 20.000đ' },
        kind: 'code',
        discountType: 'amount',
        value: 20000,
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
      data: { promotionId: promo.id, code: 'BAOCAO20', usedCount: 0, active: true },
    });
    const promoOrders = [];
    for (const phone of ['+84900000101', '+84900000102']) {
      const created = await order.createOrder(
        orderInput('Q1', [{ sellableUid: 'bun-bo', quantity: 1 }], {
          promotionCode: 'baocao20',
          contact: { name: 'Khách test', phone },
        }),
        systemCtx,
      );
      assert.equal(created.order.order.adjustmentAmount, -20000);
      promoOrders.push(created.order.order);
    }
    const withPromo = await sales(staff.as.quanly, `branch=Q1&from=${today}&to=${today}&groupBy=promotion`);
    assert.equal(withPromo.status, 200, JSON.stringify(withPromo.body));
    assert.equal(withPromo.body.summary.discount, 40000, 'summary.discount = Σ discount adjustments');
    assert.equal(withPromo.body.rows.length, 1);
    assert.equal(withPromo.body.rows[0].key, `promotion:${promo.id}`);
    assert.equal(withPromo.body.rows[0].orders, 2);
    assert.equal(withPromo.body.rows[0].discount, 40000);
    assert.equal(
      withPromo.body.rows[0].gross,
      promoOrders.reduce((sum, row) => sum + Number(row.totalAmount), 0),
    );
    await transition.cancelOrder({ orderId: promoOrders[1].id, reason: 'khách đổi ý' }, systemCtx);
    const afterCancel = await sales(staff.as.quanly, `branch=Q1&from=${today}&to=${today}&groupBy=promotion`);
    assert.equal(afterCancel.body.summary.discount, 20000, 'a canceled order leaves the discount total');
    assert.equal(afterCancel.body.rows[0].orders, 1);
    console.log('[ordering-test] promotion: discount 40.000 over 2 orders, 20.000 after one is canceled');

    // ── 7. Validation ────────────────────────────────────────────────────────────
    const inverted = await sales(staff.as.quanly, `branch=Q1&from=${today}&to=${yesterdayDate}`);
    assert.equal(inverted.status, 400);
    assert.equal(inverted.body.error.details.field, 'to');
    const tooWide = await sales(
      staff.as.quanly,
      `branch=Q1&from=2020-01-01&to=2021-05-01&groupBy=day`,
    );
    assert.equal(tooWide.status, 400);
    assert.equal(tooWide.body.error.details.field, 'to');
    const badGroup = await sales(staff.as.quanly, `branch=Q1&from=${today}&to=${today}&groupBy=xyz`);
    assert.equal(badGroup.status, 400);
    assert.equal(badGroup.body.error.details.field, 'groupBy');
    console.log('[ordering-test] validation: inverted/wide range and bad groupBy → 400');

    console.log('[ordering-test] reports: all checks passed');
  } finally {
    await staff.cleanup();
  }
});
