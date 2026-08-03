import type { Core } from '@strapi/strapi';

type Environment = Core.Config.Shared.ConfigParams['env'];

const DEFAULT_LOCAL_ORIGINS = ['http://localhost:3000'] as const;

/**
 * Parses FRONTEND_URLS into a non-empty origin allowlist.
 * Comma-separated values; empty entries are dropped.
 * Defaults to local Next.js origin when the env var is absent.
 */
export const resolveFrontendOrigins = (env: Environment): string[] => {
  const raw = env.array('FRONTEND_URLS', [...DEFAULT_LOCAL_ORIGINS]);
  const origins = (raw ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (origins.length === 0) {
    throw new Error('FRONTEND_URLS must contain at least one allowed frontend origin.');
  }

  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(
        `FRONTEND_URLS entry "${origin}" is not a valid absolute origin URL.`,
      );
    }

    if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new Error(
        `FRONTEND_URLS entry "${origin}" must be a bare origin without path, query, fragment, or credentials.`,
      );
    }
  }

  return origins.map((origin) => new URL(origin).origin);
};
