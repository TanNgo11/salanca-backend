import assert from 'node:assert/strict';

// O12 step 5 (screens N1): HTTP-level check of the print payloads behind
// GET /ordering/print/orders/:id?doc=kitchen|receipt — kitchen tickets carry items and
// notes only (never prices, phone, or address), receipts carry totals with the phone
// masked, and `order.read` + location scope guard the route like every admin route.
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
  const { order } = services(app);
  await seedBranches(app);
  seedMenu(app);
  const branchRows = app.db.query('plugin::ordering.branch');
  const q1 = await branchRows.findOne({ where: { code: 'Q1' } });
  await branchRows.update({
    where: { id: q1.id },
    data: {
      printing: {
        width: 58,
        header: 'SALANCA QUẬN 1 — bếp nóng',
        footer: 'Cảm ơn quý khách',
        autoKitchenTicket: true,
      },
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          schedule: { openingHours: { mode: '24_7' } },
        },
        delivery: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          schedule: { openingHours: { mode: '24_7' } },
          zones: [
            {
              code: 'xt-zone',
              label: 'Xã test',
              priority: 0,
              match: { kind: 'commune', communeCodes: ['XT01002'] },
              rules: [{ when: 'any', fee: 0 }],
            },
          ],
        },
      },
    },
  });

  // A delivery order exercises every privacy edge: phone in contact AND address.
  const created = await order.createOrder(
    basicOrderInput({
      customerNote: 'giao cổng sau',
      receiveMethod: {
        kind: 'delivery',
        locationRef: 'Q1',
        address: {
          communeCode: 'xt01002',
          line1: '9 Đường riêng tư',
          recipientName: 'Khách test',
          phone: '+84900000001',
          note: 'gọi trước khi giao',
        },
      },
    }),
    systemCtx,
  );
  const orderId = created.order.order.id;
  const orderCode = created.order.order.code;
  const rawPhone = '9000000001';

  await app.listen();
  const http = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: {
      lan: { allLocations: false, locationRefs: ['Q1'] },
      other: { allLocations: false, locationRefs: ['Q3'] },
    },
  });
  const noRead = await seedAdminHttpStaff(app, {
    actions: ['order.process'],
    scopes: { processor: { allLocations: true, locationRefs: [] } },
  });
  try {
    const { lan, other } = http.as;

    // ── Kitchen ticket: items + notes, no money, no contact, no address ──────────────
    const kitchen = await lan('GET', `/print/orders/${orderId}?doc=kitchen`);
    assert.equal(kitchen.status, 200, JSON.stringify(kitchen.body));
    const k = kitchen.body.item;
    assert.equal(k.doc, 'kitchen');
    assert.equal(k.width, 58, 'branch printing.width flows through');
    assert.equal(k.autoKitchenTicket, true);
    assert.equal(k.header, 'SALANCA QUẬN 1 — bếp nóng');
    assert.equal(k.order.code, orderCode);
    assert.equal(k.receive.kind, 'delivery');
    assert.equal(k.lines.length, 3);
    assert.equal(k.lines.find((line) => line.title === 'Bún bò').quantity, 2);
    assert.equal(k.customerNote, 'giao cổng sau');
    const kJson = JSON.stringify(k);
    for (const forbidden of [
      rawPhone,
      'phoneMasked',
      'unitAmount',
      'lineTotalAmount',
      'totalAmount',
      'totals',
      'payments',
      'adjustments',
      'deliveryAddress',
      'contact',
      'line1',
    ]) {
      assert.ok(!kJson.includes(forbidden), `kitchen ticket must not contain ${forbidden}`);
    }

    // ── Receipt: totals + masked contact; address stripped of its phone ──────────────
    const receipt = await lan('GET', `/print/orders/${orderId}?doc=receipt`);
    assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
    const r = receipt.body.item;
    assert.equal(r.doc, 'receipt');
    assert.equal(r.totals.total, created.order.order.totalAmount);
    assert.ok(r.totals.due > 0, 'unpaid cash order shows a due amount');
    assert.equal(r.footer, 'Cảm ơn quý khách');
    assert.equal(r.contact.name, 'Khách test');
    assert.ok(r.contact.phoneMasked?.includes('•'), 'receipt phone is masked');
    const rJson = JSON.stringify(r);
    assert.ok(!rJson.includes(rawPhone), 'receipt must not leak the raw phone');
    assert.equal(r.deliveryAddress.line1, '9 Đường riêng tư');
    assert.equal(r.deliveryAddress.phone ?? null, null, 'address drops the raw phone');
    assert.equal(r.lines.every((line) => line.lineTotalAmount > 0), true, 'receipt lines carry amounts');

    // ── Validation + authorization ───────────────────────────────────────────────────
    assert.equal((await lan('GET', `/print/orders/${orderId}?doc=label`)).status, 400);
    assert.equal((await lan('GET', `/print/orders/${orderId}`)).status, 200, 'doc defaults to kitchen');
    assert.equal((await lan('GET', '/print/orders/999999?doc=kitchen')).status, 404);
    assert.equal(
      (await other('GET', `/print/orders/${orderId}?doc=receipt`)).status,
      404,
      'out-of-scope branches never reveal an order exists',
    );
    assert.equal(
      (await noRead.as.processor('GET', `/print/orders/${orderId}?doc=kitchen`)).status,
      403,
      'order.read is required',
    );

    console.log(
      '[ordering-test] print: kitchen ticket privacy (no price/phone/address), masked receipt, width/header/footer, scope + permission verified',
    );
  } finally {
    await http.cleanup();
    await noRead.cleanup();
  }
});
