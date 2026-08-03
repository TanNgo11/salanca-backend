/**
 * Public Content API smoke (positive + negative) against a running-prefix contract.
 * Loads Strapi, starts HTTP, uses Public permissions (no token for reads).
 *
 * Prerequisites: seed:demo (or equivalent published content).
 * Usage: npm run smoke:api
 */
import assert from 'node:assert/strict';

import { loadStrapiApp } from './lib/strapi-load.mjs';

process.env.PORT = process.env.API_SMOKE_PORT ?? '1341';
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

try {
  // Ensure public permissions are provisioned (bootstrap already ran on load).
  await app.start();

  const globalRes = await api(`${prefix}/global-setting?locale=vi`);
  assert.equal(globalRes.response.status, 200, 'public can read global-setting VI');
  assert.ok(globalRes.body?.data, 'global-setting data present');

  const menuQuery = new URLSearchParams({
    locale: 'vi',
    'filters[slug][$eq]': 'picanha',
    populate: 'category',
  });
  const menuRes = await api(`${prefix}/menu-items?${menuQuery}`);
  assert.equal(menuRes.response.status, 200, 'public can list menu-items');
  assert.ok(menuRes.body?.data?.length >= 1, 'seeded picanha visible');
  assert.equal(menuRes.body.data[0].locale, 'vi');
  if (menuRes.body.data[0].category) {
    assert.equal(menuRes.body.data[0].category.locale, 'vi');
  }

  const enMenuQuery = new URLSearchParams({
    locale: 'en',
    'filters[slug][$eq]': 'picanha-en',
    populate: 'category',
  });
  const enMenuRes = await api(`${prefix}/menu-items?${enMenuQuery}`);
  assert.equal(enMenuRes.response.status, 200);
  assert.ok(enMenuRes.body?.data?.length >= 1, 'EN picanha visible');
  assert.equal(enMenuRes.body.data[0].locale, 'en');

  // Missing EN for VI-only item (salad-nha has no EN localization in seed)
  const missingEn = await api(
    `${prefix}/menu-items?${new URLSearchParams({
      locale: 'en',
      'filters[slug][$eq]': 'salad-nha',
    })}`,
  );
  assert.equal(missingEn.response.status, 200);
  assert.equal(missingEn.body.data.length, 0, 'must not fall back VI when EN missing');

  // Draft-only EN private event must not appear on public published list
  const draftEn = await api(
    `${prefix}/campaigns?${new URLSearchParams({
      locale: 'en',
      'filters[slug][$eq]': 'private-dining-draft',
    })}`,
  );
  assert.equal(draftEn.response.status, 200);
  assert.equal(draftEn.body.data.length, 0, 'draft EN campaign hidden from public');

  // Negative: anonymous write denied
  const createAttempt = await api(`${prefix}/menu-items?locale=vi`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        name: 'Hack item',
        slug: 'hack-item',
        price: 1,
        isFeatured: false,
        isActive: true,
        displayOrder: 0,
      },
    }),
  });
  assert.notEqual(createAttempt.response.status, 200);
  assert.notEqual(createAttempt.response.status, 201);
  assert.ok(
    createAttempt.response.status === 401
      || createAttempt.response.status === 403
      || createAttempt.response.status === 400,
    `anonymous create must fail, got ${createAttempt.response.status}`,
  );

  const deleteAttempt = await api(`${prefix}/menu-items/x?locale=vi`, {
    method: 'DELETE',
  });
  assert.notEqual(deleteAttempt.response.status, 200);
  assert.notEqual(deleteAttempt.response.status, 204);

  console.log('smoke:api passed');
} catch (error) {
  console.error('smoke:api failed');
  console.error(error);
  process.exitCode = 1;
} finally {
  await app.destroy();
}
