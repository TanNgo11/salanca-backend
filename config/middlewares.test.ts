import type { Core } from '@strapi/strapi';
import { describe, expect, it } from 'vitest';

import config from './middlewares';

type EnvironmentValues = Readonly<Record<string, string | undefined>>;

interface SecurityMiddlewareEntry {
  name: string;
  config?: {
    contentSecurityPolicy?: {
      useDefaults?: boolean;
      directives?: Record<string, string[] | null>;
    };
  };
}

interface CorsMiddlewareEntry {
  name: string;
  config?: {
    origin?: string[];
    credentials?: boolean;
  };
}

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

  env.bool = (key: string, fallback?: boolean): boolean => {
    const value = values[key];
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return fallback ?? false;
  };

  return env;
};

const s3Environment: EnvironmentValues = {
  FRONTEND_URLS: 'http://localhost:3000',
  API_REST_PREFIX: '/api/v1',
  S3_BUCKET: 'salanca-media-development',
  S3_REGION: 'ap-southeast-1',
  S3_ROOT_PATH: 'uploads',
  CDN_URL: 'https://media.example.com',
};

const isSecurityEntry = (entry: unknown): entry is SecurityMiddlewareEntry =>
  typeof entry === 'object' &&
  entry !== null &&
  'name' in entry &&
  (entry as { name: unknown }).name === 'strapi::security';

const isCorsEntry = (entry: unknown): entry is CorsMiddlewareEntry =>
  typeof entry === 'object' &&
  entry !== null &&
  'name' in entry &&
  (entry as { name: unknown }).name === 'strapi::cors';

const resolveSecurityDirectives = (
  values: EnvironmentValues = s3Environment,
): Record<string, string[] | null> => {
  const middlewares = config({ env: createEnv(values) } as Core.Config.Shared.ConfigParams);
  const security = middlewares.find(isSecurityEntry);
  const directives = security?.config?.contentSecurityPolicy?.directives;

  if (!directives) {
    throw new Error('The strapi::security middleware must declare explicit CSP directives.');
  }

  return directives;
};

describe('security middleware', () => {
  it('allows Admin previews from the exact media CDN origin when S3 is enabled', () => {
    const directives = resolveSecurityDirectives();

    expect(directives['img-src']).toEqual([
      "'self'",
      'data:',
      'blob:',
      'https://market-assets.strapi.io',
      'https://media.example.com',
    ]);
    expect(directives['media-src']).toEqual([
      "'self'",
      'data:',
      'blob:',
      'https://media.example.com',
    ]);
  });

  it('derives the allowed media origin from the environment rather than hardcoding a host', () => {
    const directives = resolveSecurityDirectives({
      ...s3Environment,
      CDN_URL: 'https://staging-media.example.net',
    });

    expect(directives['img-src']).toContain('https://staging-media.example.net');
    expect(directives['img-src']).not.toContain('https://media.example.com');
  });

  it('leaves connect-src to the Strapi default instead of redeclaring it', () => {
    expect(resolveSecurityDirectives()['connect-src']).toBeUndefined();
  });

  it('keeps the Strapi security defaults enabled when CSP is customized', () => {
    const middlewares = config({
      env: createEnv(s3Environment),
    } as Core.Config.Shared.ConfigParams);
    const security = middlewares.find(isSecurityEntry);

    expect(security?.config?.contentSecurityPolicy?.useDefaults).toBe(true);
  });

  it('uses default strapi::security when local disk has no CDN_URL', () => {
    const middlewares = config({
      env: createEnv({
        FRONTEND_URLS: 'http://localhost:3000',
        NODE_ENV: 'development',
      }),
    } as Core.Config.Shared.ConfigParams);

    expect(middlewares).toContain('strapi::security');
    expect(middlewares.find(isSecurityEntry)).toBeUndefined();
  });

  it('fails startup when S3 is enabled but CDN_URL is invalid', () => {
    expect(() =>
      resolveSecurityDirectives({ ...s3Environment, CDN_URL: undefined }),
    ).toThrow('CDN_URL is required');
  });
});

describe('cors middleware', () => {
  it('uses the frontend origin allowlist with credentials', () => {
    const middlewares = config({
      env: createEnv({
        ...s3Environment,
        FRONTEND_URLS: 'http://localhost:3000,https://www.salanca.example',
      }),
    } as Core.Config.Shared.ConfigParams);
    const cors = middlewares.find(isCorsEntry);

    expect(cors?.config?.credentials).toBe(true);
    expect(cors?.config?.origin).toEqual([
      'http://localhost:3000',
      'https://www.salanca.example',
    ]);
  });
});
