// O16 step 2 — loyalty program admin surface over HTTP: `loyalty.manage` gates settings and
// tiers; the first save that opens the program stamps `startsAt` and seeds the default tiers and
// their O14 groups; tier writes keep the set valid (one lowest tier at 0, unique thresholds, a
// group follows one tier, manual groups only). Every write lands in the change log. Step 6 adds the
// customer points tab (`customer.read`, branch-scoped like the profile), the logged adjustment
// (`loyalty.adjust`, reason required, cannot go below zero) and the report (`report.read`).
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o16 node scripts/ordering/loyalty-admin.mjs
import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';

import { basicOrderInput, seedAdminHttpStaff, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  await app.listen();
  const changeLogs = () => app.db.query('plugin::ordering.admin-change-log');
  const groups = () => app.db.query('plugin::ordering.customer-group');

  const staff = await seedAdminHttpStaff(app, {
    actions: ['loyalty.manage'],
    scopes: { quanly: { allLocations: true, locationRefs: [] } },
  });
  const outsider = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { xem: { allLocations: true, locationRefs: [] } },
  });
  const as = staff.as.quanly;
  const asXem = outsider.as.xem;

  try {
    // ── Permission gates ────────────────────────────────────────────────────────
    for (const [method, path, body] of [
      ['GET', '/loyalty/settings'],
      ['PUT', '/loyalty/settings', { enabled: true }],
      ['GET', '/loyalty/tiers'],
      ['POST', '/loyalty/tiers', {}],
      ['GET', '/loyalty/tiers/1'],
      ['PUT', '/loyalty/tiers/1', {}],
    ]) {
      assert.equal((await asXem(method, path, body)).status, 403, `${method} ${path} needs loyalty.manage`);
    }
    console.log('[ordering-test] every loyalty route → 403 without loyalty.manage');

    // ── Defaults: program off, nothing seeded yet ──────────────────────────────────
    const fresh = await as('GET', '/loyalty/settings');
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    assert.deepEqual(fresh.body.settings, {
      enabled: false,
      startsAt: null,
      earnPerAmount: 10000,
      pointValue: 100,
      minRedeemPoints: 50,
      maxRedeemShare: 0.5,
      expiryMonths: 12,
      expiryReminderDays: 14,
      downgradeGraceDays: 30,
      dailyEarnCap: 2000,
      channels: ['pickup', 'delivery', 'dine-in'],
      countHistoryForTiers: true,
    });
    assert.deepEqual((await as('GET', '/loyalty/tiers')).body.items, [], 'no tier before the program is saved on');
    // Saving the program OFF seeds nothing and stamps nothing.
    const off = await as('PUT', '/loyalty/settings', { enabled: false, pointValue: 100 });
    assert.equal(off.status, 200);
    assert.equal(off.body.settings.startsAt, null);
    assert.deepEqual((await as('GET', '/loyalty/tiers')).body.items, []);
    console.log('[ordering-test] defaults: off, startsAt null, no tiers');

    // ── Validation ─────────────────────────────────────────────────────────────
    // `startsAt` is service-owned and read-only: it is ignored, not rejected (a GET body may be
    // echoed straight back to PUT). Every other unknown key still fails.
    for (const bad of [
      { maxRedeemShare: 2 },
      { earnPerAmount: 0 },
      { channels: ['pickup', 'pickup'] },
      { channels: ['digital'] },
      { surprise: true },
    ]) {
      assert.equal((await as('PUT', '/loyalty/settings', bad)).status, 400, JSON.stringify(bad));
    }

    // ── First enable: stamps startsAt, seeds three tiers and two groups ───────────
    const before = Date.now();
    const on = await as('PUT', '/loyalty/settings', { enabled: true, pointValue: 120 });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal(on.body.settings.enabled, true);
    assert.equal(on.body.settings.pointValue, 120);
    const startsAt = new Date(on.body.settings.startsAt).getTime();
    assert.ok(startsAt >= before - 1000 && startsAt <= Date.now() + 1000, 'startsAt is the moment of enabling');
    const tiers = (await as('GET', '/loyalty/tiers')).body.items;
    assert.deepEqual(
      tiers.map((tier) => [tier.code, tier.minSpend12m, tier.multiplier, tier.customerGroupCode, tier.active]),
      [
        ['thanh-vien', 0, 100, null, true],
        ['bac', 2_000_000, 120, 'hang-bac', true],
        ['vang', 5_000_000, 150, 'hang-vang', true],
      ],
    );
    for (const code of ['hang-bac', 'hang-vang']) {
      const rows = await groups().findMany({ where: { code } });
      assert.equal(rows.length, 1, `${code} group is created once`);
      assert.equal(rows[0].auto, null, `${code} is manual-only so refreshAuto never touches it`);
    }

    // ── Re-save: startsAt sticks, nothing is seeded twice ─────────────────────────
    const again = await as('PUT', '/loyalty/settings', { enabled: true, pointValue: 100, dailyEarnCap: 500 });
    assert.equal(again.body.settings.startsAt, on.body.settings.startsAt, 'startsAt never moves');
    assert.equal((await as('GET', '/loyalty/tiers')).body.items.length, 3);
    assert.equal((await groups().findMany({ where: { code: 'hang-bac' } })).length, 1);
    const switchedOff = await as('PUT', '/loyalty/settings', { enabled: false });
    assert.equal(switchedOff.body.settings.startsAt, on.body.settings.startsAt, 'closing keeps the stamp');
    assert.equal((await as('GET', '/loyalty/settings')).body.settings.enabled, false);
    console.log('[ordering-test] first enable stamps startsAt once and seeds tiers + groups idempotently');

    // ── A GET body can be sent straight back to PUT (startsAt is read-only) ───────
    const current = (await as('GET', '/loyalty/settings')).body.settings;
    const echoed = await as('PUT', '/loyalty/settings', current);
    assert.equal(echoed.status, 200, JSON.stringify(echoed.body));
    assert.equal(echoed.body.settings.startsAt, current.startsAt, 'read-only startsAt is ignored, not rejected');
    console.log('[ordering-test] PUT accepts a verbatim GET body');

    // ── Tier rules ──────────────────────────────────────────────────────────────
    const tier = (over) => ({
      code: 'dong',
      name: { vi: 'Đồng', en: 'Bronze' },
      minSpend12m: 1_000_000,
      multiplier: 110,
      customerGroupCode: null,
      active: true,
      ...over,
    });
    assert.equal((await as('POST', '/loyalty/tiers', tier({ code: 'bac' }))).status, 400, 'duplicate code');
    assert.equal((await as('POST', '/loyalty/tiers', tier({ minSpend12m: 2_000_000 }))).status, 400, 'duplicate threshold');
    assert.equal(
      (await as('POST', '/loyalty/tiers', tier({ customerGroupCode: 'khong-co' }))).status,
      400,
      'group must exist',
    );
    assert.equal(
      (await as('POST', '/loyalty/tiers', tier({ customerGroupCode: 'hang-bac' }))).status,
      400,
      'a group follows one tier',
    );
    await groups().create({
      data: { code: 'tu-dong', name: { vi: 'Tự động' }, auto: { minOrderCount: 3 }, active: true },
    });
    assert.equal(
      (await as('POST', '/loyalty/tiers', tier({ customerGroupCode: 'tu-dong' }))).status,
      400,
      'an automatic group cannot follow a tier',
    );
    await groups().create({ data: { code: 'hang-dong', name: { vi: 'Hạng Đồng' }, auto: null, active: true } });
    const created = await as('POST', '/loyalty/tiers', tier({ customerGroupCode: 'hang-dong' }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.item.code, 'dong');
    const listed = (await as('GET', '/loyalty/tiers')).body.items.map((item) => item.code);
    assert.deepEqual(listed, ['thanh-vien', 'dong', 'bac', 'vang'], 'sorted by threshold');

    const dongId = created.body.item.id;
    const renamed = await as('PUT', `/loyalty/tiers/${dongId}`, tier({ code: 'khac', multiplier: 115, minSpend12m: 1_200_000 }));
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(renamed.body.item.code, 'dong', 'code is immutable');
    assert.equal(renamed.body.item.multiplier, 115);
    assert.equal(renamed.body.item.minSpend12m, 1_200_000);

    const editable = (item, over = {}) => ({
      code: item.code,
      name: item.name,
      minSpend12m: item.minSpend12m,
      multiplier: item.multiplier,
      customerGroupCode: item.customerGroupCode,
      active: item.active,
      ...over,
    });
    const base = tiers.find((item) => item.code === 'thanh-vien');
    assert.equal(
      (await as('PUT', `/loyalty/tiers/${base.id}`, editable(base, { minSpend12m: 100 }))).status,
      400,
      'the lowest active tier must start at 0',
    );
    assert.equal(
      (await as('PUT', `/loyalty/tiers/${dongId}`, tier({ minSpend12m: 2_000_000 }))).status,
      400,
      'threshold already used by an active tier',
    );
    const vang = tiers.find((item) => item.code === 'vang');
    const off2 = await as('PUT', `/loyalty/tiers/${vang.id}`, editable(vang, { active: false }));
    assert.equal(off2.status, 200);
    assert.equal(off2.body.item.active, false);
    for (const item of (await as('GET', '/loyalty/tiers')).body.items.filter((entry) => entry.active)) {
      const res = await as('PUT', `/loyalty/tiers/${item.id}`, editable(item, { active: false }));
      if (item.code === 'thanh-vien') {
        assert.equal(res.status, 400, 'a tier set cannot lose its last active tier');
      }
    }
    assert.equal((await as('GET', '/loyalty/tiers/999999')).status, 404);
    console.log('[ordering-test] tier rules: unique code/threshold, base at 0, manual groups only, immutable code');

    // ── Change log: every write is recorded, none carries customer data ──────────
    const actions = (await changeLogs().findMany({})).map((row) => row.action);
    for (const expected of ['loyalty.settings.update', 'loyalty.tier.create', 'loyalty.tier.update']) {
      assert.ok(actions.includes(expected), `change log has ${expected}`);
    }
    // ── Y3/Y4: customer points, adjustment, report ───────────────────────────────────────────
    const { order } = services(app);
    const placed = await order.createOrder(
      basicOrderInput({ adjustments: [], idempotencyKey: randomUUID(), contact: { name: 'Khách Y3', phone: '+84906000001' } }),
      systemCtx,
    );
    const customerRow = await app.db.query('plugin::ordering.customer').findOne({ where: { phone: '+84906000001' } });
    const documentId = customerRow.documentId;
    await app.db.query('plugin::ordering.customer').update({ where: { id: customerRow.id }, data: { status: 'active' } });
    const pointsStaff = await seedAdminHttpStaff(app, {
      actions: ['customer.read', 'loyalty.adjust', 'report.read'],
      scopes: { all: { allLocations: true, locationRefs: [] }, q3: { allLocations: false, locationRefs: ['Q3'] } },
    });
    const readOnly = await seedAdminHttpStaff(app, {
      actions: ['customer.read', 'report.read'],
      scopes: { all: { allLocations: true, locationRefs: [] } },
    });
    try {
      const all = pointsStaff.as.all;
      const q3 = pointsStaff.as.q3;
      assert.equal((await readOnly.as.all('GET', `/customers/${documentId}/loyalty`)).status, 200);
      assert.equal(
        (await readOnly.as.all('POST', `/customers/${documentId}/loyalty/adjust`, { points: 10, reason: 'x y z' })).status,
        403,
        'adjust needs loyalty.adjust',
      );
      assert.equal((await asXem('GET', `/customers/${documentId}/loyalty`)).status, 403);
      assert.equal((await asXem('GET', '/reports/loyalty')).status, 403);
      assert.equal((await q3('GET', `/customers/${documentId}/loyalty`)).status, 404, 'a Q3-only staff cannot see a Q1 customer');
      assert.equal((await q3('POST', `/customers/${documentId}/loyalty/adjust`, { points: 10, reason: 'x y z' })).status, 404);
      assert.equal((await all('GET', '/customers/does-not-exist/loyalty')).status, 404);

      for (const bad of [{ reason: 'có lý do' }, { points: 0, reason: 'có lý do' }, { points: 1.5, reason: 'có lý do' }, { points: 5 }, { points: 5, reason: 'ab' }]) {
        assert.equal((await all('POST', `/customers/${documentId}/loyalty/adjust`, bad)).status, 400, JSON.stringify(bad));
      }
      const plus = await all('POST', `/customers/${documentId}/loyalty/adjust`, { points: 100, reason: 'Đền bù đơn chậm' });
      assert.equal(plus.status, 200, JSON.stringify(plus.body));
      assert.equal(plus.body.balance, 100);
      assert.equal(plus.body.lots.length, 1);
      assert.equal(plus.body.lots[0].source, 'adjust');
      assert.equal(plus.body.ledger[0].reason, 'Đền bù đơn chậm');
      assert.match(plus.body.ledger[0].actor, /^admin:/);
      const minus = await all('POST', `/customers/${documentId}/loyalty/adjust`, { points: -30, reason: 'Sửa nhầm' });
      assert.equal(minus.body.balance, 70);
      assert.equal(
        (await all('POST', `/customers/${documentId}/loyalty/adjust`, { points: -71, reason: 'Quá số dư' })).status,
        409,
        'cannot remove more than the balance',
      );
      assert.equal((await all('GET', `/customers/${documentId}/loyalty`)).body.balance, 70);
      const logged = (await changeLogs().findMany({ where: { action: 'loyalty.adjust' } })).length;
      assert.equal(logged, 2, 'both adjustments are in the change log; the refused one is not');
      assert.equal(
        (await q3('POST', `/customers/${documentId}/loyalty/adjust`, { points: 5, reason: 'Ngoài phạm vi' })).status,
        404,
      );

      // Report: all branches see circulation and tiers; a scoped caller counts only rows with orders.
      const report = await all('GET', '/reports/loyalty');
      assert.equal(report.status, 200, JSON.stringify(report.body));
      assert.equal(report.body.scope, 'all');
      assert.equal(report.body.issued, 100);
      assert.deepEqual(report.body.circulation, { points: 70, value: 70 * 100 });
      assert.ok(Array.isArray(report.body.tiers));
      const scoped = await q3('GET', '/reports/loyalty');
      assert.equal(scoped.status, 200);
      assert.equal(scoped.body.scope, 'branch');
      assert.equal(scoped.body.circulation, null);
      assert.equal(scoped.body.issued, 0, 'adjustments have no order, so a branch view does not count them');
      assert.equal((await q3('GET', '/reports/loyalty?branch=Q1')).status, 403, 'a branch outside the scope is refused');
      assert.equal((await all('GET', '/reports/loyalty?from=2026-13-01')).status, 400);
      assert.ok(placed.order.order.id);
      console.log('[ordering-test] customer points tab, adjustment and report: scope, validation, change log');
    } finally {
      await pointsStaff.cleanup();
      await readOnly.cleanup();
    }
    console.log('[ordering-test] loyalty-admin OK');
  } finally {
    await staff.cleanup();
    await outsider.cleanup();
  }
});
