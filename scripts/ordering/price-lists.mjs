// O14: channel, customer-group and time-window prices on the ordering catalog.
// Quote and create match. A guest with a grouped phone still pays the regular price.
// A promotion discounts the price-list amount. A session catalog response is private.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { basicOrderInput, seedAdminHttpStaff, seedBranches, services, systemCtx, withApp } from './_harness.mjs';

const HAPPY = '2026-10-13T08:00:00.000Z';
const MORNING = '2026-10-13T04:30:00.000Z';
const PHONE = '+84908880014';

withApp(async (app) => {
  await seedBranches(app);
  const branches = app.db.query('plugin::ordering.branch');
  const q1 = await branches.findOne({ where: { code: 'Q1' } });
  await branches.update({
    where: { id: q1.id },
    data: {
      fulfillment: {
        ...q1.fulfillment,
        delivery: {
          enabled: true,
          orderTiming: 'both',
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          minOrderAmount: 0,
          schedule: { leadTimeMinutes: 0, slotLengthMinutes: 15, capacity: 20, openingHours: { mode: '24_7' } },
          zones: [
            {
              code: 'near',
              label: 'Gần',
              priority: 1,
              match: { kind: 'commune', communeCodes: ['XT01002'] },
              rules: [{ when: 'any', fee: 0 }],
              minOrderAmount: 0,
              extraLeadTimeMinutes: 0,
            },
          ],
        },
      },
    },
  });

  app.config.set('plugin::ordering.catalog.adapter', 'ordering-catalog');
  const doc = (name) => app.documents(`plugin::ordering.${name}`);
  const drinks = await doc('catalog-category').create({ data: { name: { vi: 'Đồ uống' }, rank: 0 } });
  const tea = await doc('catalog-product').create({
    data: {
      productType: 'food',
      status: 'active',
      sellOnline: true,
      fulfillmentKinds: ['pickup', 'delivery'],
      name: { vi: 'Trà đào' },
      categories: [drinks.documentId],
    },
  });
  const variant = await doc('catalog-variant').create({
    data: { product: tea.documentId, isDefault: true, rank: 0, name: { vi: 'Ly' }, sku: 'O14-TEA' },
  });
  await doc('catalog-price').create({ data: { variant: variant.documentId, amount: 45000, currency: 'VND' } });

  const { order } = services(app);
  const lists = app.plugin('ordering').service('price-list');
  const groups = app.plugin('ordering').service('customer-group');
  const customers = app.plugin('ordering').service('customer');
  const address = {
    recipientName: 'Khách O14',
    phone: '0908880014',
    line1: '1 Đường Giá',
    wardCode: 'XT01002',
    communeCode: 'XT01002',
  };
  const draft = (extra = {}) =>
    basicOrderInput({
      lines: [{ sellableUid: tea.documentId, quantity: 1 }],
      adjustments: [],
      contact: { name: 'Khách O14', phone: PHONE },
      ...extra,
    });
  const unit = (quoted) => quoted.lines[0].unitAmount;

  const morning = await order.quote(draft({ placedAt: MORNING }), systemCtx);
  assert.equal(unit(morning), 45000, 'base price before any list');

  const deliveryList = await lists.create(
    {
      name: { vi: 'Giá giao' },
      kind: 'override',
      rules: { channels: ['delivery'], locationRefs: ['Q1'], customerGroups: [], weekdays: [], timeRanges: [] },
      lines: [{ variantId: variant.documentId, amount: 39000 }],
      priority: 5,
      active: true,
    },
    systemCtx,
  );
  const delivered = await order.quote(
    draft({ placedAt: MORNING, receiveMethod: { kind: 'delivery', address } }),
    systemCtx,
  );
  assert.equal(unit(delivered), 39000, 'delivery channel price');
  const picked = await order.quote(draft({ placedAt: MORNING }), systemCtx);
  assert.equal(unit(picked), 45000, 'pickup keeps the base price');
  const createdDelivery = await order.createOrder(
    draft({
      idempotencyKey: randomUUID(),
      placedAt: MORNING,
      receiveMethod: { kind: 'delivery', address },
    }),
    systemCtx,
  );
  assert.equal(createdDelivery.order.lines[0].unitAmount, unit(delivered));
  assert.equal(Number(createdDelivery.order.order.totalAmount), delivered.totals.grandTotal);

  await lists.setActive(deliveryList.item.id, false, systemCtx);
  const afterOff = await order.quote(
    draft({ placedAt: MORNING, receiveMethod: { kind: 'delivery', address } }),
    systemCtx,
  );
  assert.equal(unit(afterOff), 45000, 'an inactive list falls back to the base price');

  const happy = await lists.create(
    {
      name: { vi: 'Happy hour' },
      kind: 'adjust',
      rules: {
        channels: ['pickup'],
        locationRefs: [],
        customerGroups: [],
        weekdays: ['tue'],
        timeRanges: [{ start: '14:00', end: '17:00' }],
      },
      adjust: { type: 'percent', value: 20, target: { kind: 'products', refs: [tea.documentId] } },
      lines: [],
      priority: 10,
      active: true,
    },
    systemCtx,
  );
  const happyQuote = await order.quote(draft({ placedAt: HAPPY }), systemCtx);
  assert.equal(unit(happyQuote), 36000, '20% of 45.000 during happy hour');
  const outside = await order.quote(draft({ placedAt: MORNING }), systemCtx);
  assert.equal(unit(outside), 45000, 'happy hour does not apply at 11:30');
  const happyOrder = await order.createOrder(draft({ idempotencyKey: randomUUID(), placedAt: HAPPY }), systemCtx);
  assert.equal(happyOrder.order.lines[0].unitAmount, 36000);
  assert.equal(Number(happyOrder.order.order.totalAmount), happyQuote.totals.grandTotal);

  await app.db.query('plugin::ordering.promotion').create({
    data: {
      name: { vi: 'Giảm 10%' },
      kind: 'code',
      discountType: 'percent',
      value: 10,
      target: { kind: 'products', refs: [tea.documentId] },
      minSubtotal: 0,
      locationRefs: ['Q1'],
      receiveKinds: ['pickup'],
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-12-01T00:00:00.000Z',
      weekdays: [],
      timeRanges: [],
      firstOrderOnly: false,
      priority: 1,
      active: true,
      usedCount: 0,
    },
  }).then(async (row) => {
    await app.db.query('plugin::ordering.promotion-code').create({
      data: { promotionId: row.id, code: 'O14HAPPY', usageLimit: null, usedCount: 0, active: true },
    });
  });
  const promo = await order.quote(draft({ placedAt: HAPPY, promotionCode: 'O14HAPPY' }), systemCtx);
  assert.equal(unit(promo), 36000, 'the line keeps the happy-hour price');
  assert.equal(promo.totals.grandTotal, 32400, '10% of the happy-hour price, not the menu price');
  const promoOrder = await order.createOrder(
    draft({ idempotencyKey: randomUUID(), placedAt: HAPPY, promotionCode: 'O14HAPPY' }),
    systemCtx,
  );
  assert.equal(Number(promoOrder.order.order.totalAmount), 32400);

  const floor = await lists.create(
    {
      name: { vi: 'Giảm quá tay' },
      kind: 'adjust',
      rules: { channels: ['pickup'], locationRefs: [], customerGroups: [], weekdays: [], timeRanges: [] },
      adjust: { type: 'amount', value: 100000, target: { kind: 'all', refs: [] } },
      lines: [],
      priority: 50,
      active: true,
    },
    systemCtx,
  );
  const floored = await order.quote(draft({ placedAt: MORNING }), systemCtx);
  assert.equal(unit(floored), 0, 'a discount never goes below zero');
  await lists.setActive(floor.item.id, false, systemCtx);
  await lists.setActive(happy.item.id, false, systemCtx);

  const customerId = await customers.linkForOrder({ phoneE164: PHONE });
  const profile = await app.db.query('plugin::ordering.customer').findOne({ where: { id: customerId } });
  await app.db.query('plugin::ordering.customer').update({
    where: { id: customerId },
    data: { name: 'Khách nhóm', status: 'verified', orderCount: 3, totalSpent: '200000' },
  });
  const vip = await groups.create(
    { code: 'vip', name: { vi: 'VIP' }, active: true, auto: null },
    systemCtx,
  );
  await assert.rejects(
    groups.create({ code: 'vip', name: { vi: 'VIP 2' }, active: true, auto: null }, systemCtx),
    (error) => error?.details?.issues?.[0]?.path === 'code' && error.details.issues[0].code === 'taken',
    'a duplicate customer group code answers with the taken code',
  );
  await groups.setMembers(vip.item.id, { add: [profile.documentId], remove: [] }, systemCtx);
  await lists.create(
    {
      name: { vi: 'Giá VIP' },
      kind: 'override',
      rules: {
        channels: ['pickup', 'staff'],
        locationRefs: ['Q1'],
        customerGroups: ['vip'],
        weekdays: [],
        timeRanges: [],
      },
      lines: [{ variantId: variant.documentId, amount: 30000 }],
      priority: 20,
      active: true,
    },
    systemCtx,
  );

  const guest = await order.quote(draft({ placedAt: MORNING }), systemCtx);
  assert.equal(unit(guest), 45000, 'a guest phone never selects a group');
  const member = await order.quote(draft({ placedAt: MORNING, customerId }), systemCtx);
  assert.equal(unit(member), 30000, 'the signed-in profile gets the group price');
  const memberOrder = await order.createOrder(
    draft({ idempotencyKey: randomUUID(), placedAt: MORNING, customerId }),
    systemCtx,
  );
  assert.equal(memberOrder.order.lines[0].unitAmount, 30000);
  assert.equal(Number(memberOrder.order.order.totalAmount), member.totals.grandTotal);

  const staffDraft = await order.createOrder(
    draft({
      idempotencyKey: randomUUID(),
      placedAt: MORNING,
      origin: { kind: 'staff-draft' },
      consent: { policyVersion: 'v1', channel: 'phone-staff' },
    }),
    systemCtx,
  );
  assert.equal(staffDraft.order.lines[0].unitAmount, 30000, 'staff draft uses the phone profile groups');

  const guestOrder = await order.createOrder(draft({ idempotencyKey: randomUUID(), placedAt: MORNING }), systemCtx);
  assert.equal(guestOrder.order.lines[0].unitAmount, 45000);
  const head = await app.db.query('plugin::ordering.order').findOne({ where: { id: guestOrder.order.order.id } });
  const edited = await app.plugin('ordering').service('order-edit').edit(
    head.id,
    { revision: Number(head.editRevision ?? 0), reason: 'thêm ly', add: [{ sellableUid: tea.documentId, quantity: 1 }] },
    systemCtx,
  );
  const lines = edited.order.lines.map((line) => line.unitAmount).sort((a, b) => a - b);
  assert.deepEqual(lines, [30000, 45000], 'a new line uses the linked profile groups; the placed line stays');

  const auto = await groups.create(
    { code: 'thuong-xuyen', name: { vi: 'Thường xuyên' }, active: true, auto: { minOrderCount: 2 } },
    systemCtx,
  );
  const quietId = await customers.linkForOrder({ phoneE164: '+84908880015' });
  const quiet = await app.db.query('plugin::ordering.customer').findOne({ where: { id: quietId } });
  await groups.setMembers(auto.item.id, { add: [quiet.documentId], remove: [] }, systemCtx);
  const refreshed = await groups.refreshAuto(new Date(HAPPY));
  assert.ok(refreshed.added >= 1, 'the daily job adds a customer who qualifies');
  const autoGroup = await app.db.query('plugin::ordering.customer-group').findOne({ where: { id: auto.item.id } });
  const memberships = await app.db.query('plugin::ordering.customer-group-member').findMany({
    where: { groupDocumentId: autoGroup.documentId },
  });
  const autoRow = memberships.find((row) => row.customerId === customerId && row.source === 'auto');
  const manualRow = memberships.find((row) => row.customerId === quietId);
  assert.ok(autoRow, 'qualifying customer is an auto member');
  assert.equal(manualRow.source, 'manual', 'a manual member who does not qualify stays');

  const eraseId = await customers.linkForOrder({ phoneE164: '+84908880016' });
  const eraseProfile = await app.db.query('plugin::ordering.customer').findOne({ where: { id: eraseId } });
  await app.db.query('plugin::ordering.customer').update({
    where: { id: eraseId },
    data: { status: 'verified', orderCount: 4, totalSpent: '100000' },
  });
  await groups.setMembers(vip.item.id, { add: [eraseProfile.documentId], remove: [] }, systemCtx);
  await app.plugin('ordering').service('data-rights').requestSelfErase(eraseId, systemCtx);
  assert.equal(
    await app.db.query('plugin::ordering.customer-group-member').count({ where: { customerId: eraseId } }),
    0,
    'erasure removes memberships',
  );
  await groups.refreshAuto(new Date(HAPPY));
  assert.equal(
    await app.db.query('plugin::ordering.customer-group-member').count({ where: { customerId: eraseId } }),
    0,
    'the daily job does not put an erased customer back',
  );

  // A rule with only sinceDays means "ordered within N days" — never every customer.
  const recent = await groups.create(
    { code: 'gan-day', name: { vi: 'Đặt gần đây' }, active: true, auto: { sinceDays: 30 } },
    systemCtx,
  );
  const recentGroup = await app.db.query('plugin::ordering.customer-group').findOne({ where: { id: recent.item.id } });
  const linkedOrder = await app.db.query('plugin::ordering.order').findOne({ where: { customer: customerId } });
  assert.ok(linkedOrder, 'the grouped customer has a linked order');
  await app.db.query('plugin::ordering.order').update({
    where: { id: linkedOrder.id },
    data: { status: 'completed', completedAt: new Date(new Date(HAPPY).getTime() - 86_400_000) },
  });
  await groups.refreshAuto(new Date(HAPPY));
  const recentMembers = (
    await app.db.query('plugin::ordering.customer-group-member').findMany({
      where: { groupDocumentId: recentGroup.documentId },
    })
  ).map((row) => row.customerId);
  assert.ok(recentMembers.includes(customerId), 'a customer with a completed order in the window joins');
  assert.ok(!recentMembers.includes(quietId), 'a customer without orders in the window does not');

  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}`;
  const catalog = (path, headers) =>
    fetch(`${base}/api/v1/ordering${path}`, { headers: { 'x-forwarded-for': `10.14.${randomUUID().slice(0, 2)}.${Math.floor(Math.random() * 200)}`, ...headers } });
  const pub = await catalog('/catalog/categories?locale=vi&location=Q1');
  assert.equal(pub.status, 200);
  assert.equal(pub.headers.get('cache-control'), 'public, max-age=30');
  const token = await app.plugin('ordering').service('customer-auth').issueSession(quiet, systemCtx);
  const priv = await catalog('/catalog/categories?locale=vi&location=Q1', { 'x-customer-token': token });
  assert.equal(priv.status, 200);
  assert.equal(priv.headers.get('cache-control'), 'private, no-store');
  const dead = await catalog('/catalog/categories?locale=vi&location=Q1', { 'x-customer-token': 'not-a-session' });
  assert.equal(dead.headers.get('cache-control'), 'public, max-age=30');
  const bad = await catalog('/catalog/categories?locale=vi&receiveKind=staff');
  assert.equal(bad.status, 400);
  const dine = await catalog('/catalog/products?locale=vi&receiveKind=dine-in&at=2026-10-13T08:00:00.000Z');
  assert.equal(dine.status, 200);

  const staff = await seedAdminHttpStaff(app, {
    actions: ['price.manage'],
    scopes: { gia: { allLocations: true, locationRefs: [] } },
  });
  const options = await staff.as.gia('GET', '/price-lists/options');
  assert.equal(options.status, 200, JSON.stringify(options.body));
  const denied = await staff.as.gia('GET', '/promotions/targets');
  assert.equal(denied.status, 403);
  const preview = await staff.as.gia('POST', '/price-preview', {
    variantId: variant.documentId,
    channel: 'pickup',
    locationRef: 'Q1',
    at: MORNING,
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.amount, 45000);
  await staff.cleanup();

  console.log('[ordering-test] price lists: channel, happy hour, group, staff, edit, cache, erasure');
});
