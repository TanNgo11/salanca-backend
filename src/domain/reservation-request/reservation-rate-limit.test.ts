import { afterEach, describe, expect, it } from 'vitest';

import {
  createReservationRateLimit,
  DEFAULT_RESERVATION_RATE_LIMIT_MAX,
  DEFAULT_RESERVATION_RATE_LIMIT_WINDOW_MS,
  getReservationRateLimit,
  resetReservationRateLimitForTests,
} from './reservation-rate-limit';

describe('createReservationRateLimit', () => {
  it('uses defaults when env unset', () => {
    const limiter = createReservationRateLimit({});
    const now = 10_000;
    for (let i = 0; i < DEFAULT_RESERVATION_RATE_LIMIT_MAX; i += 1) {
      expect(limiter.tryConsume('ip', now).allowed).toBe(true);
    }
    expect(limiter.tryConsume('ip', now).allowed).toBe(false);
    expect(DEFAULT_RESERVATION_RATE_LIMIT_WINDOW_MS).toBe(600_000);
  });

  it('honors env overrides', () => {
    const limiter = createReservationRateLimit({
      RESERVATION_RATE_LIMIT_MAX: '2',
      RESERVATION_RATE_LIMIT_WINDOW_MS: '5000',
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

describe('getReservationRateLimit', () => {
  afterEach(() => {
    resetReservationRateLimitForTests();
  });

  it('returns a stable singleton', () => {
    const a = getReservationRateLimit();
    const b = getReservationRateLimit();
    expect(a).toBe(b);
  });
});
