import assert from 'node:assert/strict';

import { seedAdminHttpStaff, seedBranches, seedMenu, withApp } from './_harness.mjs';

// O7 step 2: a special day replaces regular hours and holidays for quote and for /config.
// Quote uses a fixed clock. /config over HTTP uses the real clock and only returns 14 days.

const TZ = 'Asia/Ho_Chi_Minh';

const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const localDate = (instant, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type) => parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const pickupHours = {
  enabled: true,
  paymentTiming: 'pay-on-pickup',
  paymentProviders: ['cash'],
  schedule: {
    leadTimeMinutes: 0,
    slotLengthMinutes: 30,
    openingHours: { mode: 'daily', daily: [{ start: '07:00', end: '22:00' }] },
    businessDayPolicy: {
      holidayDates: ['2026-10-13'],
      specialHours: [
        { date: '2026-10-11', ranges: [{ start: '10:00', end: '12:00' }], note: 'Hôm qua' },
        { date: '2026-10-12', ranges: [{ start: '10:00', end: '14:00' }], note: 'Mùng 2 Tết' },
        { date: '2026-10-13', ranges: [{ start: '10:00', end: '12:00' }] },
        { date: '2026-10-14', closed: true, ranges: [], note: 'Đóng' },
        { date: '2026-10-25', ranges: [{ start: '09:00', end: '12:00' }] },
        { date: '2026-10-26', ranges: [{ start: '09:00', end: '12:00' }] },
      ],
    },
  },
};

const deliveryHours = {
  enabled: true,
  paymentTiming: 'pay-on-pickup',
  paymentProviders: ['cash'],
  schedule: {
    leadTimeMinutes: 0,
    openingHours: { mode: '24_7' },
    businessDayPolicy: {
      specialHours: [
        { date: '2026-10-12', closed: true, ranges: [], note: 'Nghỉ giao' },
        { date: '2026-10-26', ranges: [{ start: '09:00', end: '12:00' }] },
      ],
    },
  },
};

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  await app.listen();
  const http = await seedAdminHttpStaff(app, {
    scopes: { lan: { allLocations: false, locationRefs: ['Q1'] } },
  });
  try {
    const saved = await http.as.lan('PUT', '/branches/Q1', {
      fulfillment: { pickup: pickupHours, delivery: deliveryHours },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));

    const order = app.plugin('ordering').service('order');
    const storefront = app.plugin('ordering').service('storefront');
    const quote = (pickup, now) =>
      order.quote(
        {
          locationRef: 'Q1',
          locale: 'vi',
          lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
          receiveMethod: { kind: 'pickup', locationRef: 'Q1' },
          contact: { phone: '+84900000001' },
          consent: { policyVersion: 'v1', channel: 'web-checkout' },
          origin: { kind: 'storefront' },
          pickup,
        },
        { actor: { kind: 'system' }, now },
      );

    const inside = await quote({ asap: true }, new Date('2026-10-12T04:00:00.000Z'));
    assert.equal(inside.timing.mode, 'asap', 'ASAP at 11:00 is inside 10:00–14:00');

    await assert.rejects(
      () => quote({ asap: true }, new Date('2026-10-12T02:00:00.000Z')),
      (error) => error.code === 'ASAP_UNAVAILABLE',
      'ASAP at 09:00 is outside the special window even though regular hours are 07:00–22:00',
    );

    const scheduled = await quote(
      { slot: { startsAt: '2026-10-12T04:00:00.000Z' } },
      new Date('2026-10-12T01:00:00.000Z'),
    );
    assert.equal(scheduled.timing.mode, 'scheduled');

    await assert.rejects(
      () =>
        quote(
          { slot: { startsAt: '2026-10-12T08:00:00.000Z' } },
          new Date('2026-10-12T01:00:00.000Z'),
        ),
      (error) => error.code === 'SLOT_UNAVAILABLE',
      '15:00 is outside the special window',
    );

    const holidayOverridden = await quote(
      { slot: { startsAt: '2026-10-13T03:00:00.000Z' } },
      new Date('2026-10-13T00:00:00.000Z'),
    );
    assert.equal(holidayOverridden.timing.mode, 'scheduled', 'special hours win over a holiday');

    await assert.rejects(
      () => quote({ asap: true }, new Date('2026-10-14T05:00:00.000Z')),
      (error) => error.code === 'ASAP_UNAVAILABLE',
      'a closed special day refuses ASAP',
    );

    const fixedNow = new Date('2026-10-12T04:00:00.000Z');
    const config = await storefront.config('Q1', { actor: { kind: 'customer' }, now: fixedNow });
    assert.deepEqual(
      config.branch.pickup.specialHours.map((row) => row.date),
      ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-25'],
    );
    assert.equal(config.branch.pickup.specialHours[0].note, 'Mùng 2 Tết');
    assert.deepEqual(config.branch.pickup.specialHours[0].ranges, [{ start: '10:00', end: '14:00' }]);
    assert.equal(config.branch.pickup.specialHours[2].closed, true);
    assert.deepEqual(config.branch.delivery.specialHours, [
      { date: '2026-10-12', closed: true, ranges: [], note: 'Nghỉ giao' },
    ]);

    const live = await fetch(`http://127.0.0.1:${process.env.PORT}/api/v1/ordering/config?branch=Q1`);
    assert.equal(live.status, 200);
    const liveBody = await live.json();
    const today = localDate(new Date(), TZ);
    const last = addDays(today, 13);
    const liveDates = liveBody.branch.pickup.specialHours.map((row) => row.date);
    const expected = pickupHours.schedule.businessDayPolicy.specialHours
      .map((row) => row.date)
      .filter((date) => date >= today && date <= last)
      .sort();
    assert.deepEqual(liveDates, expected, `window ${today}..${last}`);
    // 2026-10-11 is before this window once the clock passes it. 2026-10-26 enters the
    // window on 2026-10-13 (today + 13). Compare each fixture date to the live window.
    for (const date of ['2026-10-11', '2026-10-26']) {
      assert.equal(liveDates.includes(date), date >= today && date <= last, date);
    }
    for (const row of liveBody.branch.delivery.specialHours) {
      assert.ok(row.date >= today && row.date <= last, row.date);
    }

    console.log('[ordering-test] special hours: quote, closed day, 14-day config verified');
  } finally {
    await http.cleanup();
  }
});
