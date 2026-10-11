// O4 step 8: reconciliation records a missed transfer once, even from two processes.
// A later API row whose id is a UUID but whose reference matches a webhook does not capture again.
// The fixture file is the only SePay response. No network.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSepayReconciliation } from '../../src/plugins/ordering/dist/server/src/jobs/reconciliation.js';
import {
  basicOrderInput,
  bootOrderingTestApp,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const [, , mode, owner] = process.argv;
const FILE = fileURLToPath(import.meta.url);
const ACCOUNTS = ['0123456789', '999000111222', '333000111222'];
const MISSED_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const AGAIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OUT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

if (mode === 'worker') {
  const app = await bootOrderingTestApp();
  try {
    const result = await runSepayReconciliation(app, { owner: owner ?? 'worker' });
    console.log(`[ordering-test] reconcile ${owner} ${JSON.stringify(result)}`);
  } finally {
    await app.destroy();
  }
  process.exit(0);
}

const fixturePath = join(tmpdir(), `sepay-reconcile-${process.pid}.json`);
process.env.SEPAY_TEST_TRANSACTIONS_FILE = fixturePath;
const writeFixture = (rows) => writeFileSync(fixturePath, JSON.stringify(rows));

const runWorker = (workerOwner) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FILE, 'worker', workerOwner], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let stderr = '';
    child.stdout.on('data', (data) => process.stdout.write(`  [${workerOwner}] ${data}`));
    child.stderr.on('data', (data) => {
      stderr += data;
      process.stderr.write(`  [${workerOwner}!] ${data}`);
    });
    child.on('exit', (code) => resolve({ code, stderr }));
    child.on('error', reject);
  });

