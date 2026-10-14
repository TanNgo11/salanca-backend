// O13 step 5: Ahamove carrier provider against a local mock of the v3 gateway — no network
// call to Ahamove. Covers the zone-priced order, quote, idempotent book, the signed webhook
// status flow (ASSIGNING → IN PROCESS → COMPLETED with the COD collection gate), webhook
// cancel + staff cancel + re-book, and the self-delivery fallback for an unregistered carrier.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';

import {
  basicOrderInput,
  seedAdminHttpStaff,
  seedBranches,
  seedMenu,
  seedStaff,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const API_KEY = 'ahamove-test-api-key';
const MOBILE = '0909999888';
const WEBHOOK_TOKEN = 'ahamove-webhook-token-0123456';

// Fake Ahamove gateway: records calls and answers with the documented v3 shapes.
const startFakeAhamove = () => {
  const calls = { token: [], estimates: [], create: [], cancel: [] };
  let sequence = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const payload = body ? JSON.parse(body) : {};
      const reply = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.url === '/v3/accounts/token' && req.method === 'POST') {
        calls.token.push(payload);
        reply(200, { token: 'ahm-token-1' });
        return;
      }
      if (req.url === '/v3/orders/estimates' && req.method === 'POST') {
        calls.estimates.push(payload);
        reply(200, { data: [{ service_id: 'SGN-BIKE', total_fee: 38000 }] });
        return;
      }
      if (req.url === '/v3/orders' && req.method === 'POST') {
        sequence += 1;
        const orderId = `AHM-TEST-${sequence}`;
        calls.create.push({ ...payload, orderId });
        reply(200, {
          order_id: orderId,
          status: 'IDLE',
          total_fee: 38000,
          shared_link: `https://fake-ahamove.test/t/${orderId}`,
        });
        return;
      }
      if (req.url?.startsWith('/v3/orders/') && req.method === 'DELETE') {
        calls.cancel.push({ url: req.url, payload });
        reply(200, { success: true });
        return;
      }
      res.writeHead(404).end('not found');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, calls, port: server.address().port }),
    );
  });
};

const ZONE = {
  code: 'near',
  label: 'Gần',
  priority: 10,
  match: { kind: 'commune', communeCodes: ['XT01001', 'XT01002'] },
  rules: [{ when: 'any', fee: 15000 }],
};

// Test-only address; logs never print it (harness rule).
const ADDRESS = {
  communeCode: 'XT01002',
  line1: '12 Đường Bí Mật',
  recipientName: 'Người Thử',
  phone: '0901234567',
};

