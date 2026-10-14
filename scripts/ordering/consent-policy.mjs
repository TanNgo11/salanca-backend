import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.FORM_INTAKE_SHARED_SECRET = 'consent-test-secret';

import { seedAdminHttpStaff, seedBranches, seedMenu, withApp } from './_harness.mjs';

// Core gaps step 6: `consent.policyVersion` is an Admin setting (ordering-settings). Unset = the
// plugin config value ('v1'); a new value shows in /config, makes orders on the old version fail
// CONSENT_REQUIRED, is written to the change-log, and staff drafts are stamped with it by the
// server (the Admin page no longer hardcodes a version).
withApp(async (app) => {
  const store = app.store({ type: 'plugin', name: 'ordering', key: 'settings' });
  await store.delete(); // the core store survives table truncation
  await seedBranches(app);
  seedMenu(app);
  const branchRows = app.db.query('plugin::ordering.branch');
  const q1 = await branchRows.findOne({ where: { code: 'Q1' } });
  await branchRows.update({
    where: { id: q1.id },
    data: {
      fulfillment: {
        pickup: {
          enabled: true,
          paymentProviders: ['cash'],
          schedule: { leadTimeMinutes: 30, openingHours: { mode: '24_7' } },
        },
      },
    },
  });
  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  let visitor = 1;
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-salanca-intake-secret': 'consent-test-secret',
        'x-salanca-visitor-ip': `203.0.113.${visitor++}`,
        'Idempotency-Key': `consent-${randomUUID()}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const orderBody = (policyVersion) => ({
    branch: 'Q1',
    lines: [{ sellableUid: 'tra-dao', quantity: 2 }],
    receiveMethod: { kind: 'pickup' },
    contact: { name: 'Khách', phone: '0901234567' },
    consent: { policyVersion, accepted: true },
    captchaToken: 'pass',
  });
  const draftBody = (consent) => ({
    branch: 'Q1',
    lines: [{ sellableUid: 'tra-dao', quantity: 1 }],
    receiveMethod: { kind: 'pickup' },
    contact: { name: 'Khách gọi', phone: '0912345678' },
    consent,
    idempotencyKey: `draft-${randomUUID()}`,
  });

  const http = await seedAdminHttpStaff(app, {
    scopes: { chain: { allLocations: true, locationRefs: [] } },
  });
  try {
    const { chain } = http.as;

    // Store empty → the config default.
    assert.equal((await call('GET', '/config?branch=Q1')).body.consentPolicyVersion, 'v1');
    const initial = await chain('GET', '/settings');
    assert.equal(initial.body.settings.consentPolicyVersion, undefined, 'unset until an admin sets it');
    assert.equal((await call('POST', '/orders', orderBody('v1'))).status, 201);

    // Validation: blank / spaces-inside / too long are refused.
    for (const bad of ['', 'v 2', 'x'.repeat(33)]) {
      const refused = await chain('PUT', '/settings', { ...initial.body.settings, consentPolicyVersion: bad });
      assert.equal(refused.status, 400, `"${bad}" is not a policy version`);
    }

    // Change it.
    const put = await chain('PUT', '/settings', { ...initial.body.settings, consentPolicyVersion: 'v2' });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.settings.consentPolicyVersion, 'v2');
    assert.equal((await call('GET', '/config?branch=Q1')).body.consentPolicyVersion, 'v2', '/config follows');
    const stale = await call('POST', '/orders', orderBody('v1'));
    assert.equal(stale.body.error.code, 'CONSENT_REQUIRED', 'the old version no longer counts');
    assert.equal(stale.body.error.details.expected, 'v2');
    assert.equal((await call('POST', '/orders', orderBody('v2'))).status, 201);

    const logs = await app.db
      .query('plugin::ordering.admin-change-log')
      .findMany({ where: { action: 'settings.update' } });
    assert.ok(
      logs.some((row) => JSON.stringify(row.after ?? row.afterSnapshot ?? row).includes('v2')),
      'the version change is in the change-log',
    );

    // Staff drafts: the server stamps the current version whatever the page sent.
    const none = await chain('POST', '/drafts', draftBody({ accepted: true }));
    assert.equal(none.status, 200, JSON.stringify(none.body));
    assert.equal(none.body.order.consent.policyVersion, 'v2');
    const hardcoded = await chain('POST', '/drafts', draftBody({ policyVersion: 'v1', accepted: true }));
    assert.equal(hardcoded.status, 200, JSON.stringify(hardcoded.body));
    assert.equal(hardcoded.body.order.consent.policyVersion, 'v2', 'a client-sent version is ignored');
    assert.equal(
      (await chain('POST', '/drafts', draftBody({ policyVersion: 'v2' }))).body.error.code,
      'CONSENT_REQUIRED',
      'consent still has to be accepted',
    );

    // Clearing the override goes back to the config value.
    const { consentPolicyVersion: _drop, ...rest } = put.body.settings;
    const cleared = await chain('PUT', '/settings', rest);
    assert.equal(cleared.status, 200);
    assert.equal((await call('GET', '/config?branch=Q1')).body.consentPolicyVersion, 'v1');
  } finally {
    await http.cleanup();
    await store.delete();
  }

  console.log('[ordering-test] consent-policy: Admin setting, /config, stale version refused, change-log, staff drafts stamped, config fallback verified');
});
