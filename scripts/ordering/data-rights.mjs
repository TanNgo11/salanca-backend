// O11 step 6 gate: Decree 13 data rights end to end. /me/data-export answers the customer's
// own data (staff references stripped); /me/erase records a request, signs every session out,
// anonymizes closed orders, and waits on open ones — the data-request-waiting job finishes the
// erase once the order closes. Admin routes gate on customer.manage / customer.erase, staff
// see a customer only through an in-scope order, and the O6 sales report must not move.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.FORM_INTAKE_SHARED_SECRET = 'storefront-test-secret';

import {
  basicOrderInput,
  seedAdminHttpStaff,
  seedBranches,
  seedMenu,
  systemCtx,
  withApp,
} from './_harness.mjs';

const { runDataRequestWaiting } = await import(
  '../../src/plugins/ordering/dist/server/src/jobs/data-request-waiting.js'
);

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  // Q1 offers delivery into the fixture communes so the closed order can carry a full address.
  const branches = app.db.query('plugin::ordering.branch');
  const q1 = await branches.findOne({ where: { code: 'Q1' } });
  await branches.update({
    where: { id: q1.id },
    data: {
      fulfillment: {
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
          zones: [
            {
              code: 'near',
              label: 'Gần',
              priority: 10,
              match: { kind: 'commune', communeCodes: ['XT01001', 'XT01002'] },
              rules: [{ when: 'any', fee: 0 }],
              minOrderAmount: 0,
              extraLeadTimeMinutes: 0,
            },
          ],
        },
      },
    },
  });
  const plugin = app.plugin('ordering');
  const capture = plugin.service('registry').notificationProvider('email');
  const orders = () => app.db.query('plugin::ordering.order');
  const requests = () => app.db.query('plugin::ordering.data-request');
  const customers = () => app.db.query('plugin::ordering.customer');
  const sessions = () => app.db.query('plugin::ordering.customer-session');
  const carts = () => app.db.query('plugin::ordering.cart');
  const addresses = () => app.db.query('plugin::ordering.customer-address');
  const otps = () => app.db.query('plugin::ordering.customer-otp');
  const outbox = () => app.db.query('plugin::ordering.outbox');
  const fulfillments = () => app.db.query('plugin::ordering.fulfillment');
  const erasedEvents = () =>
    outbox().findMany({ where: { type: 'customer.erased' } });

  await app.listen();
  const staff = await seedAdminHttpStaff(app, {
    scopes: {
      quanly: { allLocations: true, locationRefs: [] },
      q1: { allLocations: false, locationRefs: ['Q1'] },
    },
  });
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  let visitor = 1;
  const call = async (method, path, { body, headers = {} } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'x-salanca-intake-secret': 'storefront-test-secret',
        'x-salanca-visitor-ip': `192.0.7.${visitor++}`,
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
  const place = async (customerId, overrides = {}) =>
    plugin.service('order').createOrder(
      basicOrderInput({
        customerId,
        contact: { name: 'Khách Xóa', phone: '+84912345678', email: 'erase-me@example.com' },
        customerNote: 'gọi trước khi giao',
        ...overrides,
      }),
      systemCtx,
    );

  // ── Setup: a customer with a profile phone, one closed order, one open order, an address,
  //          a cart — plus a second customer whose only order sits at Q3. ───────────────
  const session = await login('erase-me@example.com');
  const auth = { 'x-customer-token': session.token };
  const customer = await customers().findOne({ where: { documentId: session.customer.id } });
  const eraseGroup = await app.db.query('plugin::ordering.customer-group').create({
    data: { code: 'erase-me', name: { vi: 'Nhóm xóa' }, active: true },
  });
  await app.db.query('plugin::ordering.customer-group-member').create({
    data: {
      customerId: customer.id,
      customerDocumentId: customer.documentId,
      groupDocumentId: eraseGroup.documentId,
      source: 'manual',
    },
  });
  // Give the profile a phone (the OTP flow only captures email; phone comes from orders).
  const hashing = (await import(
    '../../src/plugins/ordering/dist/server/src/domain/customers/identity.js'
  )).o11Hashing(app.config.get('plugin::ordering').encryptionKey);
  await customers().update({
    where: { id: customer.id },
    data: { phone: '+84912345678', phoneHash: hashing.phoneHash('+84912345678') },
  });
  await call('POST', '/me/addresses', {
    body: {
      label: 'Nhà',
      recipientName: 'Khách Xóa',
      phone: '0912345678',
      line1: '1 Ngõ Kín',
      communeCode: 'XT01001',
    },
    headers: auth,
  });
  const closed = await place(customer.id, {
    receiveMethod: {
      kind: 'delivery',
      address: {
        communeCode: 'XT01002',
        line1: '12 Đường Bí Mật',
        recipientName: 'Người Thử',
        phone: '0901234567',
      },
    },
  });
  await orders().update({ where: { id: closed.order.order.id }, data: { status: 'completed' } });
  const open = await place(customer.id);
  const closedCode = closed.order.order.code;
  const openId = open.order.order.id;
  const openCode = open.order.order.code;
  const businessDate = (await orders().findOne({ where: { id: closed.order.order.id } })).businessDate;
  // A live cart for the same customer (deleted on finalize).
  await call('POST', '/carts', {
    body: { locationRef: 'Q1', receiveMethod: { kind: 'pickup' } },
    headers: auth,
  });
  await call('POST', '/carts/current/lines', { body: { sellableUid: 'bun-bo', quantity: 1 }, headers: auth });

  // O8 ratings: free text is personal data; stars and tags must survive erasure.
  const ratings = () => app.db.query('plugin::ordering.order-rating');
  const ratingBefore = await ratings().create({ data: {
    orderId: closed.order.order.id, locationRef: 'Q1', stars: 2, tags: ['slow'],
    comment: 'Private review text', staffNote: 'Private internal text', staffNoteBy: 'admin:123',
    messageLocale: 'vi', status: 'visible', ratedAt: new Date(),
    editableUntil: new Date(Date.now() + 86400000),
  } });
  // Keep the promotion HMAC and all accounting fields, including on a retry.
  const redemptionKey = plugin.service('promotion').customerKey('+84912345678');
  const redemptions = () => app.db.query('plugin::ordering.promotion-redemption');
  const redemptionBefore = await redemptions().create({ data: {
    promotionId: 900001, orderId: closed.order.order.id, customerKey: redemptionKey,
    discountAmount: 10000, status: 'applied', reservedAt: new Date(), appliedAt: new Date(),
  } });

  // Sales report BEFORE erasure — must be identical after (money/lines/branch survive).
  const salesBefore = await staff.as.quanly(
    'GET',
    `/reports/sales?from=${businessDate}&to=${businessDate}&groupBy=day`,
  );
  assert.equal(salesBefore.status, 200, JSON.stringify(salesBefore.body));

  // ── Permission gates: no customer.erase → 403 on every data-request route ────────────
  const noErase = await seedAdminHttpStaff(app, {
    actions: ['order.read', 'customer.manage'],
    scopes: { nv: { allLocations: true, locationRefs: [] } },
  });
  for (const [method, path, body] of [
    ['GET', '/data-requests'],
    ['POST', '/data-requests', { phone: '0912345678', kind: 'erase' }],
    ['POST', '/data-requests/abc/process', {}],
    ['POST', '/data-requests/abc/reject', { reason: 'x' }],
  ]) {
    const res = await noErase.as.nv(method, path, body);
    assert.equal(res.status, 403, `${method} ${path} denied without customer.erase`);
  }
  console.log('[ordering-test] permission gates: data-requests need customer.erase');

  // O16: the customer holds 120 points in one lot — the export lists them, the erase forfeits them.
  await app.plugin('ordering').service('loyalty-settings').put({ enabled: true }, { actor: { kind: 'system' } });
  const pointsLot = await app.db.query('plugin::ordering.loyalty-lot').create({
    data: { customerId: customer.id, source: 'adjust', points: 120, remaining: 120, expiresAt: new Date(Date.now() + 30 * 86_400_000) },
  });
  await app.db.connection.transaction((trx) =>
    app.plugin('ordering').service('loyalty').post(trx, {
      customerId: customer.id, kind: 'adjust', points: 120, lotId: pointsLot.id, actorRef: 'test', at: new Date(),
    }),
  );

  // ── Self export: own profile/addresses/orders; staff refs stripped ───────────────────
  const exp = await call('GET', '/me/data-export', { headers: auth });
  assert.equal(exp.status, 200, JSON.stringify(exp.body));
  assert.equal(exp.body.profile.phone, '+84912345678');
  assert.equal(exp.body.profile.email, 'erase-me@example.com');
  assert.equal(exp.body.addresses.length, 1);
  assert.equal(exp.body.orders.length, 2, 'both orders listed');
  assert.equal(exp.body.orders[0].consent.actorRef, undefined, 'no staff ref in consent');
  assert.equal(exp.body.orders[0].contact.phone, '+84912345678');
  assert.equal(exp.body.loyalty.balance, 120, 'export carries the points balance');
  assert.equal(exp.body.loyalty.lots.length, 1);
  assert.ok(exp.body.loyalty.ledger.some((row) => row.kind === 'adjust' && row.points === 120));
  assert.ok(!JSON.stringify(exp.body.loyalty).includes('+84912345678'), 'no contact data in the points section');
  const foreign = await login('foreign@example.com');
  const exp2 = await call('GET', '/me/data-export', {
    headers: { 'x-customer-token': foreign.token },
  });
  assert.equal(exp2.body.orders.length, 0, 'export carries only the session customer');
  console.log('[ordering-test] /me/data-export: own data only, staff refs stripped');

  // ── Self erase: confirm required; waiting while an order is open; sessions die ──────
  assert.equal(
    (await call('POST', '/me/erase', { body: {}, headers: auth })).status,
    400,
    'confirm:true required',
  );
  const erase = await call('POST', '/me/erase', { body: { confirm: true }, headers: auth });
  assert.equal(erase.status, 202, JSON.stringify(erase.body));
  assert.equal(erase.body.request.status, 'waiting', 'the open order blocks erasure');
  assert.equal(erase.body.request.result.ordersAnonymized, 1, 'the closed order was anonymized');
  const reqId = erase.body.request.id;
  const meAfter = await call('GET', '/me', { headers: auth });
  assert.equal(meAfter.status, 401, 'every session was revoked');
  console.log('[ordering-test] /me/erase: request waiting on open order, sessions revoked');

  // ── Staff erase without confirm → 400; the customer is left untouched ───────────────
  const staffUnconfirmed = await staff.as.quanly('POST', '/data-requests', {
    phone: '0912345678',
    kind: 'erase',
  });
  assert.equal(staffUnconfirmed.status, 400, JSON.stringify(staffUnconfirmed.body));
  assert.equal(staffUnconfirmed.body.error.details.field, 'confirm');
  assert.notEqual(
    (await customers().findOne({ where: { id: customer.id } })).status,
    'erased',
    'an unconfirmed staff erase must not touch the customer',
  );
  console.log('[ordering-test] staff erase without confirm: 400, customer untouched');

  // ── Anonymized closed order: contact/address/note gone, money and lines intact ───────
  const closedRow = await orders().findOne({
    where: { code: closedCode },
    populate: { customer: true },
  });
  assert.equal(closedRow.contactSnapshot.name, 'Khách đã xóa');
  assert.equal(closedRow.contactSnapshot.phone, null);
  assert.ok(closedRow.contactSnapshot.phoneHash, 'the HMAC stays for correlation');
  assert.equal(closedRow.customerNote, null);
  assert.equal(closedRow.customer, null, 'order unlinked from the profile');
  assert.equal(closedRow.status, 'completed', 'status untouched');
  assert.equal(
    Number(closedRow.totalAmount),
    Number(closed.order.order.totalAmount),
    'money untouched',
  );
  const scrubbedRating = await ratings().findOne({ where: { id: ratingBefore.id } });
  assert.equal(scrubbedRating.comment, null, 'erase clears the customer rating comment');
  assert.equal(scrubbedRating.staffNote, null, 'erase clears the rating staff note');
  assert.equal(scrubbedRating.staffNoteBy, null, 'no attribution left for a deleted note');
  assert.equal(scrubbedRating.stars, ratingBefore.stars, 'rating statistics retained');
  assert.deepEqual(scrubbedRating.tags, ratingBefore.tags);
  assert.deepEqual(await redemptions().findOne({ where: { id: redemptionBefore.id } }), redemptionBefore,
    'promotion customerKey and accounting fields retained byte-for-byte');
  const addr = closedRow.receiveMethod.address;
  assert.equal(addr.line1, undefined, 'street address dropped');
  assert.equal(addr.recipientName, undefined, 'recipient dropped');
  assert.equal(addr.phone, undefined, 'address phone dropped');
  assert.equal(addr.wardCode, 'XT01002', 'geo codes survive for regional reports');
  assert.equal(addr.provinceCode, 'XT01');
  const ff = await fulfillments().findOne({ where: { order: closedRow.id } });
  assert.equal(ff.addressSnapshot.line1, undefined, 'fulfillment snapshot reduced too');
  assert.equal(ff.addressSnapshot.wardCode, 'XT01002');
  const openRow = await orders().findOne({ where: { code: openCode }, populate: { customer: true } });
  assert.equal(openRow.contactSnapshot.phone, '+84912345678', 'open order keeps contact');
  assert.ok(openRow.customer, 'open order still linked');
  console.log('[ordering-test] closed order anonymized; open order untouched');

  // ── Staff process on a waiting request: still waiting, no duplicate erase ───────────
  const processed = await staff.as.quanly('POST', `/data-requests/${reqId}/process`, {});
  assert.equal(processed.status, 200, JSON.stringify(processed.body));
  assert.equal(processed.body.request.status, 'waiting');
  const list = await staff.as.quanly('GET', '/data-requests?status=waiting');
  assert.equal(list.status, 200);
  assert.ok(
    list.body.items.some((item) => item.id === reqId),
    'request appears in the waiting queue',
  );
  console.log('[ordering-test] manual process: stays waiting while the order is open');

  // ── Close the order → the job finishes the erase ─────────────────────────────────────
  await orders().update({ where: { id: openId }, data: { status: 'completed' } });
  let job = await runDataRequestWaiting(app, { owner: 'test:data-rights' });
  assert.equal(job.done, 1, 'one request finalized');
  const requestRow = await requests().findOne({ where: { documentId: reqId } });
  assert.equal(requestRow.status, 'done');
  assert.ok(requestRow.result.deleted.sessions >= 1, 'session rows deleted');
  const gone = await customers().findOne({ where: { id: customer.id } });
  assert.equal(gone.status, 'erased');
  assert.equal(gone.phone, null);
  assert.equal(gone.email, null);
  assert.equal(gone.name, null);
  assert.ok(gone.erasedAt, 'erasedAt stamped');
  assert.equal(gone.pointsBalance, 0, 'points forfeited on erase');
  assert.equal((await app.db.query('plugin::ordering.loyalty-lot').findOne({ where: { id: pointsLot.id } })).remaining, 0);
  const forfeit = await app.db.query('plugin::ordering.loyalty-ledger').findOne({ where: { customerId: customer.id, kind: 'forfeit' } });
  assert.equal(forfeit.points, -120);
  assert.equal(await addresses().count({ where: { customer: customer.id } }), 0);
  assert.equal(await carts().count({ where: { customer: customer.id } }), 0);
  assert.equal(await sessions().count({ where: { customer: customer.id } }), 0);
  assert.equal(await otps().count({ where: { customer: customer.id } }), 0);
  assert.equal(
    await app.db.query('plugin::ordering.customer-group-member').count({ where: { customerId: customer.id } }),
    0,
    'erasure removes every customer-group membership',
  );
  const erasedOrder = await orders().findOne({ where: { id: openId }, populate: { customer: true } });
  assert.equal(erasedOrder.contactSnapshot.name, 'Khách đã xóa');
  assert.equal(erasedOrder.customer, null);
  const events = await erasedEvents();
  assert.equal(events.length, 1, 'customer.erased emitted once');
  assert.equal(events[0].payload.customerHash, gone.phoneHash, 'irreversible hash only');
  job = await runDataRequestWaiting(app, { owner: 'test:data-rights' });
  assert.equal(job.done, 0, 'a second run finalizes nothing — idempotent');
  assert.equal((await erasedEvents()).length, 1, 'no duplicate webhook');
  assert.equal((await ratings().findOne({ where: { id: ratingBefore.id } })).comment, null);
  assert.deepEqual(await redemptions().findOne({ where: { id: redemptionBefore.id } }), redemptionBefore,
    'redemption still unchanged after finalization and retry');

  const salesAfter = await staff.as.quanly(
    'GET',
    `/reports/sales?from=${businessDate}&to=${businessDate}&groupBy=day`,
  );
  assert.deepEqual(salesAfter.body.summary, salesBefore.body.summary, 'O6 sales report unmoved');
  console.log('[ordering-test] job erases after close; report unchanged; rerun idempotent');

  // ── Staff-created requests: phone never stored; unknown phone finishes instantly ────
  const created = await staff.as.quanly('POST', '/data-requests', {
    phone: '0987654321',
    kind: 'erase',
    confirm: true,
    note: 'khách gọi điện yêu cầu xóa',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.request.status, 'done', 'no customer → nothing to erase');
  assert.equal(created.body.request.source, 'staff');
  const stored = await requests().findOne({ where: { documentId: created.body.request.id } });
  assert.ok(stored.phoneHash, 'the request keeps the HMAC');
  assert.ok(!JSON.stringify(stored).includes('0987654321'), 'the plaintext phone never lands');
  console.log('[ordering-test] staff request: hash stored, plaintext phone never persisted');

  // ── Reject: a waiting request can be refused with a reason ──────────────────────────
  const sessionB = await login('keep-me@example.com');
  const customerB = await customers().findOne({ where: { documentId: sessionB.customer.id } });
  await place(customerB.id); // open order → the erase request parks in waiting
  const own = await call('POST', '/me/erase', {
    body: { confirm: true },
    headers: { 'x-customer-token': sessionB.token },
  });
  assert.equal(own.status, 202, JSON.stringify(own.body));
  assert.equal(own.body.request.status, 'waiting', 'open order parks the request');
  const rejected = await staff.as.quanly('POST', `/data-requests/${own.body.request.id}/reject`, {
    reason: 'nghĩa vụ lưu trữ sổ sách',
  });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.request.status, 'rejected');
  assert.equal(rejected.body.request.note, 'nghĩa vụ lưu trữ sổ sách');
  const again = await staff.as.quanly('POST', `/data-requests/${own.body.request.id}/reject`, {
    reason: 'lần hai',
  });
  assert.equal(again.status, 400, 'a closed request cannot be rejected twice');
  console.log('[ordering-test] reject: waiting → rejected, once');

  // ── Staff export: all-locations sees it, Q1-scoped 404s a Q3-only customer ──────────
  const sessionC = await login('q3-only@example.com');
  const customerC = await customers().findOne({ where: { documentId: sessionC.customer.id } });
  await place(customerC.id, { locationRef: 'Q3', receiveMethod: { kind: 'pickup', locationRef: 'Q3' } });
  const exportOk = await staff.as.quanly('GET', `/customers/${sessionC.customer.id}/export`);
  assert.equal(exportOk.status, 200, JSON.stringify(exportOk.body));
  assert.equal(exportOk.body.orders.length, 1);
  const exportOut = await staff.as.q1('GET', `/customers/${sessionC.customer.id}/export`);
  assert.equal(exportOut.status, 404, 'out-of-scope customer is invisible');
  const exportMissing = await staff.as.quanly('GET', '/customers/not-a-customer/export');
  assert.equal(exportMissing.status, 404);
  console.log('[ordering-test] staff export: scoped — in-scope exports, others 404');

  console.log('[ordering-test] done');
});
