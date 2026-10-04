/**
 * Public contact form intake smoke (positive + negative).
 * Loads Strapi, starts HTTP, uses Public permissions (no token).
 *
 * Usage: npm run smoke:contact-form
 */
import assert from 'node:assert/strict';

import { loadStrapiApp } from './lib/strapi-load.mjs';

process.env.PORT = process.env.CONTACT_SMOKE_PORT ?? '1342';
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
  await app.start();

  const valid = await api(`${prefix}/contact-messages`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        fullName: 'Smoke Contact User',
        email: 'smoke-contact@example.com',
        phone: '0901000000',
        topic: 'general',
        message: 'Smoke contact form submission.',
        sourceLocale: 'vi',
        sourcePath: '/vi/lien-he',
        website: '',
        status: 'archived',
      },
    }),
  });
  assert.equal(valid.response.status, 201, `valid create expected 201, got ${valid.response.status}`);
  assert.ok(valid.body?.data?.documentId, 'documentId present');
  assert.equal(valid.body.data.status, 'new', 'status forced to new');

  const legacyLocale = await api(`${prefix}/contact-messages`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        fullName: 'Legacy Locale Key',
        email: 'legacy-locale@example.com',
        message: 'Uses locale alias.',
        locale: 'en',
      },
    }),
  });
  assert.equal(
    legacyLocale.response.status,
    201,
    `legacy locale alias expected 201, got ${legacyLocale.response.status}`,
  );

  const honeypot = await api(`${prefix}/contact-messages`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        fullName: 'Bot',
        email: 'bot@example.com',
        message: 'spam',
        sourceLocale: 'vi',
        website: 'http://spam.example',
      },
    }),
  });
  assert.equal(honeypot.response.status, 400, 'honeypot must be rejected');

  const noContact = await api(`${prefix}/contact-messages`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        fullName: 'No Contact',
        message: 'missing email and phone',
        sourceLocale: 'vi',
      },
    }),
  });
  assert.equal(noContact.response.status, 400, 'email or phone required');

  // 2 valid creates above already consumed quota; 3 more fill the default 5/window.
  for (let i = 0; i < 3; i += 1) {
    const filler = await api(`${prefix}/contact-messages`, {
      method: 'POST',
      body: JSON.stringify({
        data: { fullName: `Rate Filler ${i}`, email: `rate-${i}@example.com`, message: 'Rate limit filler.', sourceLocale: 'vi' },
      }),
    });
    assert.equal(filler.response.status, 201, `filler ${i} expected 201, got ${filler.response.status}`);
  }
  const limited = await api(`${prefix}/contact-messages`, {
    method: 'POST',
    body: JSON.stringify({
      data: { fullName: 'Rate Over', email: 'rate-over@example.com', message: 'Sixth submission.', sourceLocale: 'vi' },
    }),
  });
  assert.equal(limited.response.status, 429, `6th submission expected 429, got ${limited.response.status}`);
  assert.equal(limited.body?.error?.details?.code, 'CONTACT_RATE_LIMITED');
  assert.ok(limited.response.headers.get('retry-after'), 'Retry-After header present');

  const listAttempt = await api(`${prefix}/contact-messages`);
  assert.ok(
    // 404: the public router never registers a list route (create-only intake).
    [401, 403, 404].includes(listAttempt.response.status),
    `public list must be denied, got ${listAttempt.response.status}`,
  );

  const contentWrite = await api(`${prefix}/menu-items?locale=vi`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        name: 'Hack item',
        slug: 'hack-item-contact-smoke',
        price: 1,
        isFeatured: false,
        isActive: true,
        displayOrder: 0,
      },
    }),
  });
  assert.ok(
    contentWrite.response.status === 401
      || contentWrite.response.status === 403
      || contentWrite.response.status === 400,
    `content create must stay denied, got ${contentWrite.response.status}`,
  );

  console.log('smoke:contact-form passed');
} finally {
  await app.destroy();
}
