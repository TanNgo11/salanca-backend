import assert from 'node:assert/strict';

import { seedAdminHttpStaff, seedBranches, seedMenu, withApp } from './_harness.mjs';

// O3 step 1: "Chi nhánh" settings — strict validation with field paths, scope on every admin
// route (HTTP, real admin::hasPermissions), change-log, public /branches allowlist, and
// "settings only affect new orders" (the order pins businessDate/workflow at placement).
withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}`;
  const http = await seedAdminHttpStaff(app, {
    scopes: {
      lan: { allLocations: false, locationRefs: ['Q1'] },
      chain: { allLocations: true, locationRefs: [] },
      none: null,
    },
  });
  const noSettings = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { reader: { allLocations: true, locationRefs: [] } },
  });
  try {
    const { lan, chain, none } = http.as;

    // --- Scope on list/get/patch ---------------------------------------------------------
    const lanList = await lan('GET', '/branches');
    assert.equal(lanList.status, 200);
    assert.deepEqual(lanList.body.results.map((row) => row.code), ['Q1'], 'lan sees only Q1');
    assert.ok(lanList.body.paymentProviders.includes('cash'));
    assert.equal((await chain('GET', '/branches')).body.results.length, 2);
    assert.equal((await none('GET', '/branches')).status, 403, 'no scope -> SCOPE_REQUIRED');
    assert.equal((await lan('GET', '/branches/Q3')).status, 404, 'out of scope reads 404');
    assert.equal(
      (await lan('PATCH', '/branches/Q3', { onlineOrdering: false })).status,
      404,
      'out of scope writes 404',
    );
    assert.equal(
      (await noSettings.as.reader('GET', '/branches')).status,
      403,
      'settings.manage is required by the route policy',
    );

    // --- Defaults are resolved on read --------------------------------------------------
    const q1 = (await lan('GET', '/branches/Q1')).body.item;
    assert.equal(q1.fulfillment.pickup.schedule.leadTimeMinutes, 180);
    assert.equal(q1.fulfillment.pickup.orderTiming, 'both');

    // --- Validation with field paths ----------------------------------------------------
    const bad = await lan('PATCH', '/branches/Q1', {
      timezone: 'Mars/Olympus',
      fulfillment: { pickup: { paymentTiming: 'prepay', schedule: { leadTimeMinutes: -5 } } },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
    const paths = bad.body.error.details.issues.map((issue) => issue.path);
    assert.ok(paths.includes('fulfillment.pickup.schedule.leadTimeMinutes'), paths.join(','));
    assert.equal(
      (await lan('PATCH', '/branches/Q1', { code: 'Q9' })).body.error.code,
      'BRANCH_CODE_IMMUTABLE',
    );

    // --- Settings change applies to new orders only -------------------------------------
    const { order } = await app.plugin('ordering').service('order').createOrder(
      {
        idempotencyKey: `branches-${Date.now()}`,
        locationRef: 'Q1',
        lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
        receiveMethod: { kind: 'pickup', locationRef: 'Q1' },
        contact: { phone: '+84900000001' },
        consent: { policyVersion: 'v1', channel: 'web-checkout' },
        origin: { kind: 'storefront' },
        placedAt: '2026-10-10T19:30:00.000Z', // 02:30 local on the 11th
      },
      { actor: { kind: 'system' } },
    );
    assert.equal(order.order.businessDate, '2026-10-10', 'cutoff 04:00 puts 02:30 on the 10th');

    const saved = await lan('PATCH', '/branches/Q1', {
      phone: '028 3822 1234',
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          schedule: {
            leadTimeMinutes: 60,
            businessDayPolicy: { cutoffLocalTime: '02:00' },
            openingHours: { mode: 'daily', daily: [{ start: '22:00', end: '02:00' }] },
          },
        },
      },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.item.fulfillment.pickup.schedule.leadTimeMinutes, 60);
    const reread = await app.plugin('ordering').service('order').getOrder(order.order.id, {
      actor: { kind: 'system' },
    });
    assert.equal(reread.order.businessDate, '2026-10-10', 'existing order keeps its business date');

    const logged = await app.db.query('plugin::ordering.admin-change-log').findMany({
      where: { action: 'branch.update', locationRef: 'Q1' },
    });
    assert.ok(logged.length >= 1, 'branch.update is change-logged');
    assert.equal(logged.at(-1).actorRef, `admin:${http.users.lan.id}`);

    // --- Create needs an all-locations scope --------------------------------------------
    assert.equal(
      (await lan('POST', '/branches', { code: 'Q7', name: { vi: 'Quận 7' } })).status,
      403,
    );
    const created = await chain('POST', '/branches', { code: 'Q7', name: { vi: 'Quận 7' } });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.item.onlineOrdering, false, 'new branches start offline');
    assert.equal(
      (await chain('POST', '/branches', { code: 'Q7', name: { vi: 'Lại Q7' } })).status,
      400,
      'duplicate code rejected',
    );

    // --- Public list: active + online, allowlisted fields --------------------------------
    const pub = await fetch(`${base}/api/v1/ordering/branches`);
    assert.equal(pub.status, 200);
    const items = (await pub.json()).items;
    assert.deepEqual(items.map((row) => row.code).sort(), ['Q1', 'Q3'], 'Q7 is offline');
    for (const item of items) {
      assert.deepEqual(
        Object.keys(item).sort(),
        ['address', 'code', 'email', 'name', 'phone', 'receiveMethods', 'timezone'],
      );
    }
    assert.deepEqual(items.find((row) => row.code === 'Q1').receiveMethods, [
      { kind: 'pickup', orderTiming: 'both' },
    ]);
    console.log('[ordering-test] branches: scope, validation, change-log, public list verified');
  } finally {
    await http.cleanup();
    await noSettings.cleanup();
  }
});
