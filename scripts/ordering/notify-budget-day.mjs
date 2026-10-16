import assert from 'node:assert/strict';

import { withApp } from './_harness.mjs';

// R1e: the paid-channel daily budget follows the calendar day of `notifications.timezone`
// (default `Asia/Ho_Chi_Minh`), not the UTC day. `reservePaidSend` takes an explicit `now` so both
// boundaries are probed without touching the system clock.
withApp(async (app) => {
  const channel = app.plugin('ordering').service('notification-channel');
  app.config.set('plugin::ordering.notifications.dailyLimit', 1);

  // Default Asia/Ho_Chi_Minh: 17:00Z is 00:00 the next local day.
  assert.equal(
    await channel.reservePaidSend(new Date('2026-10-15T16:30:00Z')),
    true,
    'first paid slot of the Vietnam day',
  );
  assert.equal(
    await channel.reservePaidSend(new Date('2026-10-15T16:45:00Z')),
    false,
    'still the same Vietnam day',
  );
  assert.equal(
    await channel.reservePaidSend(new Date('2026-10-15T17:30:00Z')),
    true,
    'Vietnam day flipped at 17:00Z, so the counter resets',
  );

  // Explicit UTC: the same instants all share one UTC day.
  app.config.set('plugin::ordering.notifications.timezone', 'UTC');
  assert.equal(await channel.reservePaidSend(new Date('2026-10-15T16:30:00Z')), true);
  assert.equal(
    await channel.reservePaidSend(new Date('2026-10-15T16:45:00Z')),
    false,
    'same UTC day',
  );
  assert.equal(
    await channel.reservePaidSend(new Date('2026-10-15T17:30:00Z')),
    false,
    '17:30Z is still the same UTC day',
  );

  console.log('[ordering-test] notify-budget-day: budget day follows notifications.timezone');
});
