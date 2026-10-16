// Core-sales provider boundary regression: a provider may accept a carrier booking before the
// local DB can persist its reference. The durable operation must block a blind retry.
import assert from 'node:assert/strict';

import {
  basicOrderInput,
  seedAdminHttpStaff,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

await withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  await app.listen();
  // The Ops board settles a stuck operation through its own HTTP route under `ops.read`.
  const opsStaff = await seedAdminHttpStaff(app, {
    actions: ['ops.read'],
    scopes: { opsuser: { allLocations: true, locationRefs: [] } },
  });
  const { order, payment, registry, transition } = services(app);
  const providerTrips = [];
  const providerCancels = [];
  registry.registerFulfillmentProvider({
    code: 'recovery-carrier',
    capabilities: ['delivery'],
    getOptions: async () => [],
    validate: async () => ({ valid: true }),
    calculatePrice: async () => ({ amount: 15000, currency: 'VND' }),
    create: async () => ({}),
    book: async ({ idempotencyKey }) => {
      const carrierRef = `RECOVERY-TRIP-${providerTrips.length + 1}`;
      providerTrips.push({ carrierRef, idempotencyKey });
      return { carrierRef, carrierStatus: 'IDLE' };
    },
    cancel: async ({ fulfillment, reason, idempotencyKey }) => {
      providerCancels.push({ carrierRef: fulfillment.providerReference, reason, idempotencyKey });
    },
  });
  registry.registerPaymentProvider({
    code: 'recovery-wallet',
    capabilities: ['wallet', 'capture'],
    webhookAckMode: 'after-processing',
    getPresentation: async () => ({}),
    initiate: async ({ metadata }) => ({
      status: 'pending',
      providerReference: metadata.reference,
      redirectUrl: 'https://example.invalid/recovery-wallet',
    }),
    parseWebhook: async () => [],
    webhookResponse: () => ({ status: 200, body: {} }),
    queryTransaction: async () => ({ outcome: 'pending' }),
  });

  await app.db.query('plugin::ordering.branch').create({
    data: {
      code: 'RC1',
      name: { vi: 'Provider recovery', en: 'Provider recovery' },
      timezone: 'Asia/Ho_Chi_Minh',
      isActive: true,
      onlineOrdering: true,
      rank: 0,
      address: { line1: '1 Test Street' },
      fulfillment: {
        delivery: {
          enabled: true,
          orderTiming: 'both',
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash', 'recovery-wallet'],
          carrier: 'recovery-carrier',
          zones: [
            {
              code: 'near',
              label: 'Near',
              priority: 10,
              match: { kind: 'commune', communeCodes: ['XT01002'] },
              rules: [{ when: 'any', fee: 15000 }],
            },
          ],
          schedule: {
            leadTimeMinutes: 60,
            slotLengthMinutes: 15,
            capacity: 8,
            openingHours: { mode: '24_7' },
          },
        },
      },
    },
  });

  const placed = await order.createOrder(
    basicOrderInput({
      locationRef: 'RC1',
      adjustments: [],
      lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
      receiveMethod: {
        kind: 'delivery',
        address: {
          communeCode: 'XT01002',
          line1: '2 Test Street',
          recipientName: 'Test',
          phone: '0901234567',
        },
      },
    }),
    systemCtx,
  );
  const orderId = placed.order.order.id;
  const groupId = placed.order.groups[0].id;
  await transition.transitionGroup({ orderId, groupId, to: 'preparing' }, systemCtx);
  await transition.transitionGroup({ orderId, groupId, to: 'ready' }, systemCtx);

  const carrier = app.plugin('ordering').service('carrier-assignment');
  const fulfillmentQuery = app.db.query('plugin::ordering.fulfillment');
  const originalUpdate = fulfillmentQuery.update.bind(fulfillmentQuery);
  let failPersistOnce = true;
  fulfillmentQuery.update = async (params) => {
    if (failPersistOnce && params?.data?.providerReference) {
      failPersistOnce = false;
      throw new Error('RECOVERY_DB_WRITE_FAILED_AFTER_PROVIDER_BOOK');
    }
    return originalUpdate(params);
  };
  let firstError;
  try {
    firstError = await carrier.carrierBook(orderId, {}, systemCtx).then(
      () => null,
      (error) => error,
    );
  } finally {
    fulfillmentQuery.update = originalUpdate;
  }
  assert.equal(firstError?.message, 'RECOVERY_DB_WRITE_FAILED_AFTER_PROVIDER_BOOK');
  assert.equal(providerTrips.length, 1, 'the provider accepted exactly one booking');
  assert.match(providerTrips[0].idempotencyKey, /^carrier-book:/);

  const afterFailure = await fulfillmentQuery.findOne({ where: { order: orderId } });
  assert.equal(afterFailure.providerReference, null);
  const operation = await app.db.query('plugin::ordering.provider-operation').findOne({
    where: { orderId, kind: 'carrier-book' },
  });
  assert.equal(operation.state, 'unknown');
  assert.equal(operation.lastErrorCode, 'provider-result-not-persisted');

  const retryError = await carrier.carrierBook(orderId, {}, systemCtx).then(
    () => null,
    (error) => error,
  );
  assert.equal(retryError?.code, 'CARRIER_BOOKING_FAILED');
  assert.equal(retryError?.details?.reason, 'booking-unknown');
  assert.equal(retryError?.details?.operationKey, operation.operationKey);
  assert.equal(providerTrips.length, 1, 'retry must not create a second provider trip');

  const walletError = await payment
    .createWalletSession({ orderId, providerCode: 'recovery-wallet' }, systemCtx)
    .then(() => null, (error) => error);
  assert.equal(walletError?.code, 'VALIDATION_ERROR');
  assert.equal(walletError?.details?.reason, 'cod-trip-booking-in-progress');

  // Staff reconcile straight from the Ops board: the route locates the operation by its key and
  // delegates to the same carrier service the order detail uses.
  const reconciled = await opsStaff.as.opsuser(
    'POST',
    `/ops/carrier/${encodeURIComponent(operation.operationKey)}/reconcile`,
    {
      outcome: 'booked',
      carrierRef: providerTrips[0].carrierRef,
      carrierStatus: 'IDLE',
      reason: 'verified in provider dashboard',
    },
  );
  assert.equal(reconciled.status, 200, 'the ops board reconciles an unknown carrier booking');
  assert.equal(reconciled.body.outcome, 'booked');
  assert.equal(reconciled.body.carrierRef, 'RECOVERY-TRIP-1');
  assert.equal(
    (await fulfillmentQuery.findOne({ where: { order: orderId } })).providerReference,
    'RECOVERY-TRIP-1',
  );
  assert.equal(
    (await app.db.query('plugin::ordering.provider-operation').findOne({ where: { id: operation.id } })).state,
    'succeeded',
  );
  const replay = await carrier.carrierBook(orderId, {}, systemCtx);
  assert.equal(replay.alreadyBooked, true);
  assert.equal(replay.carrierRef, 'RECOVERY-TRIP-1');
  assert.equal(providerTrips.length, 1, 'reconciled trip remains idempotent');

  // Cancellation crosses the same boundary: the carrier accepted the cancel but the local commit
  // was lost, so the trip must stay attached and a retry must not call the carrier again.
  const providerOperationQuery = app.db.query('plugin::ordering.provider-operation');
  const alertQuery = app.db.query('plugin::ordering.ops-alert');
  let failCancelPersistOnce = true;
  fulfillmentQuery.update = async (params) => {
    if (failCancelPersistOnce && params?.data?.providerReference === null) {
      failCancelPersistOnce = false;
      throw new Error('RECOVERY_DB_WRITE_FAILED_AFTER_PROVIDER_CANCEL');
    }
    return originalUpdate(params);
  };
  let cancelError;
  try {
    cancelError = await carrier.carrierCancel(orderId, { reason: 'test' }, systemCtx).then(
      () => null,
      (error) => error,
    );
  } finally {
    fulfillmentQuery.update = originalUpdate;
  }
  assert.equal(cancelError?.message, 'RECOVERY_DB_WRITE_FAILED_AFTER_PROVIDER_CANCEL');
  assert.equal(providerCancels.length, 1, 'the carrier accepted exactly one cancellation');
  assert.match(providerCancels[0].idempotencyKey, /^carrier-cancel:/);
  assert.equal(providerCancels[0].carrierRef, 'RECOVERY-TRIP-1');
  assert.equal(
    (await fulfillmentQuery.findOne({ where: { order: orderId } })).providerReference,
    'RECOVERY-TRIP-1',
    'the trip stays attached until the cancellation is confirmed',
  );
  const cancelOperation = await providerOperationQuery.findOne({
    where: { orderId, kind: 'carrier-cancel' },
  });
  assert.equal(cancelOperation.state, 'unknown');
  assert.equal(cancelOperation.lastErrorCode, 'provider-result-not-persisted');

  // The uncertain cancellation pages Ops (critical) and blocks any blind retry.
  const cancelAlerts = await alertQuery.findMany({
    where: { alertCode: 'carrier-operation-unknown' },
  });
  assert.equal(cancelAlerts.length, 2, 'one alert per unresolved operation');
  const bookAlert = cancelAlerts.find(
    (row) => row.dedupeKey === `carrier-operation-unknown:${operation.operationKey}`,
  );
  assert.equal(bookAlert?.status, 'resolved', 'reconciling the booking closed its own alert');
  const cancelAlert = cancelAlerts.find(
    (row) => row.dedupeKey === `carrier-operation-unknown:${cancelOperation.operationKey}`,
  );
  assert.ok(cancelAlert, 'the cancellation has its own alert');
  assert.equal(cancelAlert.severity, 'critical');
  assert.equal(cancelAlert.status, 'open');

  const retryCancel = await carrier.carrierCancel(orderId, {}, systemCtx).then(
    () => null,
    (error) => error,
  );
  assert.equal(retryCancel?.code, 'CARRIER_BOOKING_FAILED');
  assert.equal(retryCancel?.details?.reason, 'cancel-unknown');
  assert.equal(retryCancel?.details?.operationKey, cancelOperation.operationKey);
  assert.equal(providerCancels.length, 1, 'retry must not cancel a second time');

  // Reconcile outcome vocabulary follows the operation kind: a booking outcome is refused.
  const wrongOutcome = await carrier
    .carrierReconcile(
      orderId,
      {
        operationKey: cancelOperation.operationKey,
        outcome: 'booked',
        carrierRef: 'RECOVERY-TRIP-1',
        reason: 'wrong vocabulary',
      },
      systemCtx,
    )
    .then(() => null, (error) => error);
  assert.equal(wrongOutcome?.code, 'VALIDATION_ERROR');
  assert.equal(wrongOutcome?.details?.reason, 'reconcile-kind-mismatch');

  // Staff check the carrier dashboard: the trip is still alive, so the guard is released and the
  // alert closes — the cancellation can be attempted again.
  const stillBooked = await carrier.carrierReconcile(
    orderId,
    {
      operationKey: cancelOperation.operationKey,
      outcome: 'still-booked',
      reason: 'trip still active in carrier dashboard',
    },
    systemCtx,
  );
  assert.equal(stillBooked.outcome, 'still-booked');
  assert.equal(
    (await providerOperationQuery.findOne({ where: { id: cancelOperation.id } })).state,
    'resolved',
  );
  assert.equal(
    (await alertQuery.findOne({ where: { id: cancelAlert.id } })).status,
    'resolved',
  );

  const cancelled = await carrier.carrierCancel(
    orderId,
    { reason: 'customer changed their mind' },
    systemCtx,
  );
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.carrierRef, 'RECOVERY-TRIP-1');
  assert.equal(providerCancels.length, 2, 'the guard released allows exactly one new cancellation');
  const afterCancel = await fulfillmentQuery.findOne({ where: { order: orderId } });
  assert.equal(afterCancel.providerReference, null);
  assert.equal(afterCancel.carrierStatus, null);
  assert.match(JSON.stringify(afterCancel.metadata.carrierTrips), /"carrierStatus":"CANCELLED"/);
  assert.equal(
    (await providerOperationQuery.findOne({
      where: { orderId, kind: 'carrier-cancel', state: 'succeeded' },
    })).providerReference,
    'RECOVERY-TRIP-1',
  );
  // No live reference, so cancelling again is a no-op rather than another provider call.
  assert.deepEqual(
    await carrier.carrierCancel(orderId, {}, systemCtx),
    { cancelled: false },
    'a leg without a trip is not cancelled twice',
  );
  assert.equal(providerCancels.length, 2);

  await opsStaff.cleanup();

  console.log(
    '[ordering-test] carrier DB failure blocks retry; verified trip reconciles without re-booking',
  );
  console.log(
    '[ordering-test] carrier cancel is durable: unknown blocks retry, alert opens and closes, reconcile releases the guard',
  );
});
