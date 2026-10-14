import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

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

// O13 step 6: Zalo ZNS end-to-end against a loopback fake — OAuth bootstrap, template send with
// mapped params, -124 refresh-retry, zalo→sms→email chain fallback, dedupe, the daily paid cap
// (+ alert), and OTP over ZNS. No real network: ZALO_BASE_URL/ZALO_OAUTH_URL point at this
// server. Logs must never carry phones or message bodies — the fake keeps them in memory.
const startFakeZalo = () => {
  const calls = { refresh: [], send: [] };
  const usedRefreshTokens = new Set();
  const fake = { mode: 'ok', sentOtp: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const reply = (body) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      // OAuth refresh: POST form to the oauthUrl root (no path).
      if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
        const fields = Object.fromEntries(new URLSearchParams(raw));
        calls.refresh.push(fields);
        if (fields.grant_type !== 'refresh_token' || !fields.refresh_token) {
          reply({ error: -1, message: 'bad refresh request' });
          return;
        }
        // Zalo refresh tokens are single-use: a used one is rejected, each refresh rotates it.
        if (usedRefreshTokens.has(fields.refresh_token)) {
          reply({ error: -14014, message: 'refresh token already used' });
          return;
        }
        usedRefreshTokens.add(fields.refresh_token);
        reply({ access_token: `tok-${calls.refresh.length}`, refresh_token: `rt-${calls.refresh.length}`, expires_in: 3600 });
        return;
      }
      if (req.url === '/message/template') {
        const body = JSON.parse(raw || '{}');
        calls.send.push({ headers: req.headers, body });
        if (fake.mode === 'expired') {
          fake.mode = 'ok';
          reply({ error: -124, message: 'access token expired' });
          return;
        }
        if (fake.mode === 'error') {
          fake.mode = 'ok';
          reply({ error: -1121, message: 'template data invalid' });
          return;
        }
        if (body.template_id === 'zns-otp') fake.sentOtp.push(body.template_data?.otp);
        reply({ error: 0, message: 'Success', data: { msg_id: `zns-${calls.send.length}` } });
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

const zalo = await startFakeZalo();
try {
  // Provider env must exist before the app boots — the plugin config loads at compile time.
  process.env.PORT ??= String(1400 + (process.pid % 500));
  process.env.ZALO_APP_ID = 'zalo-test-app';
  process.env.ZALO_APP_SECRET = 'zalo-test-secret';
  process.env.ZALO_REFRESH_TOKEN = 'zalo-test-refresh';
  process.env.ZALO_BASE_URL = zalo.base;
  process.env.ZALO_OAUTH_URL = zalo.base;
  process.env.ORDERING_OTP_CHANNELS = 'email,zalo';

  await withApp(async (app) => {
    const plugin = app.plugin('ordering');
    const cfg = app.config.get('plugin::ordering');
    assert.equal(cfg.providers.notification.zalo.enabled, true);
    assert.ok(cfg.customers.otpChannels.includes('zalo'));
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
      // --- chain rule: customer.order-ready = zalo → sms → email with a ZNS mapping ---------
      await channelRules.put(
        'customer.order-ready',
        {
          channels: ['zalo', 'sms', 'email'],
          zns: { templateId: 'zns-ready', params: { order_code: 'code', branch_name: 'branchName' } },
        },
        systemCtx,
      );
      // Validation: unknown channel / missing zns are refused before persistence.
      await assert.rejects(
        channelRules.put('customer.order-ready', { channels: ['fax'] }, systemCtx),
        /unknown notification channel/,
      );
      await assert.rejects(
        channelRules.put('customer.order-placed', { channels: ['zalo'] }, systemCtx),
        /zns.templateId/,
      );
      await assert.rejects(
        channelRules.put('no.such-template', { channels: ['email'] }, systemCtx),
        /unknown template code/,
      );

      const place = async () =>
        order.createOrder(
          basicOrderInput({
            locationRef: 'Q1',
            receiveMethod: { kind: 'pickup', locationRef: 'Q1' },
            contact: { name: 'Khách zns', phone: '0901234567', email: 'zns@example.invalid' },
          }),
          systemCtx,
        );
      const ready = async (orderId) => {
        await plugin.service('admin-orders').transition(orderId, { to: 'preparing' }, lanCtx);
        await plugin.service('admin-orders').transition(orderId, { to: 'ready' }, lanCtx);
      };

      // --- happy path: ZNS with mapped params; chain stops after the first send --------------
      const first = await place();
      await ready(first.order.order.id);
      await dispatch();
      assert.equal(zalo.calls.refresh.length, 1, 'OAuth token bootstrapped once');
      assert.equal(zalo.calls.refresh[0].grant_type, 'refresh_token');
      const send = zalo.calls.send.at(-1);
      assert.equal(send.headers.access_token, 'tok-1');
      assert.equal(send.body.phone, '84901234567');
      assert.equal(send.body.template_id, 'zns-ready');
      assert.equal(send.body.template_data.order_code, first.order.order.code);
      assert.match(String(send.body.tracking_id), /^nd-\d+$/);
      const zaloRow = await deliveries().findOne({
        where: { template: 'customer.order-ready', channel: 'zalo' },
      });
      assert.equal(zaloRow.status, 'sent');
      assert.match(zaloRow.providerMessageId, /^zns-/);
      assert.equal(zaloRow.costEstimate, 300);
      assert.equal(
        capture.sent.filter((mail) => mail.template === 'customer.order-ready').length,
        0,
        'email is a fallback, not a fan-out',
      );
      // A re-run never resends — the row is already sent.
      await dispatch();
      assert.equal(zalo.calls.send.length, 1);

      // --- -124 once: forced refresh + retry on the new token --------------------------------
      zalo.fake.mode = 'expired';
      const second = await place();
      await ready(second.order.order.id);
      await dispatch();
      assert.equal(zalo.calls.refresh.length, 2, 'expired token refreshes once');
      assert.equal(zalo.calls.send.at(-1).headers.access_token, 'tok-2');
      // The second refresh used the rotated token (the env one is single-use and already spent).
      assert.equal(zalo.calls.refresh[0].refresh_token, 'zalo-test-refresh');
      assert.equal(zalo.calls.refresh[1].refresh_token, 'rt-1');
      assert.equal(
        (await deliveries().count({
          where: { template: 'customer.order-ready', channel: 'zalo', status: 'sent' },
        })),
        2,
      );

      // --- provider failure falls back down the chain ----------------------------------------
      zalo.fake.mode = 'error';
      const third = await place();
      await ready(third.order.order.id);
      await dispatch();
      const failedZalo = await deliveries().findOne({
        where: { template: 'customer.order-ready', channel: 'zalo', status: 'failed' },
      });
      assert.ok(failedZalo, 'zalo failure is recorded');
      assert.match(failedZalo.lastError, /zalo-error:-1121|PROVIDER/);
      // sms is not configured here → skipped; email carries the copy.
      const smsSkipped = await deliveries().findOne({
        where: { template: 'customer.order-ready', channel: 'sms' },
      });
      assert.equal(smsSkipped.status, 'skipped');
      assert.equal(smsSkipped.lastError, 'provider-not-configured');
      const mails = capture.sent.filter((mail) => mail.template === 'customer.order-ready');
      assert.equal(mails.length, 1, 'fallback email carries the copy');
      // That event is `delivered` — email won the chain — so the failed zalo row stays 'failed'
      // as an audit record. Retries only happen when NO channel delivered: use a zalo-only
      // rule so the all-failed send backs the event off and re-runs it on the next claim.
      await channelRules.put(
        'customer.order-ready',
        {
          channels: ['zalo'],
          zns: { templateId: 'zns-ready', params: { order_code: 'code', branch_name: 'branchName' } },
        },
        systemCtx,
      );
      zalo.fake.mode = 'error';
      const retryOrder = await place();
      await ready(retryOrder.order.order.id);
      await dispatch();
      const deadZalo = await deliveries().findOne({
        where: { template: 'customer.order-ready', orderId: retryOrder.order.order.id },
      });
      assert.equal(deadZalo.status, 'failed');
      // The outbox backs off exponentially on failure; wind the clock forward by hand.
      const past = new Date(Date.now() - 60_000);
      await app.db.query('plugin::ordering.outbox').update({
        where: { id: Number(deadZalo.eventId) },
        data: { availableAt: past, leaseUntil: past, lockedBy: null },
      });
      await dispatch();
      const zaloSends = zalo.calls.send.filter((call) => call.body.template_id === 'zns-ready');
      assert.equal(zaloSends.length, 6, 'failed channel retried on the next event run');
      assert.equal((await deliveries().findOne({ where: { id: deadZalo.id } })).status, 'sent');
      // Back to the full chain for the daily-cap section.
      await channelRules.put(
        'customer.order-ready',
        {
          channels: ['zalo', 'sms', 'email'],
          zns: { templateId: 'zns-ready', params: { order_code: 'code', branch_name: 'branchName' } },
        },
        systemCtx,
      );

      // --- daily paid cap: zalo/sms skip, email carries, one alert per UTC day ---------------
      const sentPaid = await deliveries().count({
        where: { channel: { $in: ['zalo', 'sms'] }, status: 'sent' },
      });
      app.config.set('plugin::ordering.notifications.dailyLimit', sentPaid);
      const fourth = await place();
      await ready(fourth.order.order.id);
      await dispatch();
      const capped = await deliveries().findMany({
        where: { template: 'customer.order-ready', orderId: fourth.order.order.id },
      });
      assert.equal(
        capped.find((row) => row.channel === 'zalo')?.status,
        'skipped',
      );
      assert.equal(
        capped.find((row) => row.channel === 'zalo')?.lastError,
        'daily-limit',
      );
      assert.equal(capped.find((row) => row.channel === 'email')?.status, 'sent');
      const alert = await app.db.query('plugin::ordering.ops-alert').findOne({
        where: { alertCode: 'notification-daily-limit' },
      });
      assert.ok(alert, 'daily-limit alert opened');
      app.config.set('plugin::ordering.notifications.dailyLimit', 2000);

      // --- staff test-send via the channel-rule service --------------------------------------
      const tested = await channelRules.sendTest(
        { template: 'customer.order-ready', channel: 'zalo', target: '0901234567' },
        { actor: staff.lan.actor },
      );
      assert.equal(tested.sent, true);
      assert.match(tested.providerMessageId, /^zns-/);
      await assert.rejects(
        channelRules.sendTest(
          { template: 'customer.order-ready', channel: 'zalo', target: '123' },
          { actor: staff.lan.actor },
        ),
        /phone number/,
      );

      // --- OTP over ZNS: code rides template_data; verify issues a session --------------------
      await channelRules.put(
        'customer.otp',
        { channels: ['zalo'], zns: { templateId: 'zns-otp', params: { otp: 'otp' } } },
        systemCtx,
      );
      await app.listen();
      const base = `http://127.0.0.1:${app.server.httpServer.address().port}/api/v1/ordering`;
      const request = await fetch(`${base}/auth/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-salanca-intake-secret': 'storefront-test-secret',
          'x-salanca-visitor-ip': '192.0.2.44',
        },
        body: JSON.stringify({ channel: 'zalo', target: '090 1234 568', captchaToken: 'pass' }),
      });
      assert.equal(request.status, 200);
      const { challengeId } = await request.json();
      assert.match(challengeId, /^[0-9a-f-]{36}$/);
      const otp = zalo.fake.sentOtp.at(-1);
      assert.match(String(otp), /^\d{6}$/, 'ZNS template_data carries the code');
      const verify = await fetch(`${base}/auth/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-salanca-intake-secret': 'storefront-test-secret',
          'x-salanca-visitor-ip': '192.0.2.45',
        },
        body: JSON.stringify({ challengeId, code: String(otp) }),
      });
      assert.equal(verify.status, 200);
      const session = await verify.json();
      assert.ok(session.token);
      assert.equal(session.customer.phone, '+84901234568');
      const otpRow = await deliveries().findOne({
        where: { template: 'customer.otp', channel: 'zalo' },
      });
      assert.equal(otpRow.status, 'sent');
      assert.match(otpRow.providerMessageId, /^zns-/);
      // The phone itself is nowhere in the delivery log — hash only.
      assert.ok(!JSON.stringify(otpRow).includes('901234568'));

      console.log(
        '[ordering-test] zalo-zns: oauth, mapped send, -124 retry, fallback, cap + OTP verified',
      );
    } finally {
      await cleanupStaff(app, staff);
    }
  });
} finally {
  zalo.server.close();
}
