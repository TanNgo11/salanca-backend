import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { systemCtx } from './_harness.mjs';
import { deferred, directRun } from './_review-race.mjs';
import { o11Hashing } from '../../src/plugins/ordering/dist/server/src/domain/customers/identity.js';

export async function testOtpRace(app) {
  const plugin = app.plugin('ordering');
  const auth = plugin.service('customer-auth');
  const capture = plugin.service('registry').notificationProvider('email');
  const target = `${randomUUID()}@example.invalid`;
  const hash = o11Hashing(app.config.get('plugin::ordering').encryptionKey).otpTargetHash(target);
  const before = capture.sent.length;
  const replies = await Promise.all(Array.from({ length: 8 }, () => auth.requestOtp({ channel: 'email', target }, systemCtx)));
  const rows = await app.db.query('plugin::ordering.customer-otp').findMany({ where: { targetHash: hash } });
  const limit = app.config.get('plugin::ordering').customers.otp.sendMax;
  assert.equal(rows.length, limit, 'eight concurrent requests must respect the per-target cap');
  assert.equal(capture.sent.length - before, limit, 'only persisted real challenges send mail');
  const ids = new Set(rows.map(row => row.challengeId));
  assert.equal(replies.filter(reply => ids.has(reply.challengeId)).length, limit);
  assert.equal(new Set(replies.map(reply => reply.challengeId)).size, 8);
  // Nested caller transactions must defer mail until the outermost commit; rollback sends none.
  const nestedTarget = `${randomUUID()}@example.invalid`;
  const nestedBefore = capture.sent.length;
  const sent = deferred();
  const originalSend = capture.send;
  capture.send = async function (...args) { await originalSend.apply(this, args); sent.resolve(); };
  await app.db.transaction(async () => {
    await auth.requestOtp({ channel: 'email', target: nestedTarget }, systemCtx);
    assert.equal(capture.sent.length, nestedBefore, 'no mail while an outer transaction is open');
  });
  await sent.promise;
  capture.send = originalSend;
  assert.equal(capture.sent.length, nestedBefore + 1);
  const rollbackBefore = capture.sent.length;
  await assert.rejects(app.db.transaction(async () => {
    await auth.requestOtp({ channel: 'email', target: `${randomUUID()}@example.invalid` }, systemCtx);
    throw new Error('otp-rollback-fixture');
  }), /otp-rollback-fixture/);
  assert.equal(capture.sent.length, rollbackBefore);
  console.log('[review-race] OTP: eight parallel requests produce three mails; nested commit/rollback defer mail');
}
await directRun(import.meta.url, testOtpRace);
