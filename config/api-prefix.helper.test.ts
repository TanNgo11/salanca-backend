import type { Core } from '@strapi/strapi';
import { describe, expect, it } from 'vitest';

import { resolveRestApiPrefix } from './api-prefix.helper';

const createEnv = (value: string | undefined): Core.Config.Shared.ConfigParams['env'] => {
  const env = ((key: string, fallback?: string): string | undefined =>
    key === 'API_REST_PREFIX' ? (value ?? fallback) : fallback) as Core.Config.Shared.ConfigParams['env'];

  return env;
};

describe('resolveRestApiPrefix', () => {
  it('accepts a versioned lowercase prefix', () => {
    expect(resolveRestApiPrefix(createEnv('/api/v1'))).toBe('/api/v1');
  });

  it('uses the project API prefix when the environment value is absent', () => {
    expect(resolveRestApiPrefix(createEnv(undefined))).toBe('/api/v1');
  });

  it.each(['', 'api/v1', '/api/v1/', '/API/v1', '/api_v1'])(
    'rejects invalid prefix %s',
    (value) => {
      expect(() => resolveRestApiPrefix(createEnv(value))).toThrow(
        'API_REST_PREFIX must start with /',
      );
    },
  );
});
