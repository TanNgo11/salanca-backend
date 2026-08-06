/**
 * Contact-specific rate limit config (env + lazy process singleton).
 * Mirrors the reservation limiter; in-process only, per instance.
 */

import { parsePositiveIntEnv } from '../../shared/env/parse-positive-int';
import { InMemoryRateLimit } from '../rate-limit/in-memory-rate-limit';

export const DEFAULT_CONTACT_RATE_LIMIT_MAX = 5;
export const DEFAULT_CONTACT_RATE_LIMIT_WINDOW_MS = 600_000;

export const createContactRateLimit = (
  env: NodeJS.ProcessEnv = process.env,
): InMemoryRateLimit =>
  new InMemoryRateLimit({
    max: parsePositiveIntEnv(env.CONTACT_RATE_LIMIT_MAX, DEFAULT_CONTACT_RATE_LIMIT_MAX),
    windowMs: parsePositiveIntEnv(
      env.CONTACT_RATE_LIMIT_WINDOW_MS,
      DEFAULT_CONTACT_RATE_LIMIT_WINDOW_MS,
    ),
  });

let singleton: InMemoryRateLimit | undefined;

/** Lazy process-lifetime limiter (reads env on first use). */
export const getContactRateLimit = (): InMemoryRateLimit => {
  if (!singleton) {
    singleton = createContactRateLimit();
  }
  return singleton;
};

/** Test helper. */
export const resetContactRateLimitForTests = (): void => {
  singleton = undefined;
};
