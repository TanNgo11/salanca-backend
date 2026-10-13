// O6 step 5: order CSV export — scoped branches, PII columns, formula-injection escaping,
// UTF-8 BOM, the row/day caps and the `export` permission gate.
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

const ADDRESS = {
  communeCode: 'XT01002',
  line1: '12 Đường Bí Mật',
  recipientName: 'Người Thử',
  phone: '0901234567',
};

const zone = {
  code: 'near',
  label: 'Gần',
  priority: 10,
  match: { kind: 'commune', communeCodes: ['XT01001', 'XT01002'] },
  rules: [{ when: 'any', fee: 0 }],
  minOrderAmount: 0,
  extraLeadTimeMinutes: 30,
};

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const { order, transition } = services(app);
  const plugin = app.plugin('ordering');
  const adminOrders = plugin.service('admin-orders');
  const today = await adminOrders.todayFor('Q1');

  // Q1 delivers so the export has one delivery row (address column).
  const branches = app.db.query('plugin::ordering.branch');
  const q1 = await branches.findOne({ where: { code: 'Q1' } });
  await branches.update({
    where: { id: q1.id },
    data: {
      fulfillment: {
        pickup: { enabled: true, paymentTiming: 'pay-on-pickup' },
        delivery: {
          enabled: true,
          orderTiming: 'both',
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          minOrderAmount: 0,
          schedule: {
            leadTimeMinutes: 60,
            slotLengthMinutes: 15,
            capacity: 8,
            openingHours: { mode: '24_7' },
          },
          zones: [zone],
        },
      },
    },
  });

  await app.listen();

  const staff = await seedAdminHttpStaff(app, {
    actions: ['export'],
    scopes: {
      xuat: { allLocations: false, locationRefs: ['Q1'] },
      ketoan: { allLocations: true, locationRefs: [] },
    },
  });
  const reader = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { doc: { allLocations: false, locationRefs: ['Q1'] } },
  });

  const base = `http://127.0.0.1:${process.env.PORT}`;
  const rawAs = (holder, name) => async (path) => {
    const token = await holder.tokenOf(name);
    const res = await fetch(`${base}/ordering${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // res.text() would strip the leading UTF-8 BOM; decode with ignoreBOM to keep it.
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
      await res.arrayBuffer(),
    );
    return { status: res.status, headers: res.headers, text };
  };

  try {
    // ── Fixture: Q1 orders (formula name, diacritics name, delivery, canceled) + Q3 ──
    const formula = (await order.createOrder(
      orderInput('Q1', [{ sellableUid: 'tra-dao', quantity: 1 }], {
        contact: { name: '=HYPERLINK("x")', phone: '+84900000002' },
      }),
      systemCtx,
    )).order.order.id;
    const diacritics = (await order.createOrder(
      orderInput('Q1', [{ sellableUid: 'bun-bo', quantity: 2 }], {
        contact: { name: 'Nguyễn Thị Hằng', phone: '+84900000003', email: 'hang@example.invalid' },
      }),
      systemCtx,
    )).order.order.id;
    const delivery = (await order.createOrder(
      orderInput('Q1', [{ sellableUid: 'goi-cuon', quantity: 3 }], {
        receiveMethod: { kind: 'delivery', address: ADDRESS },
        contact: { name: 'Khách Giao', phone: '+84900000004' },
      }),
      systemCtx,
    )).order.order.id;
    const doomed = (await order.createOrder(
      orderInput('Q1', [{ sellableUid: 'tra-dao', quantity: 1 }]),
      systemCtx,
    )).order.order.id;
    await transition.cancelOrder({ orderId: doomed, reason: 'khách đổi ý' }, systemCtx);
    const q3Order = (await order.createOrder(
      orderInput('Q3', [{ sellableUid: 'tra-dao', quantity: 1 }]),
      systemCtx,
    )).order.order.id;
    const codeOf = async (id) => (await order.getOrder(id, systemCtx)).order.code;
    const q3Code = await codeOf(q3Order);
    const formulaCode = await codeOf(formula);
    console.log('[ordering-test] fixture: 4 Q1 orders (incl. formula name + delivery + canceled), 1 Q3');

    // ── Scoped export: CSV shape, BOM, columns, escaping ─────────────────────────
    const exportFor = rawAs(staff, 'xuat');
    const res = await exportFor(`/orders/export?from=${today}&to=${today}&branch=Q1`);
    assert.equal(res.status, 200, res.text.slice(0, 300));
    const contentType = res.headers.get('content-type') ?? '';
    assert.ok(contentType.includes('text/csv'), `content-type must be csv (${contentType})`);
    const disposition = res.headers.get('content-disposition') ?? '';
    assert.match(disposition, /attachment; filename="don-hang-Q1-/);
    const csv = res.text;
    assert.ok(csv.startsWith('﻿'), 'csv must open with a UTF-8 BOM');
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    assert.match(lines[0], /^"Mã đơn","Ngày kinh doanh","Đặt lúc","Chi nhánh","Trạng thái"/);
    assert.ok(lines[0].includes('"Giảm/phụ phí","Khuyến mãi","Phí giao"'), 'O8 promotion column after adjustments');
    assert.equal(lines.length - 1, 4, 'four Q1 orders today — the Q3 order must stay out');
    assert.ok(!csv.includes(q3Code), 'Q3 order code must not appear in a Q1 export');
    assert.ok(
      csv.includes(`"'=HYPERLINK(""x"")"`),
      'formula-like customer name must be quoted and defused',
    );
    assert.ok(csv.includes('Nguyễn Thị Hằng'), 'diacritics round-trip through the BOM csv');
    assert.ok(csv.includes(formulaCode));
    assert.ok(csv.includes('12 Đường Bí Mật'), 'delivery address column is populated');
    const canceledLine = lines.find((line) => line.includes('"canceled"'));
    assert.ok(canceledLine, 'the canceled order appears with status canceled');
    console.log('[ordering-test] csv: BOM, headers, 4 rows, formula escaped, canceled included');

    // ── Permission + scope gates ────────────────────────────────────────────────
    const denied = await rawAs(reader, 'doc')(`/orders/export?from=${today}&to=${today}`);
    assert.equal(denied.status, 403, 'order.read without export must be denied');
    const outScope = await exportFor(`/orders/export?from=${today}&to=${today}&branch=Q3`);
    assert.equal(outScope.status, 404, 'out-of-scope branch must answer 404');
    const allScope = await rawAs(staff, 'ketoan')(`/orders/export?from=${today}&to=${today}`);
    assert.equal(allScope.status, 200);
    assert.ok(allScope.text.includes(q3Code), 'all-location export includes Q3');
    assert.ok(allScope.text.includes(formulaCode), 'all-location export includes Q1');
    console.log('[ordering-test] gates: no-export → 403, out-of-scope → 404, all-scope sees both');

    // ── Validation ──────────────────────────────────────────────────────────────
    const missingTo = await exportFor(`/orders/export?from=${today}`);
    assert.equal(missingTo.status, 400);
    const wide = await exportFor(`/orders/export?from=2020-01-01&to=2020-05-01`);
    assert.equal(wide.status, 400, 'a >92-day range is rejected');
    console.log('[ordering-test] validation: missing to / 100-day range → 400');

    // ── Row cap via the injectable limit (no 10k fixtures needed) ───────────────
    const exporter = plugin.service('order-export');
    await assert.rejects(
      exporter.exportCsv({ from: today, to: today, branch: 'Q1', maxRows: 1 }, systemCtx),
      (error) => error.code === 'EXPORT_TOO_LARGE',
    );
    console.log('[ordering-test] cap: maxRows exceeded → EXPORT_TOO_LARGE');

    console.log('[ordering-test] order-export: all checks passed');
  } finally {
    await staff.cleanup();
    await reader.cleanup();
  }
});
