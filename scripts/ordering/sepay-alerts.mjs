// O4 step 11: payment alerts open once per key. No call to SePay.
// Webhook streak, unmatched money, a manual transfer unseen for 24h, reconciliation miss.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runManualPaymentCheck } from '../../src/plugins/ordering/dist/server/src/jobs/manual-confirmation.js';
import { runSepayReconciliation } from '../../src/plugins/ordering/dist/server/src/jobs/reconciliation.js';
import { basicOrderInput, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const sign = (secret, timestamp, rawBody) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

const ACCOUNTS = ['0123456789', '999000111222', '333000111222'];
const MISMATCH_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MATCH_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const fixturePath = join(tmpdir(), `sepay-alerts-${process.pid}.json`);
process.env.SEPAY_TEST_TRANSACTIONS_FILE = fixturePath;

const owner = `test:${process.pid}`;
const HOUR = 60 * 60 * 1000;

try {
  await withApp(async (app) => {
    await seedBranches(app);
    seedMenu(app);
    const branches = app.db.query('plugin::ordering.branch');
    const q1 = await branches.findOne({ where: { code: 'Q1' } });
    await branches.update({
      where: { id: q1.id },
      data: {
        fulfillment: {
          pickup: {
            enabled: true,
            paymentTiming: 'prepay',
            paymentProviders: ['sepay'],
            paymentTimeoutMinutes: 15,
          },
        },
      },
    });

    await app.listen();
    const secret = app.config.get('plugin::ordering').providers.payment.sepay.webhookSecret;
    const url = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering/webhooks/sepay`;
    const alerts = () => app.db.query('plugin::ordering.ops-alert');
    const events = () => app.db.query('plugin::ordering.payment-event');
    const store = app.store({ type: 'plugin', name: 'ordering' });
    const { order } = services(app);
    const ofCode = async (code) => (await alerts().findMany({ where: { alertCode: code } }));
    const openOf = async (code) => (await ofCode(code)).filter((row) => row.status === 'open');

    const post = async (payload, signature) => {
      const body = JSON.stringify(payload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SePay-Timestamp': timestamp,
          'X-SePay-Signature': signature ?? `sha256=${sign(secret, timestamp, body)}`,
        },
        body,
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
    const reject = () => post({ id: 1 }, `sha256=${'ab'.repeat(32)}`);

    for (let i = 0; i < 4; i += 1) {
      const bad = await reject();
      assert.equal(bad.status, 401);
      assert.deepEqual(bad.body, { success: false });
    }
    assert.equal((await ofCode('webhook-failing')).length, 0);
    assert.equal(await store.get({ key: 'webhook-failures:sepay' }), '4');

    const fifth = await reject();
    assert.equal(fifth.status, 401);
    let failing = await openOf('webhook-failing');
    assert.equal(failing.length, 1);
    assert.equal(failing[0].dedupeKey, 'webhook-failing:sepay');
    assert.equal(failing[0].count, 1);
    assert.equal(failing[0].severity, 'warning');

    const sixth = await reject();
    assert.equal(sixth.status, 401);
    failing = await openOf('webhook-failing');
    assert.equal(failing.length, 1);
    assert.equal(failing[0].count, 2);

    const reset = await post({
      id: 93001,
      transferType: 'out',
      transferAmount: 1000,
      accountNumber: '0123456789',
      content: 'internal-move',
    });
    assert.equal(reset.status, 200);
    assert.deepEqual(reset.body, { success: true });
    assert.equal(await store.get({ key: 'webhook-failures:sepay' }), '0');
    assert.equal((await openOf('webhook-failing')).length, 0);
    assert.equal((await ofCode('webhook-failing')).filter((row) => row.status === 'resolved').length, 1);

    for (let i = 0; i < 4; i += 1) {
      const bad = await reject();
      assert.equal(bad.status, 401);
    }
    assert.equal((await openOf('webhook-failing')).length, 0, 'a reset streak of four does not open');

    // O6: inside the 60-minute aggregation window the same key reopens the resolved row
    // silently (anti-flapping) instead of creating a second alert.
    const reopened = await reject();
    assert.equal(reopened.status, 401);
    failing = await ofCode('webhook-failing');
    assert.equal(failing.length, 1);
    assert.equal(failing[0].status, 'open');
    assert.equal(failing[0].count, 3, 'the reopened row keeps its earlier count and adds one');

    const noCode = (id, reference) =>
      post({
        id,
        gateway: 'MBBank',
        transactionDate: '2026-10-11 12:00:00',
        accountNumber: '0123456789',
        content: 'khong co ma don',
        transferType: 'in',
        transferAmount: 50000,
        referenceCode: reference,
      });
    const firstMoney = await noCode(94001, 'FTNC94001');
    const secondMoney = await noCode(94002, 'FTNC94002');
    assert.equal(firstMoney.status, 200);
    assert.equal(secondMoney.status, 200);
    let unmatched = await openOf('payment-unmatched');
    assert.equal(unmatched.length, 1);
    assert.equal(unmatched[0].dedupeKey, 'payment-unmatched:sepay');
    assert.equal(unmatched[0].count, 2);

    const replay = await noCode(94001, 'FTNC94001');
    assert.equal(replay.status, 200);
    unmatched = await openOf('payment-unmatched');
    assert.equal(unmatched.length, 1);
    assert.equal(unmatched[0].count, 2, 'a replay does not bump the unmatched alert');

    const oldOrder = await order.createOrder(basicOrderInput(), systemCtx);
    const oldTotal = oldOrder.order.order.totalAmount;
    const oldAt = new Date(Date.now() - 25 * HOUR).toISOString();
    const recorded = await app.plugin('ordering').service('manual-payment').record(
      oldOrder.order.order.id,
      { reference: 'FTOLD2501', amount: oldTotal, transferredAt: oldAt, note: null },
      systemCtx,
    );
    const oldKey = `manual-payment-unconfirmed:${recorded.eventId}`;
    const firstCheck = await runManualPaymentCheck(app, { owner });
    assert.equal(firstCheck.ran, true);
    assert.equal(firstCheck.opened, 1);
    let manuals = await openOf('manual-payment-unconfirmed');
    assert.equal(manuals.length, 1);
    assert.equal(manuals[0].dedupeKey, oldKey);
    assert.equal(manuals[0].aggregateRef, `payment-event:${recorded.eventId}`);

    const secondCheck = await runManualPaymentCheck(app, { owner });
    assert.equal(secondCheck.opened, 0);
    manuals = await openOf('manual-payment-unconfirmed');
    assert.equal(manuals.length, 1);
    assert.equal(manuals[0].count, 2);

    const freshOrder = await order.createOrder(basicOrderInput(), systemCtx);
    const fresh = await app.plugin('ordering').service('manual-payment').record(
      freshOrder.order.order.id,
      {
        reference: 'FTFRESH01',
        amount: freshOrder.order.order.totalAmount,
        transferredAt: new Date().toISOString(),
        note: null,
      },
      systemCtx,
    );
    const afterFresh = await runManualPaymentCheck(app, { owner });
    assert.equal(afterFresh.opened, 0);
    manuals = await ofCode('manual-payment-unconfirmed');
    assert.equal(manuals.length, 1);
    assert.equal(manuals.some((row) => row.dedupeKey === `manual-payment-unconfirmed:${fresh.eventId}`), false);

    const confirm = await post({
      id: 95001,
      gateway: 'MBBank',
      transactionDate: '2026-10-11 12:30:00',
      accountNumber: '0123456789',
      content: `SLC${oldOrder.order.order.code}`,
      transferType: 'in',
      transferAmount: oldTotal,
      referenceCode: 'FTOLD2501',
    });
    assert.equal(confirm.status, 200);
    const oldRow = await events().findOne({ where: { id: recorded.eventId } });
    assert.equal(oldRow.rawPayload.confirmed, true);
    const resolvedCheck = await runManualPaymentCheck(app, { owner });
    assert.equal(resolvedCheck.resolved, 1);
    assert.equal((await openOf('manual-payment-unconfirmed')).length, 0);
    const resolvedManual = await alerts().findOne({ where: { dedupeKey: oldKey } });
    assert.equal(resolvedManual.status, 'resolved');

    for (const account of ACCOUNTS) await store.delete({ key: `sepay-since:${account}` });
    writeFileSync(
      fixturePath,
      JSON.stringify([
        {
          id: MISMATCH_ID,
          transaction_date: '2026-10-11 13:00:00',
          account_number: '0123456789',
          transfer_type: 'in',
          amount_in: 42000,
          amount_out: 0,
          transaction_content: 'chuyen tien khong ma',
          reference_number: 'FTRECON9',
          bank_brand_name: 'MBBank',
        },
      ]),
    );
    const caughtUp = await runSepayReconciliation(app, { owner: `${owner}-reconcile` });
    assert.equal(caughtUp.ran, true);
    assert.equal(caughtUp.ingested, 1);
    const mismatchKey = `reconciliation-mismatch:sepay:${MISMATCH_ID}`;
    let mismatches = await openOf('reconciliation-mismatch');
    assert.equal(mismatches.length, 1);
    assert.equal(mismatches[0].dedupeKey, mismatchKey);
    unmatched = await openOf('payment-unmatched');
    assert.equal(unmatched.length, 1);
    assert.equal(unmatched[0].count, 3);

    const matchedOrder = await order.createOrder(basicOrderInput(), systemCtx);
    const matchedCode = matchedOrder.order.order.code;
    const matchedTotal = matchedOrder.order.order.totalAmount;
    for (const account of ACCOUNTS) await store.delete({ key: `sepay-since:${account}` });
    writeFileSync(
      fixturePath,
      JSON.stringify([
        {
          id: MISMATCH_ID,
          transaction_date: '2026-10-11 13:00:00',
          account_number: '0123456789',
          transfer_type: 'in',
          amount_in: 42000,
          amount_out: 0,
          transaction_content: 'chuyen tien khong ma',
          reference_number: 'FTRECON9',
          bank_brand_name: 'MBBank',
        },
        {
          id: MATCH_ID,
          transaction_date: '2026-10-11 13:05:00',
          account_number: '0123456789',
          transfer_type: 'in',
          amount_in: matchedTotal,
          amount_out: 0,
          transaction_content: `SLC${matchedCode}`,
          reference_number: 'FTRECONMATCH',
          bank_brand_name: 'MBBank',
        },
      ]),
    );
    const again = await runSepayReconciliation(app, { owner: `${owner}-reconcile-2` });
    assert.equal(again.ingested, 1);
    assert.ok(again.duplicates >= 1);
    mismatches = await ofCode('reconciliation-mismatch');
    assert.equal(mismatches.length, 1);
    assert.equal(mismatches[0].dedupeKey, mismatchKey);
    assert.equal(
      mismatches.some((row) => row.dedupeKey === `reconciliation-mismatch:sepay:${MATCH_ID}`),
      false,
    );
    const matched = await order.getOrder(matchedOrder.order.order.id, systemCtx);
    assert.equal(matched.groups[0].status, 'awaiting-acceptance');
    unmatched = await openOf('payment-unmatched');
    assert.equal(unmatched[0].count, 3, 'an auto-matched catch-up does not bump unmatched');

    const leaked = JSON.stringify(await alerts().findMany({}));
    const hidden = [
      'FTOLD2501',
      'FTFRESH01',
      'FTNC94001',
      'FTRECON9',
      '0123456789',
      'khong co ma don',
      'internal-move',
      'chuyen tien khong ma',
    ];
    for (const secretText of hidden) {
      assert.equal(leaked.includes(secretText), false, `alert rows must not contain ${secretText}`);
    }

    console.log('[ordering-test] sepay alerts: webhook, unmatched, manual, reconcile');
  });
} finally {
  try {
    unlinkSync(fixturePath);
  } catch {
    // The file is only a test fixture.
  }
}
