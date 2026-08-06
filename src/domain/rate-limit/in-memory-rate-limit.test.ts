import { afterEach, describe, expect, it } from 'vitest';

import { parsePositiveIntEnv } from '../../shared/env/parse-positive-int';
import { InMemoryRateLimit } from './in-memory-rate-limit';

describe('InMemoryRateLimit', () => {
  const limiter = new InMemoryRateLimit({ max: 3, windowMs: 1000 });

  afterEach(() => {
    limiter.reset();
  });

  it('allows up to max hits in a window', () => {
    const now = 1_000_000;
    expect(limiter.tryConsume('a', now)).toEqual({ allowed: true });
    expect(limiter.tryConsume('a', now + 1)).toEqual({ allowed: true });
    expect(limiter.tryConsume('a', now + 2)).toEqual({ allowed: true });
    expect(limiter.tryConsume('a', now + 3)).toEqual({
      allowed: false,
      retryAfterMs: 1000 - 3,
    });
  });

  it('isolates keys', () => {
    const now = 2_000_000;
    expect(limiter.tryConsume('x', now).allowed).toBe(true);
    expect(limiter.tryConsume('y', now).allowed).toBe(true);
  });

  it('resets after window expires', () => {
    const now = 3_000_000;
    expect(limiter.tryConsume('z', now).allowed).toBe(true);
    expect(limiter.tryConsume('z', now + 1).allowed).toBe(true);
    expect(limiter.tryConsume('z', now + 2).allowed).toBe(true);
    expect(limiter.tryConsume('z', now + 3).allowed).toBe(false);
    expect(limiter.tryConsume('z', now + 1000).allowed).toBe(true);
  });

  it('rejects invalid construction', () => {
    expect(() => new InMemoryRateLimit({ max: 0, windowMs: 1000 })).toThrow(/max/);
    expect(() => new InMemoryRateLimit({ max: 1, windowMs: 0 })).toThrow(/windowMs/);
  });

  it('prunes expired keys every 64 consumptions', () => {
    const now = 4_000_000;
    for (let i = 0; i < 64; i += 1) {
      expect(limiter.tryConsume(`old-${i}`, now).allowed).toBe(true);
    }
    expect(limiter.size()).toBe(64);

    // After the window expires, further consumptions should drop old keys on prune.
    for (let i = 0; i < 64; i += 1) {
      expect(limiter.tryConsume(`new-${i}`, now + 1000).allowed).toBe(true);
    }
    // 128th access prunes: only the second-wave keys remain.
    expect(limiter.size()).toBe(64);
  });
});


describe('parsePositiveIntEnv', () => {
  it('uses fallback for empty or invalid', () => {
    expect(parsePositiveIntEnv(undefined, 5)).toBe(5);
    expect(parsePositiveIntEnv('', 5)).toBe(5);
    expect(parsePositiveIntEnv('abc', 5)).toBe(5);
    expect(parsePositiveIntEnv('0', 5)).toBe(5);
  });

  it('parses positive integers', () => {
    expect(parsePositiveIntEnv('12', 5)).toBe(12);
  });
});
