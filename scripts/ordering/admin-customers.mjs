// O11 step 7 gate: the staff customer book (screens C1–C3). The directory answers masked
// identities only — a phone-shaped query resolves by HMAC; scoped staff see a customer only
// through an in-scope order (404, never 403, like orders); name/note edits and the full-phone
// reveal write append-only change-log rows; C2's erase-request button files by customerId.
import assert from 'node:assert/strict';

process.env.FORM_INTAKE_SHARED_SECRET = 'storefront-test-secret';

import {
  basicOrderInput,
  seedAdminHttpStaff,
  seedBranches,
  seedMenu,
  systemCtx,
  withApp,
} from './_harness.mjs';

const { o11Hashing } = await import(
  '../../src/plugins/ordering/dist/server/src/domain/customers/identity.js'
);

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const plugin = app.plugin('ordering');
  const capture = plugin.service('registry').notificationProvider('email');
  const customers = () => app.db.query('plugin::ordering.customer');
  const orders = () => app.db.query('plugin::ordering.order');
  const requests = () => app.db.query('plugin::ordering.data-request');
  const changeLog = () => app.db.query('plugin::ordering.admin-change-log');
  const hashing = o11Hashing(app.config.get('plugin::ordering').encryptionKey);

  await app.listen();
  const staff = await seedAdminHttpStaff(app, {
    scopes: {
      quanly: { allLocations: true, locationRefs: [] },
      q1: { allLocations: false, locationRefs: ['Q1'] },
    },
  });
  const noRead = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { nv: { allLocations: true, locationRefs: [] } },
  });
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  let visitor = 1;
  const call = async (method, path, { body, headers = {} } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'x-salanca-intake-secret': 'storefront-test-secret',
        'x-salanca-visitor-ip': `192.0.8.${visitor++}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login = async (email) => {
    const otp = await call('POST', '/auth/otp', {
      body: { channel: 'email', target: email, captchaToken: 'pass' },
    });
    assert.equal(otp.status, 200, JSON.stringify(otp.body));
    const code = capture.sent.at(-1).text.match(/\b(\d{6})\b/)[1];
    const res = await call('POST', '/auth/verify', {
      body: { challengeId: otp.body.challengeId, code },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
  };
  const place = async (customerRowId, overrides = {}) =>
    plugin.service('order').createOrder(
      basicOrderInput({ customerId: customerRowId, ...overrides }),
      systemCtx,
    );

  // ── Customers: A (verified, phone, Q1 order, marketing), B (verified, Q3-only order),
  //    C (unverified guest profile). Stats are set directly — their computation is covered
  //    by customers.mjs; this gate checks the staff views. ─────────────────────────────
  const sessionA = await login('dir-a@example.com');
  const authA = { 'x-customer-token': sessionA.token };
  const customerA = await customers().findOne({ where: { documentId: sessionA.customer.id } });
  await customers().update({
    where: { id: customerA.id },
    data: {
      phone: '+84912223333',
      phoneHash: hashing.phoneHash('+84912223333'),
      name: 'Nguyễn Văn A',
      marketingConsent: { granted: true, at: '2026-01-01T00:00:00.000Z', source: 'checkout' },
      orderCount: 2,
      totalSpent: 360000,
      lastOrderAt: '2026-01-10T08:00:00.000Z',
    },
  });
  await call('POST', '/me/addresses', {
    body: {
      label: 'Nhà',
      recipientName: 'Nguyễn Văn A',
      phone: '0912223333',
      line1: '10 Đường Thử',
      communeCode: 'XT01001',
    },
    headers: authA,
  });
  const orderA = await place(customerA.id);
  const orderACode = orderA.order.order.code;

  const sessionB = await login('dir-b@example.com');
  const customerB = await customers().findOne({ where: { documentId: sessionB.customer.id } });
  await customers().update({
    where: { id: customerB.id },
    data: { phone: '+84914445555', phoneHash: hashing.phoneHash('+84914445555') },
  });
  await place(customerB.id, { locationRef: 'Q3', receiveMethod: { kind: 'pickup', locationRef: 'Q3' } });

  const customerC = await customers().create({
    data: {
      phone: '+84915556666',
      phoneHash: hashing.phoneHash('+84915556666'),
      name: 'Khách Chưa Xác Thực',
      status: 'unverified',
    },
  });

  // ── C1: permission gate + masked directory ──────────────────────────────────────────
  for (const path of ['/customers', `/customers/${customerA.documentId}`]) {
    const res = await noRead.as.nv('GET', path);
    assert.equal(res.status, 403, `${path} denied without customer.read`);
  }
  const deniedManage = await noRead.as.nv('PUT', `/customers/${customerA.documentId}`, { name: 'x' });
  assert.equal(deniedManage.status, 403, 'update needs customer.manage');
  const deniedReveal = await noRead.as.nv('POST', `/customers/${customerA.documentId}/reveal-phone`, {});
  assert.equal(deniedReveal.status, 403, 'reveal needs customer.manage');
  console.log('[ordering-test] permission gates: read/manage actions enforced');

  const list = await staff.as.quanly('GET', '/customers?page=1&pageSize=20');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const rowA = list.body.items.find((item) => item.id === customerA.documentId);
  assert.ok(rowA, 'customer A listed');
  assert.equal(rowA.name, 'Nguyễn Văn A');
  assert.ok(rowA.phoneMasked.includes('•'), `phone masked: ${rowA.phoneMasked}`);
  assert.ok(!rowA.phoneMasked.includes('912223333'), 'no raw digits in the mask');
  assert.equal(rowA.emailMasked, 'd***@example.com');
  assert.equal(rowA.orderCount, 2);
  assert.equal(rowA.totalSpent, 360000);
  assert.equal(rowA.marketing, true);
  assert.ok(list.body.items.every((item) => item.status !== 'erased'));
  assert.ok(!JSON.stringify(list.body).includes('912223333'), 'no plaintext phone in the list');
  console.log('[ordering-test] C1 list: masked rows, stats, marketing flag');

  // Phone-shaped q resolves by HMAC (national input matches E.164 storage); others ilike.
  for (const [q, expectId, label] of [
    ['0912223333', customerA.documentId, 'national phone'],
    ['+84912223333', customerA.documentId, 'e164 phone'],
    ['dir-a@', customerA.documentId, 'email fragment'],
    ['nguyễn văn a', customerA.documentId, 'name (case-insensitive)'],
  ]) {
    const res = await staff.as.quanly('GET', `/customers?q=${encodeURIComponent(q)}`);
    assert.equal(res.status, 200);
    assert.ok(
      res.body.items.some((item) => item.id === expectId),
      `q=${q} finds the customer (${label})`,
    );
  }
  const noHit = await staff.as.quanly('GET', '/customers?q=0900000000');
  assert.equal(noHit.body.items.length, 0, 'unknown phone finds nobody');
  const unverified = await staff.as.quanly('GET', '/customers?status=unverified');
  assert.ok(
    unverified.body.items.every((item) => item.status === 'unverified')
      && unverified.body.items.some((item) => item.id === customerC.documentId),
    'status=unverified returns only unverified customers',
  );
  const verified = await staff.as.quanly('GET', '/customers?status=verified');
  assert.ok(
    verified.body.items.every((item) => item.status === 'active'),
    'status=verified maps to active rows',
  );
  const marketingOnly = await staff.as.quanly('GET', '/customers?marketing=yes');
  assert.ok(
    marketingOnly.body.items.some((item) => item.id === customerA.documentId)
      && marketingOnly.body.items.every((item) => item.marketing === true),
    'marketing=yes returns only opted-in customers',
  );
  console.log('[ordering-test] C1 search: phone by HMAC, name/email ilike, both filters');

  // ── C2: detail + scope + masked PII ─────────────────────────────────────────────────
  const detail = await staff.as.quanly('GET', `/customers/${customerA.documentId}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.customer.name, 'Nguyễn Văn A');
  assert.ok(detail.body.customer.phoneMasked.includes('•'));
  assert.ok(!JSON.stringify(detail.body).includes('+84912223333'), 'detail carries no raw phone');
  assert.ok(detail.body.orders.some((order) => order.code === orderACode), 'orders listed');
  assert.equal(detail.body.addresses.length, 1, 'address book listed');
  assert.ok(
    detail.body.addresses[0].phoneMasked.includes('•'),
    'the address book phone is masked too',
  );
  assert.equal(detail.body.requests.length, 0, 'no requests yet');
  console.log('[ordering-test] C2 detail: masked identity, orders, addresses, requests');

  // Scope: Q1 staff sees A (Q1 order) but not B (Q3 only) — 404, not 403.
  const q1List = await staff.as.q1('GET', '/customers');
  assert.ok(q1List.body.items.some((item) => item.id === customerA.documentId), 'Q1 sees A');
  assert.ok(
    !q1List.body.items.some((item) => item.id === customerB.documentId),
    'Q1 does not see the Q3-only customer',
  );
  assert.equal((await staff.as.q1('GET', `/customers/${customerB.documentId}`)).status, 404);
  assert.equal((await staff.as.q1('PUT', `/customers/${customerB.documentId}`, { name: 'x' })).status, 404);
  assert.equal(
    (await staff.as.q1('POST', `/customers/${customerB.documentId}/reveal-phone`, {})).status,
    404,
    'out-of-scope reveal is invisible',
  );
  console.log('[ordering-test] scope: Q1 staff sees only customers with a Q1 order — 404 otherwise');

  // ── C2 actions: update (logged, masked diff), reveal-phone (logged, raw once) ───────
  const updated = await staff.as.quanly('PUT', `/customers/${customerA.documentId}`, {
    name: 'Nguyễn Văn Mới',
    staffNote: 'ghi chú nội bộ',
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.customer.name, 'Nguyễn Văn Mới');
  assert.equal(updated.body.customer.staffNote, 'ghi chú nội bộ');
  const updateLog = await changeLog().findMany({
    where: { action: 'customer.update', entityType: 'customer', entityId: String(customerA.id) },
  });
  assert.equal(updateLog.length, 1, 'customer.update logged once');
  assert.ok(
    !JSON.stringify(updateLog[0].changes).includes('Nguyễn Văn Mới'),
    'the stored diff is PII-masked',
  );
  const reveal = await staff.as.q1('POST', `/customers/${customerA.documentId}/reveal-phone`, {});
  assert.equal(reveal.status, 200, JSON.stringify(reveal.body));
  assert.equal(reveal.body.phone, '+84912223333', 'reveal answers the full phone once');
  const revealLog = await changeLog().findMany({
    where: { action: 'customer.reveal-phone', entityType: 'customer', entityId: String(customerA.id) },
  });
  assert.equal(revealLog.length, 1, 'customer.reveal-phone logged once');
  console.log('[ordering-test] C2 actions: update + reveal both write masked change-log rows');

  // ── C2 erase button → C3 request by customerId (no raw phone needed) ────────────────
  const byCustomer = await staff.as.quanly('POST', '/data-requests', {
    customerId: customerA.documentId,
    kind: 'erase',
    note: 'khách yêu cầu tại quầy',
  });
  assert.equal(byCustomer.status, 201, JSON.stringify(byCustomer.body));
  assert.equal(byCustomer.body.request.source, 'staff');
  assert.ok(
    ['waiting', 'done'].includes(byCustomer.body.request.status),
    'request created for the customer',
  );
  const requestRow = await requests().findOne({
    where: { documentId: byCustomer.body.request.id },
  });
  assert.ok(requestRow.phoneHash, 'request keyed by the existing phone hash');
  assert.ok(!JSON.stringify(requestRow).includes('912223333'), 'no plaintext phone persisted');
  const badKind = await staff.as.quanly('POST', '/data-requests', {
    customerId: customerA.documentId,
    kind: 'delete-everything',
  });
  assert.equal(badKind.status, 400, 'kind must be export|erase');
  const missing = await staff.as.quanly('GET', '/customers/not-a-customer');
  assert.equal(missing.status, 404, 'unknown documentId 404s');
  console.log('[ordering-test] C3 create-by-customerId: hash stored, kind validated, 404s clean');

  console.log('[ordering-test] done');
});
