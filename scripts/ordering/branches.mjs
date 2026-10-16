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
    // every issue carries a code so the Admin can show a Vietnamese line instead of the English message
    assert.ok(bad.body.error.details.issues.every((issue) => typeof issue.code === 'string' && issue.code), JSON.stringify(bad.body.error.details.issues));
    assert.ok(
      bad.body.error.details.issues.some(
        (issue) => issue.path === 'fulfillment.pickup.schedule.leadTimeMinutes' && issue.code === 'too_small' && issue.min === 0,
      ),
      JSON.stringify(bad.body.error.details.issues),
    );
    // the timezone and payment checks run once the shape is valid
    const rules = await lan('PATCH', '/branches/Q1', { timezone: 'Mars/Olympus', fulfillment: { pickup: { paymentTiming: 'prepay' } } });
    assert.equal(rules.status, 400);
    const ruleCodes = rules.body.error.details.issues.map((issue) => `${issue.path}=${issue.code}`);
    assert.ok(ruleCodes.includes('timezone=invalid_timezone'), ruleCodes.join(','));
    assert.ok(ruleCodes.includes('fulfillment.pickup.paymentTiming=online_provider_required'), ruleCodes.join(','));
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
    const duplicateCode = await chain('POST', '/branches', { code: 'Q7', name: { vi: 'Lại Q7' } });
    assert.equal(duplicateCode.status, 400, 'duplicate code rejected');
    assert.deepEqual(
      [duplicateCode.body.error.details.issues[0].path, duplicateCode.body.error.details.issues[0].code],
      ['code', 'taken'],
      'the Admin translates the duplicate from its code',
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

    // --- Delivery zones: saved on the branch, quoted on the server, change-logged ---------
    const zoned = await lan('PUT', '/branches/Q1', {
      fulfillment: {
        delivery: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          schedule: { openingHours: { mode: '24_7' } },
          zones: [
            {
              code: 'near',
              label: 'Gần',
              priority: 10,
              match: { kind: 'commune', communeCodes: ['XT01001', 'xt01002'] },
              rules: [
                { when: 'subtotal-lt', subtotal: 100000, fee: 'unavailable' },
                { when: 'subtotal-lt', subtotal: 300000, fee: 15000 },
                { when: 'any', fee: 0 },
              ],
              minOrderAmount: 100000,
              extraLeadTimeMinutes: 30,
            },
          ],
        },
      },
    });
    assert.equal(zoned.status, 200, JSON.stringify(zoned.body));
    assert.equal(zoned.body.item.fulfillment.pickup.schedule.leadTimeMinutes, 60, 'pickup lead stays');
    assert.deepEqual(zoned.body.item.fulfillment.delivery.zones[0].match.communeCodes, ['XT01001', 'XT01002']);
    const quote = await lan('POST', '/branches/Q1/delivery-quote', { communeCode: 'XT01002', subtotal: 200000 });
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    assert.equal(quote.body.fee, 15000);
    assert.equal(quote.body.freeFrom, 300000);
    const outside = await lan('POST', '/branches/Q1/delivery-quote', { communeCode: 'XT02002', subtotal: 200000 });
    assert.equal(outside.body.available, false);
    assert.equal(outside.body.reason, 'outside');
    const zoneLogs = await app.db.query('plugin::ordering.admin-change-log').findMany({
      where: { action: 'branch.update', locationRef: 'Q1' },
    });
    assert.ok(zoneLogs.at(-1).changes.fulfillment, 'zone config is change-logged on fulfillment');
    const published = await (await fetch(`${base}/api/v1/ordering/branches`)).json();
    const q1public = published.items.find((row) => row.code === 'Q1');
    assert.deepEqual(q1public.receiveMethods, [
      { kind: 'pickup', orderTiming: 'both' },
      { kind: 'delivery', orderTiming: 'both' },
    ]);
    assert.equal(JSON.stringify(q1public).includes('XT01001'), false, 'public list hides zone communes');

    // --- Special hours: save, read back, reject a duplicated date ----------------------------
    const special = await lan('PATCH', '/branches/Q1', {
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          schedule: {
            leadTimeMinutes: 60,
            businessDayPolicy: {
              cutoffLocalTime: '02:00',
              specialHours: [
                { date: '2026-02-17', ranges: [{ start: '10:00', end: '14:00' }], note: 'Mùng 2 Tết' },
              ],
            },
            openingHours: { mode: 'daily', daily: [{ start: '22:00', end: '02:00' }] },
          },
        },
      },
    });
    assert.equal(special.status, 200, JSON.stringify(special.body));
    assert.equal(special.body.item.fulfillment.pickup.schedule.businessDayPolicy.specialHours[0].note, 'Mùng 2 Tết');
    assert.equal(special.body.item.fulfillment.pickup.schedule.businessDayPolicy.specialHours[0].closed, false);
    const rereadSpecial = await lan('GET', '/branches/Q1');
    assert.equal(
      rereadSpecial.body.item.fulfillment.pickup.schedule.businessDayPolicy.specialHours[0].date,
      '2026-02-17',
    );
    const duplicated = await lan('PATCH', '/branches/Q1', {
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          schedule: {
            businessDayPolicy: {
              specialHours: [
                { date: '2026-02-17', ranges: [{ start: '10:00', end: '14:00' }] },
                { date: '2026-02-17', closed: true, ranges: [] },
              ],
            },
          },
        },
      },
    });
    assert.equal(duplicated.status, 400);
    assert.equal(duplicated.body.error.code, 'VALIDATION_ERROR');
    assert.ok(
      duplicated.body.error.details.issues.some(
        (issue) => issue.message === 'duplicate special date' && issue.code === 'duplicate_date',
      ),
      JSON.stringify(duplicated.body.error.details.issues),
    );

    // --- Staff scopes (screens S8) ------------------------------------------------------------
    const scoped = await seedAdminHttpStaff(app, {
      actions: ['scope.manage', 'order.read'],
      scopes: { boss: { allLocations: true, locationRefs: [] }, q1boss: { allLocations: false, locationRefs: ['Q1'] }, newbie: null },
    });
    try {
      const list = await scoped.as.boss('GET', '/staff-scopes');
      assert.equal(list.status, 200);
      const newbie = list.body.results.find((row) => row.adminUserId === scoped.users.newbie.id);
      assert.equal(newbie.assigned, false, 'unassigned staff are flagged');
      assert.equal(list.body.results[0].assigned, false, 'unassigned staff sort first');
      assert.equal(
        (await scoped.as.q1boss('PUT', `/staff-scopes/${scoped.users.newbie.id}`, { allLocations: true })).status,
        403,
        'only an all-branches manager grants every branch',
      );
      assert.equal(
        (await scoped.as.q1boss('PUT', `/staff-scopes/${scoped.users.newbie.id}`, { locationRefs: ['Q3'] })).status,
        403,
        'a Q1 manager cannot grant Q3',
      );
      const granted = await scoped.as.q1boss('PUT', `/staff-scopes/${scoped.users.newbie.id}`, { locationRefs: ['Q1'] });
      assert.equal(granted.status, 200, JSON.stringify(granted.body));
      assert.deepEqual(granted.body.item.locationRefs, ['Q1']);
      assert.equal(
        (await scoped.as.boss('PUT', `/staff-scopes/${scoped.users.newbie.id}`, { locationRefs: ['NOPE'] })).body.error.details.field,
        'locationRefs',
      );
      assert.equal((await noSettings.as.reader('GET', '/staff-scopes')).status, 403, 'scope.manage is required');
      const logs = await app.db.query('plugin::ordering.admin-change-log').findMany({ where: { action: 'scope.update' } });
      assert.ok(logs.length >= 1, 'scope changes are change-logged');
    } finally {
      await scoped.cleanup();
    }
    console.log('[ordering-test] branches: scope, validation, change-log, public list, staff scopes verified');
  } finally {
    await http.cleanup();
    await noSettings.cleanup();
  }
});