const sign = (secret, timestamp, rawBody) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

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

    const { order } = services(app);
    const events = () => app.db.query('plugin::ordering.payment-event');
    const store = app.store({ type: 'plugin', name: 'ordering' });
    const clearCursors = async () => {
      for (const account of ACCOUNTS) await store.delete({ key: `sepay-since:${account}` });
    };
    const capturedOf = (aggregate) =>
      aggregate.payments.reduce((sum, payment) => sum + payment.capturedAmount, 0);
    const place = () => order.createOrder(basicOrderInput(), systemCtx);

    await clearCursors();
    const missed = await place();
    const missedId = missed.order.order.id;
    const missedTotal = missed.order.order.totalAmount;
    const missedCode = missed.order.order.code;
    assert.equal(missed.order.groups[0].status, 'awaiting-payment');
    writeFixture([
      {
        id: MISSED_ID,
        transaction_date: '2026-10-11 10:00:00',
        account_number: '0123456789',
        transfer_type: 'in',
        amount_in: missedTotal,
        amount_out: 0,
        transaction_content: `SLC${missedCode}`,
        reference_number: 'FTREC8001',
        bank_brand_name: 'MBBank',
      },
    ]);

    const [first, second] = await Promise.all([runWorker('A'), runWorker('B')]);
    assert.equal(first.code, 0, `worker A must exit cleanly (got ${first.code})`);
    assert.equal(second.code, 0, `worker B must exit cleanly (got ${second.code})`);

    const missedEvents = await events().findMany({ where: { providerCode: 'sepay' } });
    assert.equal(missedEvents.length, 1, 'two processes must store one event');
    assert.equal(missedEvents[0].providerTransactionId, MISSED_ID);
    assert.equal(missedEvents[0].reviewStatus, 'auto-matched');
    assert.equal(missedEvents[0].rawPayload.source, 'reconciliation');
    assert.equal(missedEvents[0].rawPayload.referenceCode, 'FTREC8001');
    const missedJson = JSON.stringify(missedEvents[0].rawPayload);
    assert.equal(missedJson.includes('0123456789'), false);
    assert.equal(missedJson.includes(`SLC${missedCode}`), false);
    const missedOrder = await order.getOrder(missedId, systemCtx);
    assert.equal(missedOrder.groups[0].status, 'awaiting-acceptance');
    assert.equal(capturedOf(missedOrder), missedTotal);
    assert.equal(await store.get({ key: 'sepay-since:0123456789' }), MISSED_ID);

    const again = await runSepayReconciliation(app, { owner: 'parent' });
    assert.equal(again.ran, true);
    assert.equal(again.ingested, 0);
    assert.equal((await events().findMany({ where: { providerCode: 'sepay' } })).length, 1);

    await app.listen();
    const secret = app.config.get('plugin::ordering').providers.payment.sepay.webhookSecret;
    const url = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering/webhooks/sepay`;
    const post = async (payload) => {
      const body = JSON.stringify(payload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SePay-Timestamp': timestamp,
          'X-SePay-Signature': `sha256=${sign(secret, timestamp, body)}`,
        },
        body,
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };

    const hooked = await place();
    const hookedId = hooked.order.order.id;
    const hookedTotal = hooked.order.order.totalAmount;
    const hookedCode = hooked.order.order.code;
    const ack = await post({
      id: 88001,
      gateway: 'MBBank',
      transactionDate: '2026-10-11 11:00:00',
      accountNumber: '0123456789',
      content: `SLC${hookedCode}`,
      transferType: 'in',
      transferAmount: hookedTotal,
      referenceCode: 'FTREC8801',
    });
    assert.equal(ack.status, 200);
    assert.deepEqual(ack.body, { success: true });
    writeFixture([
      {
        id: AGAIN_ID,
        transaction_date: '2026-10-11 11:00:01',
        account_number: '0123456789',
        transfer_type: 'in',
        amount_in: hookedTotal,
        amount_out: 0,
        transaction_content: `SLC${hookedCode}`,
        reference_number: 'FTREC8801',
        bank_brand_name: 'MBBank',
      },
    ]);
    const attached = await runSepayReconciliation(app, { owner: 'parent-attach' });
    assert.equal(attached.ran, true);
    assert.equal(attached.ingested, 0);
    assert.ok(attached.duplicates >= 1);
    const hookedEvents = (await events().findMany({ where: { providerCode: 'sepay' } })).filter((row) =>
      ['88001', AGAIN_ID].includes(row.providerTransactionId),
    );
    assert.equal(hookedEvents.length, 1);
    assert.equal(hookedEvents[0].providerTransactionId, '88001');
    const hookedOrder = await order.getOrder(hookedId, systemCtx);
    assert.equal(capturedOf(hookedOrder), hookedTotal);

    const manualOrder = await place();
    const manualId = manualOrder.order.order.id;
    const manualTotal = manualOrder.order.order.totalAmount;
    await app.plugin('ordering').service('manual-payment').record(
      manualId,
      { reference: 'FTRECOUT1', amount: manualTotal, transferredAt: null, note: null },
      systemCtx,
    );
    writeFixture([
      {
        id: OUT_ID,
        transaction_date: '2026-10-11 12:00:00',
        account_number: '0123456789',
        transfer_type: 'out',
        amount_in: 0,
        amount_out: manualTotal,
        transaction_content: 'OUT-SHOULD-NOT-BE-STORED',
        reference_number: 'FTRECOUT1',
        bank_brand_name: 'MBBank',
      },
    ]);
    const outbound = await runSepayReconciliation(app, { owner: 'parent-out' });
    assert.equal(outbound.ran, true);
    assert.equal(outbound.ingested, 1);
    const outRow = await events().findOne({ where: { providerTransactionId: OUT_ID } });
    const manualRow = await events().findOne({ where: { providerTransactionId: 'FTRECOUT1' } });
    assert.equal(outRow.reviewStatus, 'ignored');
    assert.equal(outRow.transferType, 'out');
    assert.equal(manualRow.rawPayload.confirmed, false);
    const outJson = JSON.stringify(outRow.rawPayload);
    assert.equal(outJson.includes('0123456789'), false);
    assert.equal(outJson.includes('OUT-SHOULD-NOT-BE-STORED'), false);
    const afterOut = await order.getOrder(manualId, systemCtx);
    assert.equal(afterOut.groups[0].status, 'awaiting-acceptance');
    assert.equal(capturedOf(afterOut), manualTotal);

    console.log('[ordering-test] sepay reconcile: once, attach, out');
  });
} finally {
  try {
    unlinkSync(fixturePath);
  } catch {
    // The file is only a test fixture.
  }
}
