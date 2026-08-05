/**
 * Reservation-specific rate limit config (env + lazy process singleton).
 */

import {
  InMemoryRateLimit,
  parsePositiveIntEnv,
} from '../rate-limit/in-memory-rate-limit';

export const DEFAULT_RESERVATION_RATE_LIMIT_MAX = 5;
export const DEFAULT_RESERVATION_RATE_LIMIT_WINDOW_MS = 600_000;

export const createReservationRateLimit = (
  env: NodeJS.ProcessEnv = process.env,
): InMemoryRateLimit =>
  new InMemoryRateLimit({
    max: parsePositiveIntEnv(env.RESERVATION_RATE_LIMIT_MAX, DEFAULT_RESERVATION_RATE_LIMIT_MAX),
    windowMs: parsePositiveIntEnv(
      env.RESERVATION_RATE_LIMIT_WINDOW_MS,
      DEFAULT_RESERVATION_RATE_LIMIT_WINDOW_MS,
    ),
  });

let singleton: InMemoryRateLimit | undefined;

/** Lazy process-lifetime limiter (reads env on first use). */
export const getReservationRateLimit = (): InMemoryRateLimit => {
  if (!singleton) {
    singleton = createReservationRateLimit();
  }
  return singleton;
};

/** Test helper. */
export const resetReservationRateLimitForTests = (): void => {
  singleton = undefined;
};
