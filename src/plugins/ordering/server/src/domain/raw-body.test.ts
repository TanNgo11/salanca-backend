import { describe, expect, it } from 'vitest';

import {
  assertSignedWebhooksHaveRawBody,
  rawBodyIsEnabled,
  readUnparsedBody,
  SIGNED_WEBHOOK_CAPABILITY,
} from './raw-body';

const sepay = {
  code: 'sepay',
  capabilities: [SIGNED_WEBHOOK_CAPABILITY, 'online'],
  enabled: true,
};

describe('raw body gate', () => {
  it('sees includeUnparsed only on the named body middleware', () => {
    expect(rawBodyIsEnabled(['strapi::body'])).toBe(false);
    expect(rawBodyIsEnabled([{ name: 'strapi::body', config: { jsonLimit: '256kb' } }])).toBe(false);
    expect(
      rawBodyIsEnabled([{ name: 'strapi::body', config: { includeUnparsed: true } }]),
    ).toBe(true);
    expect(rawBodyIsEnabled(undefined)).toBe(false);
  });

  it('refuses to boot when a signed provider is enabled and the raw body is off', () => {
    expect(() =>
      assertSignedWebhooksHaveRawBody({ providers: [sepay], middlewares: ['strapi::body'] }),
    ).toThrow(/sepay.*includeUnparsed/);
  });

  it('allows boot when the provider is off or the raw body is on', () => {
    expect(() =>
      assertSignedWebhooksHaveRawBody({
        providers: [{ ...sepay, enabled: false }],
        middlewares: ['strapi::body'],
      }),
    ).not.toThrow();
    expect(() =>
      assertSignedWebhooksHaveRawBody({
        providers: [sepay],
        middlewares: [{ name: 'strapi::body', config: { includeUnparsed: true } }],
      }),
    ).not.toThrow();
    expect(() =>
      assertSignedWebhooksHaveRawBody({
        providers: [{ code: 'cash', capabilities: ['manual'], enabled: true }],
        middlewares: [],
      }),
    ).not.toThrow();
  });

  it('reads the unparsed body symbol and nothing else', () => {
    const symbol = Symbol.for('unparsedBody');
    expect(readUnparsedBody({ [symbol]: '{"id":1}' })).toBe('{"id":1}');
    expect(readUnparsedBody({ id: 1 })).toBeNull();
    expect(readUnparsedBody(null)).toBeNull();
    expect(readUnparsedBody({ [symbol]: 12 })).toBeNull();
  });
});
