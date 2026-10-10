import { describe, expect, it } from 'vitest';

import config from './index';

const valid = () => structuredClone(config.default);

describe('ordering plugin config validator', () => {
  it('accepts the plugin defaults', () => {
    expect(() => config.validator(valid())).not.toThrow();
  });

  it('accepts providers keyed by code', () => {
    const value = valid();
    value.providers.payment = { sepay: { enabled: true, webhookSecret: 'x' }, cash: { enabled: true } } as never;
    expect(() => config.validator(value)).not.toThrow();
  });

  it('rejects a currency other than VND with the field path', () => {
    expect(() => config.validator({ ...valid(), currency: 'USD' })).toThrow(/currency/);
  });

  it('rejects providers given as an array', () => {
    const value = valid() as Record<string, unknown>;
    value.providers = { ...(value.providers as object), payment: [{ enabled: true }] };
    expect(() => config.validator(value)).toThrow(/providers\.payment/);
  });

  it('rejects an invalid business-day cutoff', () => {
    const value = valid();
    value.businessDay.cutoffLocalTime = '24:00';
    expect(() => config.validator(value)).toThrow(/businessDay\.cutoffLocalTime/);
  });

  it('rejects testing.builtins in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const value = valid();
      value.testing.builtins = true;
      expect(() => config.validator(value)).toThrow(/testing\.builtins/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
