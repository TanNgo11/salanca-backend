/**
 * Fixed-window in-process rate limiter.
 * Suitable for single-instance / staging; multi-instance needs Redis later.
 */

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

type WindowEntry = {
  count: number;
  resetAt: number;
};

export type InMemoryRateLimitOptions = {
  /** Max consumptions per window (inclusive of the last allowed hit). */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

/** Opportunistic full-map prune every N consumptions (expired keys only). */
const PRUNE_EVERY_N = 64;

/**
 * Pure fixed-window counter keyed by caller-supplied strings (e.g. feature:ip).
 */
export class InMemoryRateLimit {
  private readonly store = new Map<string, WindowEntry>();
  private accessCount = 0;

  constructor(private readonly options: InMemoryRateLimitOptions) {
    if (options.max < 1) {
      throw new Error('InMemoryRateLimit max must be >= 1');
    }
    if (options.windowMs < 1) {
      throw new Error('InMemoryRateLimit windowMs must be >= 1');
    }
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.store) {
      if (now >= entry.resetAt) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Attempts to consume one unit for `key` at `now`.
   * When the window has expired, starts a new window with count 1.
   */
  tryConsume(key: string, now: number = Date.now()): RateLimitResult {
    const { max, windowMs } = this.options;
    this.accessCount += 1;
    if (this.accessCount % PRUNE_EVERY_N === 0) {
      this.pruneExpired(now);
    }

    const entry = this.store.get(key);

    if (!entry || now >= entry.resetAt) {
      if (entry && now >= entry.resetAt) {
        this.store.delete(key);
      }
      this.store.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true };
    }

    if (entry.count >= max) {
      return { allowed: false, retryAfterMs: Math.max(0, entry.resetAt - now) };
    }

    entry.count += 1;
    return { allowed: true };
  }

  /** Test helper: drop all keys. */
  reset(): void {
    this.store.clear();
    this.accessCount = 0;
  }

  /** Test helper: current key count (includes unexpired windows only after prune). */
  size(): number {
    return this.store.size;
  }
}