const fake = await startFakeAhamove();
try {
  // Provider env must exist before the app boots — the plugin config loads at compile time.
  process.env.AHAMOVE_API_KEY = API_KEY;
  process.env.AHAMOVE_MOBILE = MOBILE;
  process.env.AHAMOVE_WEBHOOK_TOKEN = WEBHOOK_TOKEN;
  process.env.AHAMOVE_ENVIRONMENT = 'staging';
  process.env.AHAMOVE_BASE_URL = `http://127.0.0.1:${fake.port}`;

  await withApp(async (app) => {
    const plugin = app.plugin('ordering');
    assert.equal(app.config.get('plugin::ordering').providers.fulfillment.ahamove.enabled, true);
    const { order, transition, payment: paymentService, branch } = services(app);
    const carriers = plugin.service('carrier-assignment');
    const orders = () => app.db.query('plugin::ordering.order');
    const fulfillments = () => app.db.query('plugin::ordering.fulfillment');
    const branches = () => app.db.query('plugin::ordering.branch');
    await seedBranches(app);
    seedMenu(app);
    const staff = await seedStaff(app);
    const keToanCtx = { actor: staff.keToan.actor };
    const errorOf = async (fn) => {
      try {
        await fn();
        return 'NO_ERROR';
      } catch (error) {
        return error?.code ?? error?.name ?? 'UNKNOWN';
      }
    };

    // Two carrier branches: A1 uses zone pricing, A2 references a carrier that is not
    // registered — order placement must silently fall back to self-delivery legs.
    const deliveryBranch = (code, carrier) => ({
      code,
      name: { vi: `Chi nhánh ${code}`, en: `Branch ${code}` },
      timezone: 'Asia/Ho_Chi_Minh',
      isActive: true,
      onlineOrdering: true,
      rank: 0,
      address: { line1: '1 Kho Chính', wardName: 'Phường Bến Nghé', provinceName: 'TP.HCM' },
      phone: '0909999000',
      fulfillment: {
        delivery: {
          enabled: true,
          orderTiming: 'both',
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          carrier,
          zones: [ZONE],
          schedule: {
            leadTimeMinutes: 60,
            slotLengthMinutes: 15,
            capacity: 8,
            openingHours: { mode: '24_7' },
          },
        },
      },
    });
    await branches().create({ data: deliveryBranch('A1', 'ahamove') });
    await branches().create({ data: deliveryBranch('A2', 'ghost-carrier') });
    // The admin branch validator rejects an unregistered carrier code.
    const rejected = await branch.updateBranch(
      'A1',
      { fulfillment: { delivery: { enabled: true, carrier: 'ghost-carrier' } } },
      keToanCtx,
    ).then(() => 'NO_ERROR', (error) => error?.code ?? 'UNKNOWN');
    assert.equal(rejected, 'VALIDATION_ERROR');

    const place = (locationRef = 'A1') =>
      order.createOrder(
        basicOrderInput({
          locationRef,
          lines: [{ sellableUid: 'bun-bo', quantity: 2 }],
          receiveMethod: { kind: 'delivery', address: ADDRESS },
          adjustments: [],
        }),
        systemCtx,
      );
    const legOf = (groupId) => fulfillments().findOne({ where: { group: groupId } });
    const groupOf = async (orderId) => (await order.getOrder(orderId, systemCtx)).groups[0];
    const readyUp = async (orderId, groupId) => {
      await transition.transitionGroup({ orderId, groupId, to: 'preparing' }, systemCtx);
      await transition.transitionGroup({ orderId, groupId, to: 'ready' }, systemCtx);
    };

    // ── Order on a carrier branch: zone fee, carrier leg code ────────────────
    const cod = await place();
    const codId = cod.order.order.id;
    const codGroup = cod.order.groups[0];
    assert.equal(codGroup.workflowName, 'delivery-pay-on-delivery');
    assert.equal(cod.order.order.totalAmount, 145000); // 130000 + zone fee 15000
    let leg = await legOf(codGroup.id);
    assert.equal(leg.providerCode, 'ahamove');
    assert.equal(leg.providerReference, null);
    assert.equal(leg.status, 'pending');
    assert.equal(fake.calls.create.length, 0, 'order placement never calls the carrier');

    // Fallback: a configured-but-unregistered carrier produces a self-delivery leg.
    const ghost = await place('A2');
    const ghostLeg = await legOf(ghost.order.groups[0].id);
    assert.equal(ghostLeg.providerCode, 'self-delivery');

    // ── Staff must see the order ready before booking ────────────────────────
    await readyUp(codId, codGroup.id);

    // Quote: live carrier fee vs the customer zone fee; the pickup is the branch address.
    const quote = await carriers.carrierQuote(codId, {}, keToanCtx);
    assert.equal(quote.providerCode, 'ahamove');
    assert.equal(quote.quotes[0].serviceId, 'SGN-BIKE');
    assert.equal(quote.quotes[0].fee.amount, 38000);
    assert.equal(quote.due, 145000);
    assert.equal(quote.customerFee, 15000);
    const estimateCall = fake.calls.estimates[0];
    assert.equal(estimateCall.path.length, 2);
    assert.equal(estimateCall.path[0].address.includes('Kho Chính'), true);
    assert.equal(estimateCall.path[1].cod, 145000);
    // No coordinates known: lat/lng are left out (optional in v3), never sent as 0,0.
    assert.equal('lat' in estimateCall.path[0], false);
    assert.equal('lng' in estimateCall.path[1], false);

    // Book: one gateway call, the trip lands on the leg.
    const booked = await carriers.carrierBook(codId, { note: 'gọi trước khi giao' }, keToanCtx);
    assert.equal(booked.alreadyBooked, false);
    assert.equal(booked.carrierRef, 'AHM-TEST-1');
    assert.equal(booked.trackingUrl, 'https://fake-ahamove.test/t/AHM-TEST-1');
    assert.equal(booked.carrierFee, 38000);
    const createCall = fake.calls.create[0];
    assert.equal(createCall.service_id, 'SGN-BIKE');
    assert.equal(createCall.payment_method, 'CASH');
    assert.equal(createCall.remarks, cod.order.order.code);
    assert.equal(createCall.path[1].cod, 145000);
    assert.equal(createCall.path[1].remarks, 'gọi trước khi giao');
    leg = await legOf(codGroup.id);
    assert.equal(leg.providerReference, 'AHM-TEST-1');
    assert.equal(leg.carrierStatus, 'IDLE');
    assert.equal(Number(leg.carrierFee), 38000);
    assert.equal(leg.trackingUrl, 'https://fake-ahamove.test/t/AHM-TEST-1');

    // Second press: idempotent — the same trip, no extra gateway call.
    const again = await carriers.carrierBook(codId, {}, keToanCtx);
    assert.equal(again.alreadyBooked, true);
    assert.equal(again.carrierRef, 'AHM-TEST-1');
    assert.equal(fake.calls.create.length, 1);
    assert.equal(leg.metadata.carrier.codAmount, 145000, 'the booked COD is remembered');
    // A trip that collects cash is booked: the customer can no longer open a wallet session.
    const registry = plugin.service('registry');
    if (!registry.hasPaymentProvider('fake-wallet')) {
      registry.registerPaymentProvider({
        code: 'fake-wallet',
        capabilities: ['wallet', 'capture'],
        initiate: async () => {
          throw new Error('fake-wallet must not be called');
        },
      });
    }
    const walletError = await paymentService
      .createWalletSession({ orderId: codId, providerCode: 'fake-wallet' }, systemCtx)
      .then(() => null, (error) => error);
    assert.equal(walletError?.code, 'VALIDATION_ERROR');
    assert.equal(walletError?.details?.reason, 'cod-trip-booked');

    // And quoting is refused while a trip is live.
    assert.equal(
      await errorOf(() => carriers.carrierQuote(codId, {}, keToanCtx)),
      'CARRIER_BOOKING_FAILED',
    );

    // ── Webhook pushes drive the leg ─────────────────────────────────────────
    await app.listen();
    const base = `http://127.0.0.1:${app.server.httpServer.address().port}`;
    const push = async (payload, apikey = WEBHOOK_TOKEN) => {
      const res = await fetch(`${base}/api/v1/ordering/webhooks/ahamove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey },
        body: JSON.stringify(payload),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    };

    // A wrong apikey is the only 401; unknown statuses and unknown refs still ACK 200
    // so Ahamove does not retry them.
    const rejectedPush = await push({ _id: 'AHM-TEST-1', status: 'ASSIGNING' }, 'wrong-token-value');
    assert.equal(rejectedPush.status, 401);
    leg = await legOf(codGroup.id);
    assert.equal(leg.carrierStatus, 'IDLE', 'a rejected push changes nothing');
    const weird = await push({ _id: 'AHM-TEST-1', status: 'NEW_STATUS_2030' });
    assert.equal(weird.status, 200);
    const alien = await push({ _id: 'AHM-NOT-OURS', status: 'ASSIGNING' });
    assert.equal(alien.status, 200);

    // ASSIGNING keeps the leg ready; IN PROCESS dispatches it through transitionGroup.
    assert.equal((await push({ _id: 'AHM-TEST-1', status: 'ASSIGNING' })).status, 200);
    leg = await legOf(codGroup.id);
    assert.equal(leg.carrierStatus, 'ASSIGNING');
    assert.equal((await groupOf(codId)).status, 'ready');
    // The same push again dedupes on carrierStatus.
    assert.equal((await push({ _id: 'AHM-TEST-1', status: 'ASSIGNING' })).status, 200);

    const processed = await push({
      _id: 'AHM-TEST-1',
      status: 'IN PROCESS',
      total_fee: 41000,
      path: [{}, { tracking_link: 'https://fake-ahamove.test/live/AHM-TEST-1' }],
      supplier: { name: 'Tài', mobile: '0909123456' },
    });
    assert.equal(processed.status, 200);
    assert.equal((await groupOf(codId)).status, 'out-for-delivery');
    leg = await legOf(codGroup.id);
    assert.equal(leg.status, 'out-for-delivery');
    assert.equal(leg.carrierStatus, 'IN PROCESS');
    assert.equal(Number(leg.carrierFee), 41000);
    assert.equal(leg.trackingUrl, 'https://fake-ahamove.test/live/AHM-TEST-1');
    assert.equal(leg.metadata.carrierDriver.name, 'Tài');
    assert.equal(leg.metadata.carrierDriver.phoneMasked, '***3456');
    assert.ok(leg.shippedAt);

    // COMPLETED with COD still due: the carrier status lands but the leg stays
    // out-for-delivery — staff collect the cash first (PAYMENT_REQUIRED parity).
    assert.equal((await push({ _id: 'AHM-TEST-1', status: 'COMPLETED' })).status, 200);
    assert.equal((await groupOf(codId)).status, 'out-for-delivery');
    leg = await legOf(codGroup.id);
    assert.equal(leg.status, 'out-for-delivery');
    assert.equal(leg.carrierStatus, 'COMPLETED');
    assert.ok(leg.metadata.awaitingCollection, 'the leg flags that courier collection is due');

    // Cash handover collects at the door; the duplicate-safe COMPLETED path then delivers.
    await paymentService.capturePayment(
      {
        paymentId: (
          await paymentService.createPayment(
            { orderId: codId, providerCode: 'cash', amount: cod.order.order.totalAmount },
            systemCtx,
          )
        ).id,
        amount: cod.order.order.totalAmount,
        providerTransactionId: `cash-door:${codId}`,
      },
      systemCtx,
    );
    assert.equal((await push({ _id: 'AHM-TEST-1', status: 'COMPLETED' })).status, 200);
    assert.equal((await groupOf(codId)).status, 'delivered');
    leg = await legOf(codGroup.id);
    assert.equal(leg.status, 'delivered');
    assert.ok(leg.deliveredAt);

    // ── Carrier-cancel while the trip is still searching: bookable again ─────
    const second = await place();
    const secondId = second.order.order.id;
    const secondGroup = second.order.groups[0];
    await readyUp(secondId, secondGroup.id);
    await carriers.carrierBook(secondId, {}, keToanCtx);
    assert.equal((await legOf(secondGroup.id)).providerReference, 'AHM-TEST-2');
    assert.equal((await push({ _id: 'AHM-TEST-2', status: 'CANCELLED', sub_status: 'NO_DRIVER' })).status, 200);
    let secondLeg = await legOf(secondGroup.id);
    assert.equal(secondLeg.providerReference, null, 'a pre-pickup cancel frees the leg');
    assert.equal(secondLeg.carrierStatus, null);
    assert.equal(secondLeg.metadata.carrierTrips.length, 1);
    assert.equal(secondLeg.metadata.carrierTrips[0].carrierRef, 'AHM-TEST-2');
    assert.equal((await groupOf(secondId)).status, 'ready');
    // "Gọi lại" books a fresh trip — the old one is only history now.
    const rebooked = await carriers.carrierBook(secondId, {}, keToanCtx);
    assert.equal(rebooked.carrierRef, 'AHM-TEST-3');
    assert.equal((await legOf(secondGroup.id)).providerReference, 'AHM-TEST-3');

    // ── Staff cancel: DELETE /v3/orders/:id then clear ───────────────────────
    const cancelled = await carriers.carrierCancel(secondId, { reason: 'khách hẹn lại' }, keToanCtx);
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.carrierRef, 'AHM-TEST-3');
    assert.equal(fake.calls.cancel.length, 1);
    assert.equal(fake.calls.cancel[0].url, '/v3/orders/AHM-TEST-3');
    secondLeg = await legOf(secondGroup.id);
    assert.equal(secondLeg.providerReference, null);
    assert.equal(secondLeg.metadata.carrierTrips.length, 2);
    // Cancelling with no live trip is a no-op.
    assert.equal((await carriers.carrierCancel(secondId, {}, keToanCtx)).cancelled, false);

    // ── Mid-trip carrier failure moves the leg to failed ─────────────────────
    const third = await place();
    const thirdId = third.order.order.id;
    const thirdGroup = third.order.groups[0];
    await readyUp(thirdId, thirdGroup.id);
    await carriers.carrierBook(thirdId, {}, keToanCtx);
    // Two parallel deliveries of the same push serialize on the leg: both ACK, one dispatch.
    const parallel = await Promise.all([
      push({ _id: 'AHM-TEST-4', status: 'IN PROCESS' }),
      push({ _id: 'AHM-TEST-4', status: 'IN PROCESS' }),
    ]);
    assert.deepEqual(parallel.map((res) => res.status), [200, 200]);
    assert.equal((await groupOf(thirdId)).status, 'out-for-delivery');
    // Staff cancel is refused once the courier is underway — it goes through the webhook.
    assert.equal(
      await errorOf(() => carriers.carrierCancel(thirdId, {}, keToanCtx)),
      'CARRIER_BOOKING_FAILED',
    );
    assert.equal((await push({ _id: 'AHM-TEST-4', status: 'FAILED', sub_status: 'RECIPIENT_REFUSED' })).status, 200);
    const thirdLeg = await legOf(thirdGroup.id);
    assert.equal(thirdLeg.status, 'failed');
    assert.equal(thirdLeg.carrierStatus, 'FAILED');
    assert.equal(thirdLeg.metadata.lastFailure.reasonCode, 'carrier-failed');
    assert.equal(thirdLeg.metadata.carrierTrips.length, 1);
    assert.equal((await groupOf(thirdId)).status, 'failed');

    // ── Paid by transfer after a COD trip was booked: delivered, flagged for refund ──
    const fourth = await place();
    const fourthId = fourth.order.order.id;
    const fourthGroup = fourth.order.groups[0];
    await readyUp(fourthId, fourthGroup.id);
    const fourthTrip = await carriers.carrierBook(fourthId, {}, keToanCtx);
    const transfer = await paymentService.createPayment({ orderId: fourthId, providerCode: 'test' }, systemCtx);
    await paymentService.capturePayment(
      { paymentId: transfer.id, amount: transfer.requestedAmount, providerTransactionId: `transfer:${fourthId}` },
      systemCtx,
    );
    await push({ _id: fourthTrip.carrierRef, status: 'IN PROCESS' });
    assert.equal((await push({ _id: fourthTrip.carrierRef, status: 'COMPLETED' })).status, 200);
    const fourthLeg = await legOf(fourthGroup.id);
    assert.equal(fourthLeg.status, 'delivered');
    assert.equal(fourthLeg.metadata.codConflict.codAmount, 145000, 'possible double collection is flagged');
    // The normal COD flow (cash at the door) is not flagged.
    assert.equal((await legOf(codGroup.id)).metadata.codConflict, undefined);
    console.log('[ordering-test] ahamove review fixes: no 0,0 coords, COD blocks wallet, parallel pushes, COD conflict flag');

    console.log(
      '[ordering-test] ahamove quote/book idempotent, webhook flow + COD gate, cancel/re-book, fallback',
    );
  });
} finally {
  fake.server.close();
}
