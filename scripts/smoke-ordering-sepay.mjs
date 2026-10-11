// O4 acceptance smoke (spec "node scripts/smoke-ordering-sepay.mjs"): a prepay order on the
// ordering test database shows a QR, a fake-signed SePay webhook marks it paid, and a replay
// does not capture again. Never calls SePay and never touches the dev or production DB.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.FORM_INTAKE_SHARED_SECRET ||= 'smoke-ordering-secret';

const { basicOrderInput, seedBranches, seedMenu, services, systemCtx, withApp } = await import(
  './ordering/_harness.mjs'
);

const sign = (secret, timestamp, rawBody) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

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

  const { order } = services(app);
  const placed = await order.createOrder(basicOrderInput(), systemCtx);
  const orderId = placed.order.order.id;
  const code = placed.order.order.code;
  const total = placed.order.order.totalAmount;
  const token = placed.publicToken;
  assert.equal(placed.order.groups[0].status, 'awaiting-payment');

  const api = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  const paymentView = async () => {
    const res = await fetch(`${api}/orders/payment`, {
      headers: {
        'X-Order-Token': token,
        'x-salanca-intake-secret': process.env.FORM_INTAKE_SHARED_SECRET,
        'x-salanca-visitor-ip': '203.0.113.50',
      },
    });
    return { status: res.status, body: await res.json() };
  };

  const before = await paymentView();
  assert.equal(before.status, 200);
  assert.equal(before.body.payment.due, total);
  assert.equal(before.body.payment.presentation.memo, `SLC${code}`);
  assert.equal(before.body.payment.presentation.bankAccount.accountNumber, '0123456789');
  assert.ok(String(before.body.payment.presentation.qr).startsWith('data:image/svg+xml,'));

  const secret = app.config.get('plugin::ordering').providers.payment.sepay.webhookSecret;
  const payload = {
    id: 96001,
    gateway: 'MBBank',
    transactionDate: '2026-10-11 14:00:00',
    accountNumber: '0123456789',
    content: `SLC${code}`,
    transferType: 'in',
    transferAmount: total,
    referenceCode: 'FTSMOKE96001',
  };
  const post = async (body, signature) => {
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await fetch(`${api}/webhooks/sepay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SePay-Timestamp': timestamp,
        'X-SePay-Signature': signature ?? `sha256=${sign(secret, timestamp, raw)}`,
      },
      body: raw,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const paid = await post(payload);
  assert.equal(paid.status, 200);
  assert.deepEqual(paid.body, { success: true });
  const agg = await order.getOrder(orderId, systemCtx);
  assert.equal(agg.groups[0].status, 'awaiting-acceptance');
  assert.equal(agg.order.paymentStatus, 'paid');
  const captured = agg.payments.reduce((sum, payment) => sum + payment.capturedAmount, 0);
  assert.equal(captured, total);

  const after = await paymentView();
  assert.equal(after.body.payment.due, 0);
  assert.equal(after.body.payment.presentation, null);

  const replay = await post(payload);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, { success: true });
  const again = await order.getOrder(orderId, systemCtx);
  assert.equal(again.payments.reduce((sum, payment) => sum + payment.capturedAmount, 0), total);
  const rows = await app.db.query('plugin::ordering.payment-event').findMany({
    where: { providerCode: 'sepay', providerTransactionId: '96001' },
  });
  assert.equal(rows.length, 1);

  const rejected = await post(payload, `sha256=${'ab'.repeat(32)}`);
  assert.equal(rejected.status, 401);
  assert.deepEqual(rejected.body, { success: false });

  console.log(`[ordering-test] smoke sepay: ${code} signed webhook matched, replay ignored`);
});
