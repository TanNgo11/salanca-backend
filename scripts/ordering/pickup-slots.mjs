import assert from 'node:assert/strict';

import { basicOrderInput, seedBranches, seedMenu, systemCtx, withApp } from './_harness.mjs';

// O3 step 2: slot occupancy from holds, and the last seat of a slot is exclusive — two
// transactions racing reserveInTransaction for capacity 1 end with exactly one SLOT_FULL.
withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const plugin = app.plugin('ordering');
  const scheduling = plugin.service('pickup-scheduling');
  const branchService = plugin.service('branch');
  const order = plugin.service('order');

  const branch = await branchService.findByCode('Q1');
  const settings = branchService.pickupSettings({
    fulfillment: {
      pickup: {
        enabled: true,
        schedule: {
          leadTimeMinutes: 0,
          slotLengthMinutes: 30,
          capacity: 1,
          openingHours: { mode: '24_7' },
        },
      },
    },
  });
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: branch.timezone }).format(
    new Date(now.getTime() + 24 * 3600_000),
  );
  const slots = await scheduling.listSlots({ branch, settings, date, leadTimeMinutes: 0, now });
  const slot = slots.find((candidate) => candidate.available);
  assert.ok(slot, 'tomorrow has an open slot');

  const orders = [];
  for (let index = 0; index < 2; index += 1) {
    const created = await order.createOrder(basicOrderInput(), systemCtx);
    orders.push(created.order.order.id);
  }

  const attempt = (orderId) =>
    app.db.transaction(({ trx }) =>
      scheduling.reserveInTransaction(
        trx,
        { orderId, locationRef: 'Q1', slot, capacity: settings.schedule.capacity },
        systemCtx,
      ),
    );
  const results = await Promise.allSettled(orders.map(attempt));
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one order takes the last seat');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'SLOT_FULL');

  const after = await scheduling.listSlots({ branch, settings, date, leadTimeMinutes: 0, now });
  const same = after.find((candidate) => candidate.startsAt === slot.startsAt);
  assert.deepEqual(
    { booked: same.booked, available: same.available, reason: same.reason },
    { booked: 1, available: false, reason: 'full' },
  );

  // A canceled order frees its seat.
  const winner = orders[results.findIndex((result) => result.status === 'fulfilled')];
  await plugin.service('hold').releaseForOrder(winner, 'order-canceled', systemCtx);
  const freed = await scheduling.listSlots({ branch, settings, date, leadTimeMinutes: 0, now });
  assert.equal(freed.find((candidate) => candidate.startsAt === slot.startsAt).available, true);

  await assert.rejects(
    scheduling.resolveTiming({
      branch,
      settings,
      request: { slot: { startsAt: new Date(now.getTime() - 3600_000).toISOString() } },
      leadTimeMinutes: 60,
      now,
    }),
    (error) => error.code === 'SLOT_TOO_EARLY' && typeof error.details.earliest === 'string',
  );
  console.log('[ordering-test] pickup-slots: occupancy, last-seat race, release, too-early verified');
});
