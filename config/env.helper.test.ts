import type { Core } from '@strapi/strapi';
import { describe, expect, it } from 'vitest';

import {
  isValidEmailAddress,
  requireEmailAddress,
  requireEnvValue,
} from './env.helper';

type EnvironmentValues = Readonly<Record<string, string | boolean | undefined>>;

const createEnv = (values: EnvironmentValues): Core.Config.Shared.ConfigParams['env'] => {
  const env = ((key: string, fallback?: string): string | undefined => {
    const value = values[key];
    return typeof value === 'string' ? value : fallback;
  }) as Core.Config.Shared.ConfigParams['env'];

  env.bool = (key: string, fallback?: boolean): boolean => {
    const value = values[key];
    return typeof value === 'boolean' ? value : (fallback ?? false);
  };

  return env;
};

describe('requireEnvValue', () => {
  it('returns a trimmed value', () => {
    expect(requireEnvValue(createEnv({ FOO: '  bar  ' }), 'FOO')).toBe('bar');
  });

  it('names the missing key and never echoes other env values', () => {
    try {
      requireEnvValue(createEnv({ SECRET: 'super-secret' }), 'MISSING');
      expect.unreachable('expected a validation error');
    } catch (error) {
      expect(String(error)).toContain('MISSING is required');
      expect(String(error)).not.toContain('super-secret');
    }
  });
});

describe('requireEmailAddress', () => {
  it('lowercases a valid address', () => {
    expect(requireEmailAddress(createEnv({ EMAIL: '  Admin@Example.COM ' }), 'EMAIL')).toBe(
      'admin@example.com',
    );
  });

  it('rejects a non-address without echoing the value as a secret leak risk', () => {
    expect(() => requireEmailAddress(createEnv({ EMAIL: 'not-an-email' }), 'EMAIL')).toThrow(
      'EMAIL must be a single valid email address',
    );
  });
});

describe('isValidEmailAddress', () => {
  it.each(['a@b.co', 'nguoi.dung@example.com'])('accepts %s', (value) => {
    expect(isValidEmailAddress(value)).toBe(true);
  });

  it.each(['', 'nope', 'a@b', '@example.com'])('rejects %j', (value) => {
    expect(isValidEmailAddress(value)).toBe(false);
  });
});
