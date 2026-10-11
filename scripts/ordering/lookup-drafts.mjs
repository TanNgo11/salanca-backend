import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.FORM_INTAKE_SHARED_SECRET = 'lookup-test-secret';

import { seedAdminHttpStaff, seedBranches, seedMenu, withApp } from './_harness.mjs';

// O3 step 14:
// - POST /orders/lookup: code + phone (any VN format) → status-only view without PII; a wrong
//   phone and an unknown code give the same ORDER_LOOKUP_FAILED; the 6th try on one code is
//   blocked; captcha required; drafts are invisible.
// - Staff phone orders over the admin API: scope, server quote, consent phone-staff,
//   drafts tab, confirm into the live flow, run to cash handover; delete only drafts.
withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const branchRows = app.db.query('plugin::ordering.branch');
  for (const code of ['Q1', 'Q3']) {
    const row = await branchRows.findOne({ where: { code } });
    await branchRows.update({
      where: { id: row.id },
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
  }
  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  let visitor = 1;
  const call = async (method, path, body, ip = `198.51.100.${visitor++}`) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-salanca-intake-secret': 'lookup-test-secret',
        'x-salanca-visitor-ip': ip,
        'Idempotency-Key': `lookup-${randomUUID()}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  const created = await call('POST', '/orders', {
    branch: 'Q1',
    lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
    receiveMethod: { kind: 'pickup' },
    contact: { name: 'Ngọc', phone: '0901234567' },
    consent: { policyVersion: 'v1', accepted: true },
    customerNote: 'Lấy giúp 2 bộ đũa',
    captchaToken: 'pass',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const code = created.body.order.code;

  // --- Lookup -------------------------------------------------------------------------------
  const found = await call('POST', '/orders/lookup', { code: code.toLowerCase(), phone: '+84 90 123 4567', captchaToken: 'pass' });
  assert.equal(found.status, 200, JSON.stringify(found.body));
  assert.equal(found.body.order.code, code);
  const text = JSON.stringify(found.body);
  for (const secret of ['Ngọc', '0901234567', '+84901234567', 'bộ đũa', 'contact', 'customerNote']) {
    assert.ok(!text.includes(secret), `lookup view must not contain ${secret}`);
  }
  assert.ok(!('canCancel' in found.body.order), 'lookup grants no action');

  const wrongPhone = await call('POST', '/orders/lookup', { code: 'SLC-999999', phone: '0901234567', captchaToken: 'pass' });
  const unknown = await call('POST', '/orders/lookup', { code, phone: '0909999999', captchaToken: 'pass' });
  assert.equal(wrongPhone.status, 404);
  assert.equal(unknown.status, 404);
  const strip = (body) => ({ ...body.error, requestId: undefined });
  assert.deepEqual(strip(wrongPhone.body), strip(unknown.body), 'same error for unknown code and wrong phone');
  assert.equal(
    (await call('POST', '/orders/lookup', { code, phone: '0901234567', captchaToken: 'nope' })).body.error.code,
    'CAPTCHA_FAILED',
  );

  // Five tries on this code are used (found, wrong, captcha + 2 below); the 6th is blocked.
  await call('POST', '/orders/lookup', { code, phone: '0900000000', captchaToken: 'pass' });
  await call('POST', '/orders/lookup', { code, phone: '0900000001', captchaToken: 'pass' });
  const blocked = await call('POST', '/orders/lookup', { code, phone: '0901234567', captchaToken: 'pass' });
  assert.equal(blocked.status, 429, 'per-code limit: 5 per 15 minutes');

  // --- Staff phone orders ---------------------------------------------------------------------
  const http = await seedAdminHttpStaff(app, {
    scopes: { lan: { allLocations: false, locationRefs: ['Q1'] } },
  });
  try {
    const { lan } = http.as;
    const draftBody = (overrides = {}) => ({
      branch: 'Q1',
      lines: [{ sellableUid: 'tra-dao', quantity: 2 }],
      receiveMethod: { kind: 'pickup' },
      contact: { name: 'Khách gọi', phone: '0912 345 678' },
      consent: { policyVersion: 'v1', accepted: true },
      idempotencyKey: `draft-${randomUUID()}`,
      ...overrides,
    });
    assert.equal((await lan('POST', '/drafts/quote', draftBody({ branch: 'Q3' }))).status, 404, 'Q3 is out of scope');
    const quote = await lan('POST', '/drafts/quote', draftBody());
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    assert.equal(quote.body.totals.grandTotal, 90000);
    assert.equal(
      (await lan('POST', '/drafts', draftBody({ consent: { policyVersion: 'v1' } }))).body.error.code,
      'CONSENT_REQUIRED',
    );
    const draft = await lan('POST', '/drafts', draftBody());
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    assert.equal(draft.body.order.status, 'draft');
    assert.equal(draft.body.order.origin.kind, 'staff-draft');
    assert.equal(draft.body.order.consent.channel, 'phone-staff');
    assert.equal(draft.body.order.consent.actorRef, `admin:${http.users.lan.id}`);
    const draftId = draft.body.order.id;

    const drafts = await lan('GET', '/orders?tab=drafts');
    assert.deepEqual(drafts.body.results.map((row) => row.id), [draftId]);
    assert.ok(!(await lan('GET', '/orders?tab=awaiting')).body.results.some((row) => row.id === draftId));
    assert.equal(
      (await call('POST', '/orders/lookup', { code: draft.body.order.code, phone: '0912345678', captchaToken: 'pass' })).status,
      404,
      'drafts are invisible to lookup',
    );

    const confirmed = await lan('POST', `/drafts/${draftId}/confirm`);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.order.status, 'open');
    assert.ok((await lan('GET', '/orders?tab=awaiting')).body.results.some((row) => row.id === draftId));
    for (const to of ['preparing', 'ready']) {
      assert.equal((await lan('POST', `/orders/${draftId}/transition`, { to })).status, 200);
    }
    const handover = await lan('POST', `/orders/${draftId}/cash-handover`, { method: 'cash' });
    assert.equal(handover.body.detail.order.status, 'completed');

    const another = await lan('POST', '/drafts', draftBody());
    assert.equal((await lan('DELETE', `/drafts/${another.body.order.id}`)).body.deleted, true);
    assert.equal((await lan('DELETE', `/drafts/${draftId}`)).status, 400, 'only drafts can be deleted');
    console.log('[ordering-test] lookup-drafts: status-only lookup, same error, per-code limit, staff drafts end to end verified');
  } finally {
    await http.cleanup();
  }
});
