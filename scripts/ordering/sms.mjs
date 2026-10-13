import assert from 'node:assert/strict';
import http from 'node:http';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import {
  basicOrderInput,
  cleanupStaff,
  seedBranches,
  seedMenu,
  seedStaff,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

// O13 step 6: eSMS SMS end-to-end against a loopback fake — request shape (84… phone, content,
// RequestId dedupe, brand/type/sandbox flags), CodeResult 124 as idempotent accept, sms→email
// fallback, providerMessageId/cost on the delivery row, and OTP over SMS. No real network:
// ESMS_BASE_URL points at this server.
const startFakeEsms = () => {
  const calls = [];
  const fake = { nextCode: null };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (req.url === '/MainService.svc/json/SendMultipleMessage_V4_post_json/') {
        const body = JSON.parse(raw || '{}');
        calls.push(body);
        const code = fake.nextCode ?? '100';
        fake.nextCode = null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            code === '100'
              ? { CodeResult: '100', SMSID: `sms-${calls.length}`, CountRefund: 0 }
              : { CodeResult: code, ErrorMessage: 'fake failure' },
          ),
        );
        return;
      }
      res.writeHead(404).end('not found');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        calls,
        fake,
        base: `http://127.0.0.1:${server.address().port}`,
      }),
    );
  });
};

const esms = await startFakeEsms();
try {
  process.env.PORT ??= String(1400 + (process.pid % 500));
  process.env.ESMS_API_KEY = 'esms-test-key';
  process.env.ESMS_SECRET_KEY = 'esms-test-secret';
  process.env.ESMS_BRANDNAME = 'SALANCA';
  process.env.ESMS_SMS_TYPE = '2';
  process.env.ESMS_BASE_URL = esms.base;
  process.env.ORDERING_OTP_CHANNELS = 'email,sms';

  await withApp(async (app) => {
    const plugin = app.plugin('ordering');
    assert.equal(app.config.get('plugin::ordering').providers.notification.sms.enabled, true);
    assert.ok(app.config.get('plugin::ordering').customers.otpChannels.includes('sms'));
    const { order } = services(app);
    const capture = plugin.service('registry').notificationProvider('email');
    const channelRules = plugin.service('notification-channel');
    const deliveries = () => app.db.query('plugin::ordering.notification-delivery');
    const dispatch = () => runOutboxDispatcher(app, { owner: `test:${process.pid}` });
    await seedBranches(app);
    seedMenu(app);
    const staff = await seedStaff(app);
    const lanCtx = { actor: staff.lan.actor };

    try {
      await channelRules.put(
        'customer.order-ready',
        { channels: ['sms', 'email'] },
        systemCtx,
      );

      const place = async () =>
        order.createOrder(
          basicOrderInput({
            locationRef: 'Q1',
            receiveMethod: { kind: 'pickup', locationRef: 'Q1' },
            contact: { name: 'Khách sms', phone: '0901234567', email: 'sms@example.invalid' },
          }),
          systemCtx,
        );
      const ready = async (orderId) => {
        await plugin.service('admin-orders').transition(orderId, { to: 'preparing' }, lanCtx);
        await plugin.service('admin-orders').transition(orderId, { to: 'ready' }, lanCtx);
      };

      // --- happy path: body shape, dedupe id, msg id + cost on the row -----------------------
      const first = await place();
      await ready(first.order.order.id);
      await dispatch();
      assert.equal(esms.calls.length, 1);
      const sent = esms.calls[0];
      assert.equal(sent.Phone, '84901234567');
      assert.equal(sent.ApiKey, 'esms-test-key');
      assert.equal(sent.Brandname, 'SALANCA');
      assert.equal(sent.SmsType, '2');
      assert.equal(sent.IsUnicode, '1');
      assert.equal(sent.Sandbox, '0');
      assert.match(String(sent.RequestId), /^nd-\d+$/);
      assert.ok(String(sent.Content).includes(first.order.order.code), 'order code in the text');
      const smsRow = await deliveries().findOne({
        where: { template: 'customer.order-ready', channel: 'sms' },
      });
      assert.equal(smsRow.status, 'sent');
      assert.match(smsRow.providerMessageId, /^sms-/);
      assert.equal(smsRow.costEstimate, 900);
      assert.equal(sent.RequestId, `nd-${smsRow.id}`, 'RequestId is the delivery row id');
      assert.equal(
        capture.sent.filter((mail) => mail.template === 'customer.order-ready').length,
        0,
      );
      // Dispatcher re-run never resends.
      await dispatch();
      assert.equal(esms.calls.length, 1);

      // --- CodeResult 124: duplicate RequestId is already-accepted, not a resend -------------
      esms.fake.nextCode = '124';
      const second = await place();
      await ready(second.order.order.id);
      await dispatch();
      const dupRow = await deliveries().findOne({
        where: { template: 'customer.order-ready', channel: 'sms', status: 'sent' },
        orderBy: { id: 'desc' },
      });
      assert.ok(dupRow, 'duplicate-RequestId accept still marks the row sent');

      // --- provider failure falls back to email ----------------------------------------------
      esms.fake.nextCode = '99';
      const third = await place();
      await ready(third.order.order.id);
      await dispatch();
      const failedSms = await deliveries().findOne({
        where: { template: 'customer.order-ready', channel: 'sms', status: 'failed' },
      });
      assert.ok(failedSms);
      assert.match(failedSms.lastError, /esms-code:99|PROVIDER/);
      const fallbackMail = capture.sent.filter(
        (mail) => mail.template === 'customer.order-ready',
      );
      assert.equal(fallbackMail.length, 1, 'email fallback sent after sms failure');

      // --- OTP over SMS: code inside Content; verify issues a session -------------------------
      await app.listen();
      const base = `http://127.0.0.1:${app.server.httpServer.address().port}/api/v1/ordering`;
      const request = await fetch(`${base}/auth/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-salanca-intake-secret': 'storefront-test-secret',
          'x-salanca-visitor-ip': '192.0.2.77',
        },
        body: JSON.stringify({ channel: 'sms', target: '0901234569', captchaToken: 'pass' }),
      });
      assert.equal(request.status, 200);
      const { challengeId } = await request.json();
      const otpSms = esms.calls.at(-1);
      assert.equal(otpSms.Phone, '84901234569');
      const code = String(otpSms.Content).match(/\b(\d{6})\b/)?.[1];
      assert.ok(code, 'sms Content carries the 6-digit code');
      const verify = await fetch(`${base}/auth/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-salanca-intake-secret': 'storefront-test-secret',
          'x-salanca-visitor-ip': '192.0.2.78',
        },
        body: JSON.stringify({ challengeId, code }),
      });
      assert.equal(verify.status, 200);
      assert.equal((await verify.json()).customer.phone, '+84901234569');
      const otpRow = await deliveries().findOne({
        where: { template: 'customer.otp', channel: 'sms' },
      });
      assert.equal(otpRow.status, 'sent');
      assert.ok(!JSON.stringify(otpRow).includes('901234569'), 'log carries the hash only');

      console.log('[ordering-test] sms: eSMS send shape, 124 dedupe, fallback + OTP verified');
    } finally {
      await cleanupStaff(app, staff);
    }
  });
} finally {
  esms.server.close();
}
