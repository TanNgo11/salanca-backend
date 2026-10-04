import { afterEach, describe, expect, it } from 'vitest';

import {
  createContactRateLimit,
  DEFAULT_CONTACT_RATE_LIMIT_MAX,
  DEFAULT_CONTACT_RATE_LIMIT_WINDOW_MS,
  getContactRateLimit,
  resetContactRateLimitForTests,
} from './contact-rate-limit';

describe('createContactRateLimit', () => {
  it('uses defaults when env unset', () => {
    const limiter = createContactRateLimit({});
    const now = 10_000;
    for (let i = 0; i < DEFAULT_CONTACT_RATE_LIMIT_MAX; i += 1) {
      expect(limiter.tryConsume('ip', now).allowed).toBe(true);
    }
    expect(limiter.tryConsume('ip', now).allowed).toBe(false);
    expect(DEFAULT_CONTACT_RATE_LIMIT_WINDOW_MS).toBe(600_000);
  });

  it('honors env overrides', () => {
    const limiter = createContactRateLimit({
      CONTACT_RATE_LIMIT_MAX: '2',
      CONTACT_RATE_LIMIT_WINDOW_MS: '5000',
    });
    const now = 20_000;
    expect(limiter.tryConsume('ip', now).allowed).toBe(true);
    expect(limiter.tryConsume('ip', now).allowed).toBe(true);
    expect(limiter.tryConsume('ip', now)).toEqual({
      allowed: false,
      retryAfterMs: 5000,
    });
  });
});

describe('getContactRateLimit', () => {
  afterEach(() => {
    resetContactRateLimitForTests();
  });

  it('returns a stable singleton', () => {
    const a = getContactRateLimit();
    const b = getContactRateLimit();
    expect(a).toBe(b);
  });
});
