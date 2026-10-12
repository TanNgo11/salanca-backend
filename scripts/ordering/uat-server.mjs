// Manual UAT server on its own loopback database (salanca_ordering_uat): resets the plugin
// tables, seeds two branches (24/7 pickup, short lead time), a small real catalog and two staff
// users (Q1 staff, chain manager), then keeps Strapi running until Ctrl+C. Q1 stays cash
// pay-on-pickup and also delivers inside the test commune catalog (XT01001–XT01003) for the
// "Đơn giao" board UAT. Q3 is pickup prepay with the test SePay provider so the payment link and
// review screens can open. Emails are captured in memory (test builtins), captcha accepts the
// token "pass". Never run against the dev or production database. Real SePay transfers are not
// seeded. The dedicated database exists so a long UAT session is never truncated by
// scripts/ordering/run-all.mjs, which resets the shared salanca_ordering_test database.
//
// O6 extras seed the ops screens: today's cash collections across two collectors plus a
// partial cash refund (Chốt tiền), two 01:30 orders landing on yesterday's business date
// (Báo cáo), an unpaid sepay order and a test-provider paid order at Q3 (Báo cáo theo cách
// trả, Duyệt chuyển khoản), a failed outbox row, a 200-day-old sepay event for the retention
// job's "Chạy ngay", and open alerts via ops-check + payment-unmatched. Extra staff:
// giao-q1 (courier), quanly-q1 (every action except ops.read), ketoan (reports + export).
// Test accounts print to the console at boot; the shared password only lands in
// UAT_CRED_FILE when that env var points somewhere outside the repo.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';

process.env.PORT = process.env.UAT_PORT ?? '1350';
process.env.ORDERING_TEST_DATABASE ??= 'salanca_ordering_uat';
const { bootOrderingTestApp, resetOrderingTables, seedBranches, systemCtx, TEST_DATABASE, ORDERING_ACTIONS } =
  await import('./_harness.mjs');
const app = await bootOrderingTestApp();
await resetOrderingTables(app);
await seedBranches(app);
app.config.set('plugin::ordering.catalog.adapter', 'ordering-catalog');

const branches = app.db.query('plugin::ordering.branch');
for (const code of ['Q1', 'Q3']) {
  const row = await branches.findOne({ where: { code } });
  const prepay = code === 'Q3';
  await branches.update({
    where: { id: row.id },
    data: {
      email: `${code.toLowerCase()}@example.invalid`,
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: prepay ? 'prepay' : 'pay-on-pickup',
          // 'test' stays alongside sepay so the UAT can seed one order paid off-webhook.
          paymentProviders: prepay ? ['sepay', 'test'] : ['cash'],
          ...(prepay ? { paymentTimeoutMinutes: 15 } : {}),
          slaMinutes: 10,
          schedule: { leadTimeMinutes: 30, slotLengthMinutes: 30, capacity: 4, openingHours: { mode: '24_7' } },
        },
        // Q1 also self-delivers so the delivery board has real legs to drive.
        ...(code === 'Q1'
          ? {
              delivery: {
                enabled: true,
                orderTiming: 'both',
                paymentTiming: 'pay-on-pickup',
                paymentProviders: ['cash'],
                minOrderAmount: 0,
                schedule: {
                  leadTimeMinutes: 60,
                  slotLengthMinutes: 30,
                  capacity: 4,
                  openingHours: { mode: '24_7' },
                },
                zones: [
                  {
                    code: 'near',
                    label: 'Vùng gần (test)',
                    priority: 10,
                    match: { kind: 'commune', communeCodes: ['XT01001', 'XT01002', 'XT01003'] },
                    rules: [
                      { when: 'subtotal-lt', subtotal: 200000, fee: 15000 },
                      { when: 'any', fee: 0 },
                    ],
                    minOrderAmount: 0,
                    extraLeadTimeMinutes: 30,
                  },
                ],
              },
            }
          : {}),
      },
    },
  });
}

