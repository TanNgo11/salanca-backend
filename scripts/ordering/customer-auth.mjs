// O11 step 2 gate: POST /auth/otp always answers {challengeId} (no enumeration), the code rides
// the editable customer.otp template, verify issues a session from X-Customer-Token material,
// wrong/expired/locked/consumed challenges fail with the contract codes, logout revokes, and
// neither OTP plaintext nor session tokens are persisted.
import assert from 'node:assert/strict';

// Trusted visitor-IP forwarding lets each section use its own rate-limit bucket.
process.env.FORM_INTAKE_SHARED_SECRET = 'storefront-test-secret';

import { withApp } from './_harness.mjs';

const { o11Hashing } = await import(
  '../../src/plugins/ordering/dist/server/src/domain/customers/identity.js'
);

await withApp(async (app) => {
  const plugin = app.plugin('ordering');
  const capture = plugin.service('registry').notificationProvider('email');
  const hash = o11Hashing(app.config.get('plugin::ordering').encryptionKey);
  const otps = () => app.db.query('plugin::ordering.customer-otp');
  const sessions = () => app.db.query('plugin::ordering.customer-session');
  const customers = () => app.db.query('plugin::ordering.customer');
  const customerAuth = () => plugin.service('customer-auth');
  const sysCtx = { actor: { kind: 'system' } };

  // Builtins wire storefront.captchaProvider='test-captcha' (token "pass" passes).
  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  let visitor = 1;
  const freshIp = () => `192.0.2.${visitor++}`;
  const call = async (method, path, { body, headers = {}, ip = freshIp() } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'x-salanca-intake-secret': 'storefront-test-secret',
        'x-salanca-visitor-ip': ip,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const requestOtp = (target, extras = {}, ip) =>
    call('POST', '/auth/otp', {
      body: { channel: 'email', target, captchaToken: 'pass', ...extras },
      ip,
    });
  // A fresh IP per call keeps each section inside its own `auth` bucket (10/hour).
  const verify = (challengeId, code) =>
    call('POST', '/auth/verify', { body: { challengeId, code }, ip: freshIp() });
  const codeOf = () => {
    const mail = capture.sent.at(-1);
    const match = mail?.text?.match(/\b(\d{6})\b/);
    assert.ok(match, 'customer.otp mail must carry the 6-digit code');
    return match[1];
  };

  // --- request: captcha enforced, response never discloses the profile ----------------------
  const badCaptcha = await requestOtp('lan@example.com', { captchaToken: 'nope' });
  assert.equal(badCaptcha.status, 400);
  assert.equal(badCaptcha.body.error.code, 'CAPTCHA_FAILED');
  assert.equal((await requestOtp('not-an-email')).body.error.code, 'VALIDATION_ERROR');
  assert.equal((await requestOtp('lan@example.com', { channel: 'sms' })).body.error.code, 'VALIDATION_ERROR');
  console.log('[ordering-test] /auth/otp: captcha + input validation enforced');

  // --- happy path: OTP mail, verify → token + customer ----------------------------------------
  const ip = freshIp();
  const first = await requestOtp('  Lan@Example.COM ', { captchaToken: 'pass' }, ip);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.match(first.body.challengeId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(first.body), ['challengeId'], 'no existence hint in the response');
  const mail = capture.sent.at(-1);
  assert.equal(mail.template, 'customer.otp');
  assert.equal(mail.to, 'lan@example.com', 'target normalized lowercase');
  assert.match(mail.text, /phút|minute/i, 'mail mentions the validity window');
  const code = codeOf();

  const otpRow = await otps().findOne({ where: { challengeId: first.body.challengeId } });
  assert.equal(otpRow.targetHash, hash.otpTargetHash('lan@example.com'));
  assert.match(otpRow.codeHash, /^[0-9a-f]{64}$/);
  assert.ok(otpRow.targetSealed, 'sealed target stored for binding');
  const rowText = JSON.stringify(otpRow);
  for (const secret of ['lan@example.com', code]) {
    assert.equal(rowText.includes(secret), false, `OTP row must not contain plaintext ${secret === code ? 'code' : 'target'}`);
  }
  console.log('[ordering-test] OTP row holds hashes only; mail went to the normalized target');

  // --- verify: wrong code decrements attemptsLeft, right code issues a session ------------------
  const wrong = await verify(first.body.challengeId, code === '000000' ? '000001' : '000000');
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error.code, 'OTP_INVALID');
  assert.equal(wrong.body.error.details.attemptsLeft, 4);
  assert.equal((await verify('00000000-0000-0000-0000-000000000000', '123456')).body.error.code, 'OTP_INVALID');
  const ok = await verify(first.body.challengeId, code);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.token.length >= 40, 'bearer token returned');
  const customerId = ok.body.customer.id;
  const profile = await customers().findOne({ where: { documentId: customerId } });
  assert.equal(profile.email, 'lan@example.com');
  assert.equal(profile.status, 'active');
  assert.ok(profile.emailVerifiedAt, 'emailVerifiedAt set by the email-channel verify');
  console.log('[ordering-test] verify issues a session and binds/creates the profile');

  // Session: hash only, slides on use, resolves via the header token.
  const sessionRow = (await sessions().findMany({ where: { customer: profile.id } }))[0];
  assert.equal(sessionRow.tokenHash, hash.sessionTokenHash(ok.body.token));
  assert.equal(JSON.stringify(sessionRow).includes(ok.body.token), false, 'raw token never persisted');
  const resolved = await customerAuth().resolveSession(ok.body.token, sysCtx);
  assert.equal(resolved.customer.id, profile.id);
  assert.equal(await customerAuth().resolveSession('deadbeef', sysCtx), null);
  assert.equal(await customerAuth().resolveSession(ok.body.token + 'x', sysCtx), null);
  console.log('[ordering-test] X-Customer-Token resolves; unknown/altered tokens do not');

  // --- logout revokes --------------------------------------------------------------------------
  const out = await call('POST', '/auth/logout', {
    headers: { 'x-customer-token': ok.body.token },
    ip,
  });
  assert.equal(out.status, 204);
  assert.equal(await customerAuth().resolveSession(ok.body.token, sysCtx), null);
  assert.ok((await sessions().findOne({ where: { id: sessionRow.id } })).revokedAt);
  console.log('[ordering-test] logout revokes the session');

  // --- second login: same profile, no duplicate -------------------------------------------------
  const second = await requestOtp('lan@example.com', {}, ip);
  const secondCode = codeOf();
  const secondOk = await verify(second.body.challengeId, secondCode);
  assert.equal(secondOk.status, 200);
  assert.equal(secondOk.body.customer.id, customerId, 'same email reuses the profile');
  assert.equal((await customers().findMany({ where: { email: 'lan@example.com' } })).length, 1);
  console.log('[ordering-test] repeat login reuses the profile');

  // --- consumed challenge cannot be replayed -----------------------------------------------------
  const replay = await verify(second.body.challengeId, secondCode);
  assert.equal(replay.body.error.code, 'OTP_INVALID');
  assert.equal(replay.body.error.details?.attemptsLeft, undefined);

  // --- expired challenge -------------------------------------------------------------------------
  await otps().update({
    where: { id: (await otps().findOne({ where: { challengeId: second.body.challengeId } })).id },
    data: { consumedAt: null, expiresAt: new Date(Date.now() - 60_000) },
  });
  assert.equal(
    (await verify(second.body.challengeId, secondCode)).body.error.code,
    'OTP_EXPIRED',
  );
  console.log('[ordering-test] consumed → OTP_INVALID, expired → OTP_EXPIRED');

  // --- attempt lock ------------------------------------------------------------------------------
  const locked = await requestOtp('minh@example.com', {}, freshIp());
  const lockCode = codeOf();
  const bad = lockCode === '999999' ? '999998' : '999999';
  for (let i = 0; i < 5; i += 1) {
    const res = await verify(locked.body.challengeId, bad);
    assert.equal(res.body.error.code, 'OTP_INVALID');
    assert.equal(res.body.error.details.attemptsLeft, 4 - i);
  }
  const afterLock = await verify(locked.body.challengeId, lockCode);
  assert.equal(afterLock.body.error.code, 'OTP_INVALID', 'locked even for the right code');
  console.log('[ordering-test] 5 wrong codes lock the challenge');

  // --- per-target send cap: 4th request → phantom challenge, no mail, no row ----------------------
  for (let i = 0; i < 2; i += 1) await requestOtp('minh@example.com', {}, freshIp());
  const over = await requestOtp('minh@example.com', {}, freshIp());
  assert.equal(over.status, 200, 'still a generic 200 — no existence/limits hint');
  assert.match(over.body.challengeId, /^[0-9a-f-]{36}$/);
  const mailsForMinh = capture.sent.filter((m) => m.to === 'minh@example.com').length;
  assert.equal(mailsForMinh, 3, 'sendMax mails only; the 4th send is phantom');
  const phantom = await otps().findOne({ where: { challengeId: over.body.challengeId } });
  assert.equal(phantom, null, 'phantom challenge never persisted');
  assert.equal(
    (await verify(over.body.challengeId, '123456')).body.error.code,
    'OTP_INVALID',
  );
  console.log('[ordering-test] per-target cap returns a phantom challenge (no mail, no row)');

  // --- per-IP send cap (customers.otp.ipMaxPerHour) --------------------------------------------------
  const ipLimited = freshIp();
  for (let i = 0; i < 10; i += 1) {
    const res = await requestOtp(`probe-${i}@example.com`, {}, ipLimited);
    assert.equal(res.status, 200, `send ${i + 1} inside ipMaxPerHour must pass`);
  }
  const blocked = await requestOtp('probe-x@example.com', {}, ipLimited);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  console.log('[ordering-test] ipMaxPerHour throttles OTP sends per client IP');

  // --- no PII/code in logs, delivery rows hash the recipient --------------------------------------
  const deliveries = await app.db
    .query('plugin::ordering.notification-delivery')
    .findMany({ where: { template: 'customer.otp' } });
  assert.ok(deliveries.length >= 4);
  for (const row of deliveries) {
    assert.match(row.recipientHash, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(row).includes('@'), false, 'delivery rows never hold an address');
    assert.equal(row.status, 'sent');
  }
  console.log('[ordering-test] customer.otp delivery rows carry recipientHash only');

  // --- customer.otp is a first-class editable template --------------------------------------------
  const tpl = await plugin.service('notification-template').get('customer.otp', 'vi');
  assert.equal(tpl.code, 'customer.otp');
  assert.match(tpl.defaults.subject, /\{\{otp\}\}/);
  assert.match(tpl.defaults.body, /\{\{minutes\}\}/);
  assert.deepEqual(
    tpl.variables.map((v) => v.name).sort(),
    ['minutes', 'otp'],
  );
  const rendered = await plugin
    .service('notification-template')
    .renderFor('customer.otp', 'vi', { otp: '654321', minutes: 5 });
  assert.match(rendered.subject, /654321/);
  assert.match(rendered.html, /654321/);
  console.log('[ordering-test] customer.otp editable template: describe + renderFor work');
});
