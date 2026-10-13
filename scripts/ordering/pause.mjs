import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Trusted visitor-IP forwarding for the storefront calls.
process.env.FORM_INTAKE_SHARED_SECRET = 'storefront-test-secret';

import { seedAdminHttpStaff, seedBranches, seedMenu, withApp } from './_harness.mjs';

// O12 step 1 (screens N3): per-receive-kind ordering pause with a deadline (auto-reopens),
// busy mode that pushes lead times out, public /config feedback, LOCATION_PAUSED on both
// quote and create, scope enforcement, change-log.
withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  // Q1 needs an always-open schedule so ASAP quoting works at any test time.
  const branchRows = app.db.query('plugin::ordering.branch');
  const q1row = await branchRows.findOne({ where: { code: 'Q1' } });
  await branchRows.update({
    where: { id: q1row.id },
    data: {
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          schedule: { openingHours: { mode: '24_7' } },
        },
      },
    },
  });
  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}`;
  const api = async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}/api/v1/ordering${path}`, {
      method,
      headers: {
        'x-salanca-intake-secret': 'storefront-test-secret',
        'x-salanca-visitor-ip': '192.0.2.77',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const http = await seedAdminHttpStaff(app, {
    actions: ['order.read', 'order.process'],
    scopes: {
      lan: { allLocations: false, locationRefs: ['Q1'] },
      chain: { allLocations: true, locationRefs: [] },
    },
  });
  const readOnly = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { reader: { allLocations: true, locationRefs: [] } },
  });
  try {
    const { lan, chain } = http.as;
    const cart = {
      branch: 'Q1',
      lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
      receiveMethod: { kind: 'pickup' },
    };

    // --- Baseline: quoting works, no pause shown -------------------------------------------
    const before = await api('GET', '/config?branch=Q1');
    assert.equal(before.status, 200, JSON.stringify(before.body));
    assert.equal(before.body.branch.pause.pickup, null);
    assert.equal(before.body.branch.busy, null);
    assert.equal((await api('POST', '/quote', cart)).status, 200, 'quote works before pausing');

    // --- Pause pickup only: /config reports it, quote+create refuse, delivery unaffected ----
    const paused = await lan('POST', '/branches/Q1/pause', {
      kinds: ['pickup'],
      minutes: 15,
      reason: 'Bếp quá tải',
    });
    assert.equal(paused.status, 200, JSON.stringify(paused.body));
    const until = paused.body.item.orderingPause.pickup.until;
    assert.ok(new Date(until).getTime() > Date.now() + 10 * 60_000, 'pause carries a resume time');
    assert.equal(paused.body.item.orderingPause.delivery ?? null, null);

    const config = await api('GET', '/config?branch=Q1');
    assert.equal(config.body.branch.pause.pickup.until, until);
    assert.equal(config.body.branch.pause.delivery, null);

    const rejected = await api('POST', '/quote', cart);
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.error.code, 'LOCATION_PAUSED');
    assert.equal(rejected.body.error.details.kind, 'pickup');
    assert.equal(rejected.body.error.details.resumeAt, until);

    const create = await api(
      'POST',
      '/orders',
      {
        ...cart,
        contact: { phone: '+84900000001' },
        consent: { policyVersion: 'v1', accepted: true },
        captchaToken: 'pass',
      },
      { 'Idempotency-Key': randomUUID() },
    );
    assert.equal(create.body.error.code, 'LOCATION_PAUSED', 'create is blocked too');

    // --- Other kinds keep working; scope + permission are enforced --------------------------
    const dineInPause = await chain('POST', '/branches/Q1/pause', { kinds: ['dineIn'], endOfDay: true });
    assert.equal(dineInPause.status, 200);
    const config2 = await api('GET', '/config?branch=Q1');
    assert.ok(config2.body.branch.pause.dineIn, 'dineIn pauses independently');
    assert.equal(
      (await lan('POST', '/branches/Q3/pause', { minutes: 5 })).status,
      404,
      'out of scope pauses 404',
    );
    assert.equal(
      (await readOnly.as.reader('POST', '/branches/Q1/pause', { minutes: 5 })).status,
      403,
      'order.process is required',
    );

    // --- Resume: pickup quote works again, dineIn stays paused ------------------------------
    const resumed = await lan('POST', '/branches/Q1/resume', { kinds: ['pickup'] });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.item.orderingPause.pickup, null);
    assert.equal((await api('POST', '/quote', cart)).status, 200, 'quote reopens after resume');
    const config3 = await api('GET', '/config?branch=Q1');
    assert.equal(config3.body.branch.pause.pickup, null);
    assert.ok(config3.body.branch.pause.dineIn, 'other kinds stay paused');

    // --- Busy mode: /config advertises it, lead time and slots shift ------------------------
    const busy = await lan('POST', '/branches/Q1/busy', { extraMinutes: 20, minutes: 60 });
    assert.equal(busy.status, 200, JSON.stringify(busy.body));
    assert.equal(busy.body.item.busyMode.extraMinutes, 20);
    const busyConfig = await api('GET', '/config?branch=Q1');
    assert.equal(busyConfig.body.branch.busy.extraMinutes, 20);
    assert.equal(busyConfig.body.branch.pickup.busyExtraMinutes, 20);
    assert.equal(
      busyConfig.body.branch.pickup.leadTimeMinutes,
      before.body.branch.pickup.leadTimeMinutes + 20,
    );
    assert.ok(
      new Date(busyConfig.body.branch.pickup.asapReadyAt) >
        new Date(before.body.branch.pickup.asapReadyAt),
      'asap estimate moves out while busy',
    );
    const cleared = await lan('POST', '/branches/Q1/busy/clear');
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.item.busyMode, null);
    assert.equal((await api('GET', '/config?branch=Q1')).body.branch.busy, null);
    assert.equal(
      (await lan('POST', '/branches/Q1/busy', { extraMinutes: 0, minutes: 60 })).status,
      400,
      'extraMinutes 0 is rejected',
    );

    // --- Expired entries are dormant: a deadline in the past neither blocks nor shows -------
    const svc = app.plugin('ordering').service('branch');
    const q1 = await svc.findByCode('Q1');
    await app.db.query('plugin::ordering.branch').update({
      where: { id: q1.id },
      data: {
        orderingPause: { pickup: { until: new Date(Date.now() - 60_000).toISOString() } },
        busyMode: { extraMinutes: 30, until: new Date(Date.now() - 60_000).toISOString() },
      },
    });
    const expired = await api('GET', '/config?branch=Q1');
    assert.equal(expired.body.branch.pause.pickup, null, 'expired pause does not show');
    assert.equal(expired.body.branch.busy, null, 'expired busy does not show');
    assert.equal((await api('POST', '/quote', cart)).status, 200, 'expired pause does not block');

    // --- Change-log: every toggle is audited ------------------------------------------------
    const logs = await app.db.query('plugin::ordering.admin-change-log').findMany({
      where: { locationRef: 'Q1', action: { $in: ['branch.pause', 'branch.busy'] } },
      orderBy: { id: 'asc' },
    });
    const actions = logs.map((row) => row.action);
    assert.ok(actions.filter((a) => a === 'branch.pause').length >= 3, 'pause/resume logged');
    assert.ok(actions.filter((a) => a === 'branch.busy').length >= 2, 'busy set/clear logged');

    console.log('[ordering-test] pause/busy: config, LOCATION_PAUSED, resume, busy lead time, scope, change-log verified');
  } finally {
    await http.cleanup();
    await readOnly.cleanup();
  }
});