const doc = (uid) => app.documents(`plugin::ordering.${uid}`);
const mains = await doc('catalog-category').create({ data: { name: { vi: 'Món chính', en: 'Mains' }, rank: 0 } });
const drinks = await doc('catalog-category').create({ data: { name: { vi: 'Đồ uống', en: 'Drinks' }, rank: 1 } });
const product = async (name, category, amount) => {
  const created = await doc('catalog-product').create({
    data: { productType: 'food', status: 'active', sellOnline: true, fulfillmentKinds: ['pickup', 'delivery'], name, categories: [category.documentId] },
  });
  const variant = await doc('catalog-variant').create({
    data: { product: created.documentId, isDefault: true, rank: 0, name: { vi: 'Thường' } },
  });
  await doc('catalog-price').create({ data: { variant: variant.documentId, amount, currency: 'VND' } });
  return created;
};
const bunBo = await product({ vi: 'Bún bò Huế', en: 'Hue beef noodle' }, mains, 100000);
await product({ vi: 'Combo trưa 1 người', en: 'Lunch combo' }, mains, 99000);
await product({ vi: 'Trà đào cam sả', en: 'Peach tea' }, drinks, 45000);
const topping = await doc('catalog-modifier-group').create({ data: { name: { vi: 'Topping', en: 'Toppings' }, selectionType: 'multiple', rank: 0 } });
await doc('catalog-modifier').create({ data: { name: { vi: 'Chả cua', en: 'Crab cake' }, priceDelta: 15000, group: topping.documentId, rank: 0 } });
await doc('catalog-product').update({
  documentId: bunBo.documentId,
  data: { modifierGroups: [{ groupRef: topping.documentId, required: false, min: 0, max: 2, freeQuantity: 0, rank: 0, overrides: {} }] },
});

// Staff: a non-super-admin role with every order action; Q1 staff and a chain manager.
const role = await app.admin.services.role.create({ name: `UAT ordering ${randomUUID().slice(0, 6)}`, description: 'ordering UAT' });
const actions = [
  'order.read', 'order.process', 'order.cancel', 'order.create', 'order.edit-lines', 'payment.record-cash',
  'payment.review', 'refund.manage', 'settings.manage', 'scope.manage', 'catalog.toggle-availability',
];
await app.admin.services.role.assignPermissions(
  role.id,
  actions.map((action) => ({ action: `plugin::ordering.${action}`, subject: null, properties: {}, conditions: [] })),
);
const password = `Uat-${randomUUID().slice(0, 8)}-Aa1`;
const accounts = [];
const scopeService = app.plugin('ordering').service('scope');
let lanUser;
for (const [name, scope] of [
  ['lan-q1', { allLocations: false, locationRefs: ['Q1'] }],
  ['quan-ly-chuoi', { allLocations: true, locationRefs: [] }],
]) {
  const email = `uat-${name}-${randomUUID().slice(0, 4)}@example.invalid`;
  const user = await app.admin.services.user.create({
    firstname: name, lastname: 'UAT', email, password, isActive: true, registrationToken: null, roles: [role.id],
  });
  await app.db.query('plugin::ordering.staff-location-scope').create({ data: { adminUserId: user.id, ...scope } });
  accounts.push({ name, email });
  if (name === 'lan-q1') lanUser = user;
}

// Sample orders so the boards are not empty: one pickup awaiting acceptance, one delivery ready to
// dispatch and one already out with lan-q1. All go through the same services the API uses.
const ordering = app.plugin('ordering');
const orders = ordering.service('order');
const transitions = ordering.service('transition');
const adminOrders = ordering.service('admin-orders');
const input = (overrides) => ({
  idempotencyKey: randomUUID(),
  locationRef: 'Q1',
  locale: 'vi',
  lines: [{ sellableUid: bunBo.documentId, quantity: 2 }],
  receiveMethod: { kind: 'pickup' },
  contact: { name: 'Khách UAT', phone: '+84900000099' },
  consent: { policyVersion: 'v1', channel: 'web-checkout' },
  origin: { kind: 'storefront' },
  ...overrides,
});
const deliveryAddress = {
  communeCode: 'XT01002',
  line1: '12 Đường Bí Mật',
  recipientName: 'Khách UAT',
  phone: '0901234567',
};
const advance = async (orderId, groupId, states) => {
  for (const to of states) {
    await transitions.transitionGroup({ orderId, groupId, to }, systemCtx);
  }
};
// Pickup order left at awaiting-acceptance so the new-order dialog has something to ring about.
await orders.createOrder(input({}), systemCtx);
const deliveryReady = await orders.createOrder(
  input({ receiveMethod: { kind: 'delivery', address: deliveryAddress } }),
  systemCtx,
);
await advance(deliveryReady.order.order.id, deliveryReady.order.groups[0].id, ['preparing', 'ready']);
const deliveryOut = await orders.createOrder(
  input({ receiveMethod: { kind: 'delivery', address: { ...deliveryAddress, line1: '8 Ngõ Thử' } } }),
  systemCtx,
);
await advance(deliveryOut.order.order.id, deliveryOut.order.groups[0].id, ['preparing', 'ready']);
const lanCtx = { actor: await scopeService.actorFromAdminUser(lanUser) };
await adminOrders.transition(
  deliveryOut.order.order.id,
  { to: 'out-for-delivery', assigneeRef: `admin:${lanUser.id}` },
  lanCtx,
);

