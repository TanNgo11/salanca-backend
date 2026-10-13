// O8 step 5: promotion admin API (screens K1–K4) over HTTP — `promotion.manage` gates every
// route (403 without), the code CSV also needs `export`; create validates (percent ≤ 100, codes
// unique case-insensitively); tabs follow active/startsAt/endsAt; 500 generated codes are unique
// and avoid 0/O/1/I/L; a switched-off code stops quoting; an edit never rewrites past orders,
// `kind` or `usedCount`; redemptions list the orders; the change log never holds a full code.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o8 node scripts/ordering/promotions-admin.mjs
import assert from 'node:assert/strict';

import { basicOrderInput, seedAdminHttpStaff, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const body = (overrides = {}) => ({
  name: { vi: 'Giảm 10%', en: '10% off' },
  kind: 'code',
  discountType: 'percent',
  value: 10,
  maxDiscount: 30000,
  target: { kind: 'order', refs: [] },
  minSubtotal: 0,
  receiveKinds: ['pickup', 'delivery'],
  startsAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  await app.listen();
  const { order } = services(app);
  const staff = await seedAdminHttpStaff(app, {
    actions: ['promotion.manage', 'export'],
    scopes: { quanly: { allLocations: true, locationRefs: [] } },
  });
  const limited = await seedAdminHttpStaff(app, {
    actions: ['promotion.manage'],
    scopes: { nv: { allLocations: true, locationRefs: [] } },
  });
  const outsider = await seedAdminHttpStaff(app, {
    actions: ['order.read', 'report.read'],
    scopes: { xem: { allLocations: true, locationRefs: [] } },
  });
  const as = staff.as.quanly;

  try {
    assert.equal((await outsider.as.xem('GET', '/promotions')).status, 403);
    assert.equal((await outsider.as.xem('POST', '/promotions', body())).status, 403);

    const bad = await as('POST', '/promotions', body({ value: 150 }));
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.details.issues[0].path, 'value');
    const autoWithCode = await as('POST', '/promotions', body({ kind: 'auto', code: 'ABCD1234' }));
    assert.equal(autoWithCode.status, 400);

    const created = await as('POST', '/promotions', body({ code: 'tet2027' }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const promoId = created.body.promotion.id;
    assert.equal(created.body.promotion.status, 'running');
    assert.equal(created.body.codeCount, 1);
    const dup = await as('POST', '/promotions', body({ code: 'TET2027' }));
    assert.equal(dup.status, 400, 'codes are unique case-insensitively');
    assert.equal(await app.db.query('plugin::ordering.promotion').count(), 1, 'a failed create leaves no promotion');

    const scheduled = await as('POST', '/promotions', body({ kind: 'auto', name: { vi: 'Sắp chạy' }, startsAt: '2099-01-01T00:00:00.000Z' }));
    assert.equal(scheduled.body.promotion.status, 'scheduled');
    const tab = async (status) => (await as('GET', `/promotions?status=${status}`)).body.items.map((row) => row.id);
    assert.deepEqual(await tab('running'), [promoId]);
    assert.deepEqual(await tab('scheduled'), [scheduled.body.promotion.id]);
    assert.deepEqual((await as('GET', '/promotions?q=tet20')).body.items.map((row) => row.id), [promoId], 'search by code');
    assert.deepEqual((await as('GET', '/promotions?q=s%E1%BA%AFp')).body.items.map((row) => row.id), [scheduled.body.promotion.id], 'search by name');
    console.log('[ordering-test] promotions admin: 403 without promotion.manage, validation, unique code, tabs, search');

    // ── Codes ────────────────────────────────────────────────────────────────────
    const generated = await as('POST', `/promotions/${promoId}/codes`, {
      generate: { count: 500, prefix: 'TET', length: 10, batch: 'LO-TET' },
    });
    assert.equal(generated.status, 200, JSON.stringify(generated.body));
    assert.equal(generated.body.generated, 500);
    const rows = await app.db.query('plugin::ordering.promotion-code').findMany({ where: { promotionId: promoId, batch: 'LO-TET' } });
    assert.equal(rows.length, 500);
    assert.equal(new Set(rows.map((row) => row.code)).size, 500, 'generated codes are unique');
    for (const row of rows) {
      assert.match(row.code, /^TET[A-HJKMNP-Z2-9]{10}$/, 'no 0/O/1/I/L in a generated code');
      assert.equal(row.usageLimit, 1, 'generated codes default to one use');
    }
    assert.equal((await as('POST', `/promotions/${promoId}/codes`, { generate: { count: 5001 } })).status, 400);
    assert.equal((await as('POST', `/promotions/${scheduled.body.promotion.id}/codes`, { code: 'AUTO1234' })).status, 400);
    const page = await as('GET', `/promotions/${promoId}/codes?page=1`);
    assert.equal(page.body.pagination.total, 501);
    assert.equal(page.body.items.length, 50);

    const csv = await fetch(`http://127.0.0.1:${process.env.PORT}/ordering/promotions/${promoId}/codes/export`, {
      headers: { Authorization: `Bearer ${await staff.tokenOf('quanly')}` },
    });
    assert.equal(csv.status, 200);
    // fetch's text() drops a BOM; decode the bytes with ignoreBOM to see it.
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await csv.arrayBuffer());
    assert.ok(text.startsWith('﻿'), 'CSV opens with a BOM');
    assert.equal(text.replace('﻿', '').trim().split('\r\n').length, 502, 'header + 501 codes');
    assert.equal((await limited.as.nv('GET', `/promotions/${promoId}/codes/export`)).status, 403, 'export needs `export`');
    console.log('[ordering-test] codes: 500 unique generated without 0/O/1/I/L, CSV with BOM, export needs export');

    // A code switched off stops quoting.
    const tetCode = await app.db.query('plugin::ordering.promotion-code').findOne({ where: { code: 'TET2027' } });
    const quoteWith = async (code) => {
      const { idempotencyKey: _key, ...draft } = basicOrderInput({ adjustments: [], promotionCode: code });
      return order.quote({ ...draft, contact: { phone: '' } }, systemCtx);
    };
    assert.equal((await quoteWith('TET2027')).promotions[0].code, 'TET2027');
    assert.equal((await as('POST', `/promotion-codes/${tetCode.id}/active`, { active: false })).status, 200);
    assert.equal((await quoteWith('TET2027')).rejectedPromotions[0].reason, 'invalid');
    await as('POST', `/promotion-codes/${tetCode.id}/active`, { active: true });

    // ── Edit: past orders keep their discount; kind and usedCount are not writable ─────────
    const placed = await order.createOrder(basicOrderInput({ adjustments: [], promotionCode: 'TET2027' }), systemCtx);
    const pastDiscount = placed.order.order.adjustmentAmount;
    assert.ok(pastDiscount < 0);
    const edited = await as('PUT', `/promotions/${promoId}`, body({ value: 50, maxDiscount: null, kind: 'auto', usedCount: 99 }));
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.promotion.value, 50);
    assert.equal(edited.body.promotion.kind, 'code', 'kind is fixed after create');
    assert.equal(edited.body.promotion.usedCount, 1, 'usedCount is never written from input');
    const reloaded = await app.db.query('plugin::ordering.order').findOne({ where: { id: placed.order.order.id } });
    assert.equal(Number(reloaded.adjustmentAmount), pastDiscount, 'an edit does not reprice past orders');

    const off = await as('POST', `/promotions/${promoId}/active`, { active: false });
    assert.equal(off.body.promotion.status, 'off');
    assert.deepEqual(await tab('off'), [promoId]);
    await as('POST', `/promotions/${promoId}/active`, { active: true });

    const detail = await as('GET', `/promotions/${promoId}`);
    assert.equal(detail.body.stats.orders, 1);
    assert.equal(detail.body.stats.discountTotal, -pastDiscount);
    assert.equal(detail.body.stats.reserved, 1);
    const used = await as('GET', `/promotions/${promoId}/redemptions`);
    assert.equal(used.body.items.length, 1);
    assert.equal(used.body.items[0].orderCode, placed.order.order.code);
    assert.equal(used.body.items[0].code, 'TET2027');
    assert.equal(used.body.items[0].status, 'reserved');
    assert.equal((await as('GET', '/promotions/999999')).status, 404);

    const logs = await app.db.query('plugin::ordering.admin-change-log').findMany({ where: { category: 'promotion' } });
    const actions = new Set(logs.map((row) => row.action));
    for (const action of ['promotion.create', 'promotion.update', 'promotion.active', 'promotion.codes-generate', 'promotion.code-active', 'promotion.codes-export']) {
      assert.ok(actions.has(action), `${action} is logged`);
    }
    assert.doesNotMatch(JSON.stringify(logs), /TET2027|TET[A-HJKMNP-Z2-9]{10}/, 'no full code in the change log');
    console.log('[ordering-test] promotions admin: switched-off code invalid, edits leave past orders, stats + redemptions, logged');
  } finally {
    await staff.cleanup();
    await limited.cleanup();
    await outsider.cleanup();
  }
});
