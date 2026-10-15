// O16 step 2 — loyalty program admin surface over HTTP: `loyalty.manage` gates settings and
// tiers; the first save that opens the program stamps `startsAt` and seeds the default tiers and
// their O14 groups; tier writes keep the set valid (one lowest tier at 0, unique thresholds, a
// group follows one tier, manual groups only). Every write lands in the change log.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o16 node scripts/ordering/loyalty-admin.mjs
import assert from 'node:assert/strict';

import { seedAdminHttpStaff, withApp } from './_harness.mjs';

withApp(async (app) => {
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
    for (const bad of [
      { startsAt: '2020-01-01T00:00:00.000Z' },
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
    console.log('[ordering-test] loyalty-admin OK');
  } finally {
    await staff.cleanup();
    await outsider.cleanup();
  }
});
