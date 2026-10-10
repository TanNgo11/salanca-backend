/**
 * Fixed-window in-process rate limiter for the public catalog API. Self-contained inside the
 * plugin — it must not import app code. Suitable for single-instance; multi-instance moves to
 * Redis later (same note as the app's intake limiter).
 */

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

type WindowEntry = {
  count: number;
  resetAt: number;
};

/** Opportunistic full-map prune every N consumptions (expired keys only). */
const PRUNE_EVERY_N = 64;

export class InMemoryRateLimit {
  private readonly store = new Map<string, WindowEntry>();
  private accessCount = 0;

  constructor(private readonly options: { max: number; windowMs: number }) {
    if (options.max < 1) throw new Error('InMemoryRateLimit max must be >= 1');
    if (options.windowMs < 1) throw new Error('InMemoryRateLimit windowMs must be >= 1');
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.store) {
      if (now >= entry.resetAt) this.store.delete(key);
    }
  }

  /** Consumes one unit for `key`; when the window expired it starts a new one with count 1. */
  tryConsume(key: string, now: number = Date.now()): RateLimitResult {
    const { max, windowMs } = this.options;
    this.accessCount += 1;
    if (this.accessCount % PRUNE_EVERY_N === 0) this.pruneExpired(now);

    const entry = this.store.get(key);
    if (!entry || now >= entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true };
    }
    if (entry.count >= max) {
      return { allowed: false, retryAfterMs: Math.max(0, entry.resetAt - now) };
    }
    entry.count += 1;
    return { allowed: true };
  }

  reset(): void {
    this.store.clear();
    this.accessCount = 0;
  }
}

export const parsePositiveIntEnv = (
  raw: string | undefined,
  fallback: number,
): number => {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
};

export const DEFAULT_CATALOG_RATE_LIMIT_MAX = 120;
export const DEFAULT_CATALOG_RATE_LIMIT_WINDOW_MS = 60_000;

let singleton: InMemoryRateLimit | undefined;

/** Lazy process-lifetime limiter for the public catalog routes (reads env on first use). */
export const getCatalogRateLimit = (): InMemoryRateLimit => {
  if (!singleton) {
    singleton = new InMemoryRateLimit({
      max: parsePositiveIntEnv(
        process.env.ORDERING_CATALOG_RATE_LIMIT_MAX,
        DEFAULT_CATALOG_RATE_LIMIT_MAX,
      ),
      windowMs: parsePositiveIntEnv(
        process.env.ORDERING_CATALOG_RATE_LIMIT_WINDOW_MS,
        DEFAULT_CATALOG_RATE_LIMIT_WINDOW_MS,
      ),
    });
  }
  return singleton;
};

/** Test helper. */
export const resetCatalogRateLimitForTests = (): void => {
  singleton = undefined;
};