// ── O6 UAT extras ──────────────────────────────────────────────────────────────
// Extra staff: a Q1 courier, a Q1 manager (every action except ops.read) and a chain
// accountant (reports + export). One role per permission set so the seed is honest.
const roleWith = async (name, actions) => {
  const created = await app.admin.services.role.create({
    name: `UAT ${name} ${randomUUID().slice(0, 6)}`,
    description: 'ordering UAT',
  });
  await app.admin.services.role.assignPermissions(
    created.id,
    actions.map((action) => ({
      action: `plugin::ordering.${action}`,
      subject: null,
      properties: {},
      conditions: [],
    })),
  );
  return created;
};
const courierRole = await roleWith('courier', ['order.read', 'order.process', 'payment.record-cash']);
const managerRole = await roleWith(
  'manager',
  ORDERING_ACTIONS.filter((action) => action !== 'ops.read'),
);
const accountantRole = await roleWith('accountant', [
  'order.read',
  'payment.review',
  'refund.manage',
  'payment.raw-read',
  'report.read',
  'export',
]);
const makeUser = async (name, roleId, scope) => {
  const email = `uat-${name}-${randomUUID().slice(0, 4)}@example.invalid`;
  const user = await app.admin.services.user.create({
    firstname: name,
    lastname: 'UAT',
    email,
    password,
    isActive: true,
    registrationToken: null,
    roles: [roleId],
  });
  await app.db.query('plugin::ordering.staff-location-scope').create({ data: { adminUserId: user.id, ...scope } });
  accounts.push({ name, email });
  return user;
};
const giaoUser = await makeUser('giao-q1', courierRole.id, { allLocations: false, locationRefs: ['Q1'] });
await makeUser('quanly-q1', managerRole.id, { allLocations: false, locationRefs: ['Q1'] });
await makeUser('ketoan', accountantRole.id, { allLocations: true, locationRefs: [] });
const giaoCtx = { actor: await scopeService.actorFromAdminUser(giaoUser) };

// Today's business date at Q1: three cash pickups collected by lan-q1 (one partially
// refunded), one delivery collected by giao-q1 — the cash-closing screen gets two
// collectors and a refund line. All through the same services the API uses.
const handoverPickup = async (overrides) => {
  const placed = await orders.createOrder(input(overrides), systemCtx);
  const id = placed.order.order.id;
  await advance(id, placed.order.groups[0].id, ['preparing', 'ready']);
  await adminOrders.cashHandover(id, {}, lanCtx);
  return id;
};
const refunded = await handoverPickup({});
await adminOrders.refundOrder(
  refunded,
  { method: 'cash', amount: 20000, reason: 'khách đổi ý, trả lại một phần' },
  lanCtx,
);
await handoverPickup({});
await handoverPickup({ contact: { name: 'Khách UAT 2', phone: '+84900000098' } });
const deliveryCollect = await orders.createOrder(
  input({ receiveMethod: { kind: 'delivery', address: { ...deliveryAddress, line1: '21 Hẻm Gần' } } }),
  systemCtx,
);
await advance(deliveryCollect.order.order.id, deliveryCollect.order.groups[0].id, ['preparing', 'ready']);
await adminOrders.transition(
  deliveryCollect.order.order.id,
  { to: 'out-for-delivery', assigneeRef: `admin:${giaoUser.id}` },
  lanCtx,
);
await adminOrders.cashHandover(deliveryCollect.order.order.id, {}, giaoCtx);

