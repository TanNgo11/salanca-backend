import type { Core } from '@strapi/strapi';
import { describe, expect, it } from 'vitest';

import { resolveFrontendOrigins } from './cors.helper';

type EnvironmentValues = Readonly<Record<string, string | undefined>>;

const createEnv = (values: EnvironmentValues): Core.Config.Shared.ConfigParams['env'] => {
  const env = ((key: string, fallback?: string): string | undefined =>
    values[key] ?? fallback) as Core.Config.Shared.ConfigParams['env'];

  env.array = (key: string, fallback?: string[]): string[] => {
    const value = values[key];
    if (value === undefined) {
      return fallback ?? [];
    }
    return value.split(',').map((part) => part.trim());
  };

  return env;
};

describe('resolveFrontendOrigins', () => {
  it('defaults to local Next.js origin when FRONTEND_URLS is absent', () => {
    expect(resolveFrontendOrigins(createEnv({}))).toEqual(['http://localhost:3000']);
  });

  it('parses a comma-separated allowlist', () => {
    expect(
      resolveFrontendOrigins(
        createEnv({
          FRONTEND_URLS: 'https://salanca.example,https://www.salanca.example',
        }),
      ),
    ).toEqual(['https://salanca.example', 'https://www.salanca.example']);
  });

  it('rejects an empty allowlist', () => {
    expect(() => resolveFrontendOrigins(createEnv({ FRONTEND_URLS: ' , ' }))).toThrow(
      'FRONTEND_URLS must contain at least one allowed frontend origin.',
    );
  });

  it('rejects origins with a path', () => {
    expect(() =>
      resolveFrontendOrigins(createEnv({ FRONTEND_URLS: 'https://salanca.example/app' })),
    ).toThrow('bare origin');
  });

  it('rejects non-URL values', () => {
    expect(() => resolveFrontendOrigins(createEnv({ FRONTEND_URLS: 'not-a-url' }))).toThrow(
      'not a valid absolute origin URL',
    );
  });
});
