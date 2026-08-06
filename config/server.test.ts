import type { Core } from '@strapi/strapi';
import { describe, expect, it } from 'vitest';

import config from './server';

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

  env.int = (key: string, fallback?: number): number => {
    const value = values[key];
    return value === undefined ? (fallback ?? 0) : Number.parseInt(value, 10);
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

const baseEnvironment: EnvironmentValues = {
  APP_KEYS: 'key-1,key-2',
};

const buildServerConfig = (values: EnvironmentValues = {}) =>
  config({ env: createEnv({ ...baseEnvironment, ...values }) } as Core.Config.Shared.ConfigParams);

describe('server config', () => {
  it('does not trust proxy headers by default', () => {
    /*
     * The default must stay false: with Strapi internet-facing, trusting
     * X-Forwarded-For lets a client rotate the header and bypass the
     * public-form rate limiters entirely.
     */
    expect(buildServerConfig().proxy).toEqual({ koa: false });
  });

  it('trusts proxy headers when KOA_TRUST_PROXY is true', () => {
    expect(buildServerConfig({ KOA_TRUST_PROXY: 'true' }).proxy).toEqual({ koa: true });
  });

  it('keeps host, port and app keys wired to env', () => {
    const resolved = buildServerConfig({ HOST: '127.0.0.1', PORT: '1338' });

    expect(resolved.host).toBe('127.0.0.1');
    expect(resolved.port).toBe(1338);
    expect(resolved.app?.keys).toEqual(['key-1', 'key-2']);
  });
});