// Two orders placed at 01:30 today belong to yesterday's business date (04:00 cutoff) —
// the sales report gets two days and the cash-closing screen two business dates.
const todayVN = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
await handoverPickup({ placedAt: `${todayVN}T01:30:00+07:00` });
await handoverPickup({ placedAt: `${todayVN}T01:32:00+07:00` });

// Q3 prepay: one sepay order left unpaid (payment link + review screens), one order paid
// through the test provider so the payment report has a second provider row.
await orders.createOrder(
  input({ locationRef: 'Q3', payment: { providerCode: 'sepay' } }),
  systemCtx,
);
const testPaid = await orders.createOrder(
  input({ locationRef: 'Q3', payment: { providerCode: 'test' } }),
  systemCtx,
);
const testPaymentRow = await ordering.service('payment').createPayment(
  { orderId: testPaid.order.order.id, providerCode: 'test' },
  systemCtx,
);
await ordering.service('payment').capturePayment(
  {
    paymentId: testPaymentRow.id,
    amount: testPaymentRow.requestedAmount,
    providerTransactionId: `uat-test-${randomUUID().slice(0, 8)}`,
  },
  systemCtx,
);

// Ops-board data: a failed outbox row (attempts exhausted → the Lỗi tab and the
// outbox-stuck alert), a 200-day-old sepay event with personal fields (the retention
// job's "Chạy ngay" redaction demo), then one ops-check pass and one unmatched alert.
await app.db.query('plugin::ordering.outbox').create({
  data: {
    type: 'test.fail',
    aggregateType: 'test',
    aggregateId: randomUUID(),
    payload: {},
    uniqueKey: `uat-fail-${randomUUID()}`,
    occurredAt: new Date(Date.now() - 60 * 60 * 1000),
    availableAt: new Date(Date.now() - 60 * 60 * 1000),
    attempts: 10,
    failedAt: new Date(Date.now() - 30 * 60 * 1000),
    lastError: 'test.fail consumer always throws (UAT fixture)',
  },
});
await app.db.query('plugin::ordering.payment-event').create({
  data: {
    providerCode: 'sepay',
    providerTransactionId: `uat-old-${randomUUID().slice(0, 8)}`,
    transferType: 'in',
    amount: '175000',
    currency: 'VND',
    kind: 'webhook',
    receivedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
    rawPayload: {
      id: 'uat-old-1',
      transferAmount: 175000,
      transferType: 'in',
      referenceCode: 'FT-UAT-OLD',
      transactionDate: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
      content: 'NGUYEN VAN A ck SLC-000001',
      accountNumber: '0123456789',
      description: 'cu',
    },
    reviewStatus: 'auto-matched',
  },
});
await ordering.service('ops-status').runJob('ops-check', {
  actor: { kind: 'system', actorRef: 'uat-seed' },
  now: new Date(),
});
await ordering.service('alert').noteUnmatched('sepay', {
  actor: { kind: 'system', actorRef: 'job:sepay-reconciliation' },
  now: new Date(),
});

// Credentials stay in a local file outside the repo; never printed.
const credFile = process.env.UAT_CRED_FILE;
if (credFile) writeFileSync(credFile, JSON.stringify({ password, accounts }, null, 2));

// ORDERING_TEST_BUILTINS turns cron off so integration scripts dispatch by hand. This server
// still has to deliver captured emails, so it pumps the outbox itself (same service the cron uses).
const dispatcherOwner = `uat:${hostname()}:${process.pid}`;
const pumpOutbox = () =>
  app
    .plugin('ordering')
    .service('outbox')
    .dispatch({ owner: dispatcherOwner })
    .catch((error) => {
      console.error('[ordering-uat] outbox dispatch failed:', error?.message ?? error);
    });
setInterval(pumpOutbox, 2000);
await pumpOutbox();

await app.listen();
console.log(`[ordering-uat] ready on http://127.0.0.1:${process.env.PORT}/admin (${TEST_DATABASE})`);
console.log('[ordering-uat] test accounts (password is written to UAT_CRED_FILE when set):');
for (const account of accounts) {
  console.log(`  ${account.name.padEnd(16)} ${account.email}`);
}
