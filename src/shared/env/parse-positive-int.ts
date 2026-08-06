/**
 * Positive-int env parsing for lazily constructed runtime singletons.
 *
 * `config/env.helper.ts` is deliberately not reused here: it takes Strapi's
 * injected `ConfigParams['env']` callable, which a process-lifetime singleton
 * built outside the config phase does not have.
 */

/** Parse a positive int env value, falling back when absent or malformed. */
export const parsePositiveIntEnv = (
  raw: string | undefined,
  fallback: number,
): number => {
  if (raw == null || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  return n;
};
