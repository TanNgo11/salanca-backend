// O9 step 5 — the gift-card admin surface (screens G1–G3) over HTTP: `gift-card.manage` gates
// every route, `gift-card.adjust` guards the ± balance write on its own, batch export also
// needs `export`. A complimentary issue returns the plaintext code exactly once — and only
// when nobody received it by mail; every later read carries last4 at most. Block/unblock/
// extend/adjust/resend and batch create/import/export all land in the append-only change log
// with masked labels — no full code, no recipient address in plain text.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o9 node scripts/ordering/gift-card-admin.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { seedAdminHttpStaff, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const CODE = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const CODE_IN_TEXT = /[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/;

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  await app.listen();
  const { order } = services(app);
  const giftCard = services(app).giftCard;
  const capture = app.plugin('ordering').service('registry').notificationProvider('email');
  const changeLogs = () => app.db.query('plugin::ordering.admin-change-log');
  const actionsOf = async () =>
    (await changeLogs().findMany({})).map((row) => `${row.entityType}:${row.action}`);
  const leaksCode = (payload, code) => {
    if (!code) return false;
    const json = JSON.stringify(payload);
    return json.includes(code) || json.includes(code.replaceAll('-', ''));
  };

  const staff = await seedAdminHttpStaff(app, {
    actions: ['gift-card.manage', 'gift-card.adjust', 'export'],
    scopes: { quanly: { allLocations: true, locationRefs: [] } },
  });
  const manageOnly = await seedAdminHttpStaff(app, {
    actions: ['gift-card.manage'],
    scopes: { nv: { allLocations: true, locationRefs: [] } },
  });
  const outsider = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { xem: { allLocations: true, locationRefs: [] } },
  });
  const as = staff.as.quanly;
  const asNv = manageOnly.as.nv;
  const asXem = outsider.as.xem;

  try {
    // ── Permission gates ────────────────────────────────────────────────────────
    for (const [method, path, body] of [
      ['GET', '/gift-cards'],
      ['POST', '/gift-cards', { amount: 100000, reason: 'x' }],
      ['POST', '/gift-cards/search', { code: 'AAAA-AAAA-AAAA-AAAA' }],
      ['GET', '/gift-card-batches'],
      ['POST', '/gift-card-batches', { denomination: 50000, count: 1 }],
    ]) {
      const res = await asXem(method, path, body);
      assert.equal(res.status, 403, `${method} ${path} without gift-card.manage must be 403`);
    }
    console.log('[ordering-test] every gift-card route → 403 without gift-card.manage');

    // ── G3: complimentary issue — plaintext exactly once, only unmailed ──────────
    assert.equal((await as('POST', '/gift-cards', { amount: 100000 })).status, 400, 'reason required');
    const mailed = await as('POST', '/gift-cards', {
      amount: 150000,
      reason: 'Đền bù đơn hỏng',
      recipientEmail: 'khach@example.invalid',
      recipientName: 'Khách',
      message: 'Xin lỗi anh/chị',
    });
    assert.equal(mailed.status, 201, JSON.stringify(mailed.body));
    assert.equal(mailed.body.emailSent, true);
    assert.equal(mailed.body.code, null, 'a mailed card never shows staff the code');
    assert.equal(mailed.body.recipientMasked, 'k•••@example.invalid');
    const mailedMail = capture.sent.find((mail) => mail.to === 'khach@example.invalid');
    assert.ok(mailedMail, 'the code went to the recipient mailbox');
    const mailedCode = mailedMail.text.match(CODE_IN_TEXT)?.[0];
    assert.ok(mailedCode, 'the mail carries the formatted plaintext code');

    const handed = await as('POST', '/gift-cards', { amount: 200000, reason: 'Tặng đối tác' });
    assert.equal(handed.status, 201);
    assert.match(handed.body.code, CODE, 'no mailbox → the one-time plaintext response');
    assert.equal(handed.body.emailSent, false);
    const handedId = handed.body.card.id;
    console.log('[ordering-test] G3 issue → code once (unmailed) / null (mailed); mail has the code');

    // A later read carries last4 at most — no plaintext, no hash, no seal.
    const detail = await as('GET', `/gift-cards/${handedId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.last4, handed.body.code.slice(-4));
    assert.equal(detail.body.masked, `•••• ${handed.body.code.slice(-4)}`);
    assert.ok(!leaksCode(detail.body, handed.body.code), 'detail leaks no code');
    for (const field of ['codeHash', 'sealedCode', 'sealedRecipient']) {
      assert.ok(!(field in detail.body), `${field} stays out of the response`);
    }
    assert.equal(detail.body.ledger[0].kind, 'issue', 'ledger is newest-first');

    // POST /search resolves a full code from the body — never the URL.
    const searched = await as('POST', '/gift-cards/search', { code: handed.body.code });
    assert.equal(searched.status, 200);
    assert.equal(searched.body.id, handedId);
    assert.equal((await as('POST', '/gift-cards/search', { code: 'BBBB-BBBB-BBBB-BBBB' })).status, 404);
    console.log('[ordering-test] detail/search → masked only; full-code lookup rides the body');

    // ── G2 actions: block → public invalid; unblock/extend/adjust → ledger ──────
    assert.equal((await as('POST', `/gift-cards/${handedId}/block`, {})).status, 400, 'block needs a reason');
    assert.equal((await as('POST', `/gift-cards/${handedId}/block`, { reason: 'báo mất' })).status, 200);
    const balance = await app.plugin('ordering').service('storefront').giftCardBalance(handed.body.code, systemCtx);
    assert.equal(balance, null, 'a blocked card is invisible to the public balance view');
    const quoted = await order.quote(
      {
        idempotencyKey: randomUUID(),
        locationRef: 'Q1',
        lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
        receiveMethod: { kind: 'pickup', locationRef: 'Q1' },
        contact: { name: 'K', phone: '+84900000002' },
        consent: { policyVersion: 'v1', channel: 'web-checkout' },
        payment: { providerCode: 'cash', giftCardCode: handed.body.code },
        origin: { kind: 'storefront' },
      },
      systemCtx,
    );
    assert.equal(quoted.giftCard.reason, 'invalid', 'a blocked card quotes as invalid, never "blocked"');
    assert.equal((await as('POST', `/gift-cards/${handedId}/unblock`, { reason: 'khách tìm lại được' })).status, 200);
    console.log('[ordering-test] block → public null + quote invalid; unblock restores');

    const before = (await as('GET', `/gift-cards/${handedId}`)).body;
    const newExpiry = new Date(new Date(before.expiresAt).getTime() + 30 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    assert.equal(
      (await as('POST', `/gift-cards/${handedId}/extend`, { expiresAt: newExpiry, reason: 'gia hạn vip' })).status,
      200,
    );
    const earlier = before.expiresAt.slice(0, 10);
    assert.equal(
      (await as('POST', `/gift-cards/${handedId}/extend`, { expiresAt: earlier, reason: 'x' })).status,
      400,
      'extend must move the expiry forward',
    );
    assert.equal(
      (await as('POST', `/gift-cards/${handedId}/adjust`, { amount: -50000, reason: 'trừ sai' })).status,
      200,
    );
    assert.equal(
      (await as('POST', `/gift-cards/${handedId}/adjust`, { amount: -999999, reason: 'x' })).status,
      400,
      'an adjustment can never take the balance negative',
    );
    // `gift-card.adjust` is independent — manage alone gets a 403.
    assert.equal(
      (await asNv('POST', `/gift-cards/${handedId}/adjust`, { amount: 1000, reason: 'x' })).status,
      403,
      'manage without adjust → 403',
    );
    const after = (await as('GET', `/gift-cards/${handedId}`)).body;
    assert.equal(after.balance, 150000, 'balance: 200k − 50k adjust');
    assert.deepEqual(
      after.ledger.map((row) => row.kind).slice(0, 4),
      ['adjust', 'extend', 'unblock', 'block'],
      'newest-first ledger trails the actions',
    );
    console.log('[ordering-test] extend/adjust → ledger rows; adjust is its own permission');

    // ── resend: the code goes to the ORIGINAL mailbox, staff see the masked one ──
    const mailedId = mailed.body.card.id;
    const resend = await as('POST', `/gift-cards/${mailedId}/resend`, {});
    assert.equal(resend.status, 200, JSON.stringify(resend.body));
    assert.equal(resend.body.recipientMasked, 'k•••@example.invalid');
    const resends = capture.sent.filter((mail) => mail.to === 'khach@example.invalid');
    assert.equal(resends.length, 2, 'the resend delivered a second mail');
    assert.ok(!('code' in resend.body) || resend.body.code === null, 'resend leaks no code');
    assert.equal(
      (await as('POST', `/gift-cards/${handedId}/resend`, {})).status,
      400,
      'no recipient on file → resend refuses',
    );
    console.log('[ordering-test] resend → mail to the sealed recipient; response stays masked');

    // ── Physical batches: generate → CSV once; import → all-or-nothing ──────────
    const generated = await as('POST', '/gift-card-batches', { denomination: 100000, count: 3, note: 'lô tết' });
    assert.equal(generated.status, 201, JSON.stringify(generated.body));
    assert.equal(generated.body.codes.length, 3);
    for (const code of generated.body.codes) assert.match(code, CODE);
    const batchId = generated.body.batch.id;
    const batchDetail = await as('GET', `/gift-card-batches/${batchId}`);
    assert.equal(batchDetail.status, 200);
    assert.equal(batchDetail.body.items.length, 3);
    assert.ok(batchDetail.body.items.every((card) => card.status === 'inactive'), 'batch stock starts inactive');
    assert.ok(batchDetail.body.items.every((card) => !('code' in card)), 'detail masks batch stock too');

    const list = await as('GET', '/gift-card-batches');
    assert.equal(list.status, 200);
    const listed = list.body.items.find((row) => row.id === batchId);
    assert.equal(listed.remaining, 3);
    assert.equal(listed.sold, 0);

    const csv = await fetch(
      `http://127.0.0.1:${process.env.PORT}/ordering/gift-card-batches/${batchId}/export`,
      { headers: { Authorization: `Bearer ${await staff.tokenOf('quanly')}` } },
    );
    assert.equal(csv.status, 200);
    const csvText = await csv.text();
    for (const code of generated.body.codes) assert.ok(csvText.includes(code), 'the CSV is the plaintext hand-off');
    // `export` is required on top of manage.
    const noExport = await fetch(
      `http://127.0.0.1:${process.env.PORT}/ordering/gift-card-batches/${batchId}/export`,
      { headers: { Authorization: `Bearer ${await manageOnly.tokenOf('nv')}` } },
    );
    assert.equal(noExport.status, 403, 'batch export needs the export action too');
    console.log('[ordering-test] batch generate → inactive stock; export CSV plaintext gated by export');

    // A card sold at the counter is live money: re-export lists it without its code.
    const soldStock = batchDetail.body.items[0];
    await app.db.transaction(async ({ trx }) =>
      giftCard.activateInTransaction(trx, { cardId: soldStock.id, reason: 'test' }, systemCtx),
    );
    const reExport = await (
      await fetch(`http://127.0.0.1:${process.env.PORT}/ordering/gift-card-batches/${batchId}/export`, {
        headers: { Authorization: `Bearer ${await staff.tokenOf('quanly')}` },
      })
    ).text();
    const soldCode = generated.body.codes.find(
      (code) => code.replaceAll('-', '').endsWith(soldStock.last4),
    );
    assert.ok(soldCode, 'found the sold code');
    assert.ok(!reExport.includes(soldCode), 'an activated card is exported without its code');
    assert.equal(
      generated.body.codes.filter((code) => reExport.includes(code)).length,
      2,
      'unsold stock still exports',
    );
    // A full code never rides a GET query string (URLs reach access logs).
    const fullQ = await as('GET', `/gift-cards?q=${encodeURIComponent(soldCode)}&status=all`);
    assert.equal(fullQ.status, 400, 'GET ?q=<full code> is refused');
    const tailQ = await as('GET', `/gift-cards?q=${soldStock.last4}&status=all`);
    assert.equal(tailQ.status, 200);
    console.log('[ordering-test] re-export hides sold codes; GET ?q=<full code> → 400');

    const importCodes = ['ABCD-EFGH-JKMN-PQRS', 'WXYZ-2345-6789-QRST'];
    const imported = await as('POST', '/gift-card-batches/import', {
      denomination: 50000,
      codes: importCodes,
      note: 'nhà in',
    });
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.equal(imported.body.imported, 2);
    const dup = await as('POST', '/gift-card-batches/import', { denomination: 50000, codes: importCodes });
    assert.equal(dup.status, 400, 're-importing the same code fails all-or-nothing');
    const malformed = await as('POST', '/gift-card-batches/import', {
      denomination: 50000,
      codes: ['not-a-code'],
    });
    assert.equal(malformed.status, 400);
    console.log('[ordering-test] batch import → all-or-nothing, duplicates and malformed lines refused');

    // ── change-log coverage: masked labels, no code anywhere ────────────────────
    const actions = await actionsOf();
    for (const required of [
      'gift-card:gift-card.issue',
      'gift-card:gift-card.block',
      'gift-card:gift-card.unblock',
      'gift-card:gift-card.extend',
      'gift-card:gift-card.adjust',
      'gift-card:gift-card.resend',
      'gift-card-batch:gift-card-batch.create',
      'gift-card-batch:gift-card-batch.import',
      'gift-card-batch:gift-card-batch.export',
    ]) {
      assert.ok(actions.includes(required), `change log missing ${required}`);
    }
    const allLogs = await changeLogs().findMany({});
    for (const code of [handed.body.code, mailedCode, ...generated.body.codes, ...importCodes]) {
      assert.ok(!leaksCode(allLogs, code), 'the change log never holds a plaintext code');
    }
    console.log('[ordering-test] change log covers card + batch actions with masked labels only');

    console.log('[ordering-test] done');
  } finally {
    await staff.cleanup();
    await manageOnly.cleanup();
    await outsider.cleanup();
  }
});
