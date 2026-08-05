/**
 * Public reservation form intake smoke (positive + negative + soft overlap).
 * Loads Strapi, starts HTTP, uses Public permissions (no token).
 *
 * Usage: npm run smoke:reservation-form
 */
import assert from 'node:assert/strict';

import { loadStrapiApp } from './lib/strapi-load.mjs';

process.env.PORT = process.env.RESERVATION_SMOKE_PORT ?? '1343';
/** High limit so this smoke is not blocked by prior runs in the same process lifetime. */
process.env.RESERVATION_RATE_LIMIT_MAX = process.env.RESERVATION_RATE_LIMIT_MAX ?? '50';
process.env.RESERVATION_RATE_LIMIT_WINDOW_MS =
  process.env.RESERVATION_RATE_LIMIT_WINDOW_MS ?? '600000';

const prefix = process.env.API_REST_PREFIX ?? '/api/v1';
const base = `http://127.0.0.1:${process.env.PORT}`;

const app = await loadStrapiApp();

async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

/** Future-ish date so smoke stays valid year-round. */
const preferredDate = '2030-06-15';
const preferredTime = '19:00-smoke-overlap';

try {
  await app.start();

  const validLater = await api(`${prefix}/reservation-requests`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        fullName: 'Smoke Reservation User',
        phone: '0901000001',
        email: 'smoke-reservation@example.com',
        preferredDate,
        preferredTime,
        guestCount: 4,
        occasion: 'birthday',
        note: 'Smoke later mode',
        menuSelectionMode: 'later',
        sourceLocale: 'vi',
        sourcePath: '/vi/dat-ban',
        website: '',
        status: 'archived',
      },
    }),
  });
  assert.equal(
    validLater.response.status,
    201,
    `valid later create expected 201, got ${validLater.response.status}: ${JSON.stringify(validLater.body)}`,
  );
  assert.ok(validLater.body?.data?.documentId, 'documentId present');
  assert.equal(validLater.body.data.status, 'new', 'status forced to new');
  assert.equal(typeof validLater.body.data.hasOverlap, 'boolean', 'hasOverlap present');
  assert.equal(typeof validLater.body.data.overlapCount, 'number', 'overlapCount present');

  const secondSameSlot = await api(`${prefix}/reservation-requests`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        fullName: 'Smoke Overlap Peer',
        phone: '0901000002',
        preferredDate,
        preferredTime,
        guestCount: 2,
        menuSelectionMode: 'later',
        sourceLocale: 'en',
      },
    }),
  });
  assert.equal(
    secondSameSlot.response.status,
    201,
    `second same-slot create expected 201, got ${secondSameSlot.response.status}`,
  );
  assert.equal(
    secondSameSlot.body.data.hasOverlap,
    true,
    'second request on same date+time should soft-flag overlap',
  );
  assert.ok(
    secondSameSlot.body.data.overlapCount >= 1,
    'overlapCount should be at least 1',
  );

  const honeypot = await api(`${prefix}/reservation-requests`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        fullName: 'Bot',
        phone: '0901000003',
        preferredDate,
        preferredTime: '18:00',
        guestCount: 2,
        menuSelectionMode: 'later',
        sourceLocale: 'vi',
        website: 'http://spam.example',
      },
    }),
  });
  assert.equal(honeypot.response.status, 400, 'honeypot must be rejected');

  const noPhone = await api(`${prefix}/reservation-requests`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        fullName: 'No Phone',
        preferredDate,
        preferredTime: '18:00',
        guestCount: 2,
        menuSelectionMode: 'later',
        sourceLocale: 'vi',
      },
    }),
  });
  assert.equal(noPhone.response.status, 400, 'phone required');

  const laterWithMenu = await api(`${prefix}/reservation-requests`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        fullName: 'Later With Menu',
        phone: '0901000004',
        preferredDate,
        preferredTime: '18:30',
        guestCount: 2,
        menuSelectionMode: 'later',
        menuPackages: ['fake-package-id'],
        sourceLocale: 'vi',
      },
    }),
  });
  assert.equal(laterWithMenu.response.status, 400, 'later mode must reject menu ids');

  const nowEmpty = await api(`${prefix}/reservation-requests`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        fullName: 'Now Empty Menu',
        phone: '0901000005',
        preferredDate,
        preferredTime: '18:45',
        guestCount: 2,
        menuSelectionMode: 'now',
        sourceLocale: 'vi',
      },
    }),
  });
  assert.equal(nowEmpty.response.status, 400, 'now mode requires menu selection');

  const listAttempt = await api(`${prefix}/reservation-requests`);
  assert.ok(
    listAttempt.response.status === 401 || listAttempt.response.status === 403,
    `public list must be denied, got ${listAttempt.response.status}`,
  );

  console.log('smoke:reservation-form passed');
} finally {
  await app.destroy();
}
