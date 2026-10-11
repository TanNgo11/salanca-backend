import { describe, expect, it } from 'vitest';

import { signSepayBody, verifySepaySignature } from './signature';

const SECRET = 'test-webhook-secret-value';
const BODY = '{"id":42,"transferType":"in","transferAmount":175000}';
const NOW = new Date('2026-10-11T12:00:00.000Z');
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000));

const check = (overrides: Partial<Parameters<typeof verifySepaySignature>[0]> = {}) =>
  verifySepaySignature({
    secret: SECRET,
    timestampHeader: TIMESTAMP,
    signatureHeader: `sha256=${signSepayBody(SECRET, TIMESTAMP, BODY)}`,
    rawBody: BODY,
    now: NOW,
    ...overrides,
  });

describe('SePay webhook signature', () => {
  it('accepts a signature over the raw body', () => {
    expect(check()).toEqual({ ok: true });
  });

  it('rejects a one-byte change in the body', () => {
    expect(check({ rawBody: `${BODY} ` }).reason).toBe('mismatch');
  });

  it('rejects a missing header', () => {
    expect(check({ signatureHeader: undefined }).reason).toBe('missing-header');
    expect(check({ timestampHeader: '  ' }).reason).toBe('missing-header');
  });

  it('rejects a timestamp older than five minutes', () => {
    const stale = String(Math.floor(NOW.getTime() / 1000) - 301);
    expect(
      check({
        timestampHeader: stale,
        signatureHeader: `sha256=${signSepayBody(SECRET, stale, BODY)}`,
      }).reason,
    ).toBe('stale');
  });

  it('accepts a timestamp inside the window', () => {
    const fresh = String(Math.floor(NOW.getTime() / 1000) - 299);
    expect(
      check({
        timestampHeader: fresh,
        signatureHeader: `sha256=${signSepayBody(SECRET, fresh, BODY)}`,
      }),
    ).toEqual({ ok: true });
  });
});
