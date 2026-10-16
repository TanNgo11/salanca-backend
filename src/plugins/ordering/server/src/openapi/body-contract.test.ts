import { describe, expect, it } from 'vitest';

import { branchInputSchema } from '../domain/branch-settings';
import { settingsSchema } from '../services/ordering-settings';
import { ALERT_RULE_DEFAULTS } from '../services/alert-rules';
import { OPERATIONS } from './operations';

/**
 * The documented request bodies of the write operations must list the fields the server really
 * reads. Compared against the zod schema each controller validates with, so a field added to the
 * schema without the OpenAPI table (or the other way round) fails here instead of going stale.
 */
const bodyKeys = (method: string, path: string): string[] => {
  const op = OPERATIONS.find((item) => item.method === method && item.path === path);
  const properties = (op?.requestBody as { properties?: Record<string, unknown> } | undefined)?.properties;
  expect(properties, `${method.toUpperCase()} ${path} documents a request body`).toBeTruthy();
  return Object.keys(properties ?? {}).sort();
};

const shapeKeys = (schema: { shape: Record<string, unknown> }): string[] => Object.keys(schema.shape).sort();

describe('OpenAPI request bodies match the server schemas', () => {
  it('branch create and update', () => {
    const expected = shapeKeys(branchInputSchema);
    expect(bodyKeys('post', '/branches')).toEqual(expected);
    expect(bodyKeys('patch', '/branches/:code')).toEqual(expected);
    expect(bodyKeys('put', '/branches/:code')).toEqual(expected);
  });

  it('sales settings', () => {
    expect(bodyKeys('put', '/settings')).toEqual(shapeKeys(settingsSchema));
  });

  it('alert rules', () => {
    const op = OPERATIONS.find((item) => item.method === 'put' && item.path === '/settings/alert-rules');
    const rules = (op?.requestBody as { properties: { rules: { additionalProperties: { properties: object } } } })
      .properties.rules.additionalProperties.properties;
    const sample = Object.values(ALERT_RULE_DEFAULTS)[0];
    // `criticalThreshold` is optional, so it is absent from some defaults but always documented.
    expect(Object.keys(rules).sort()).toEqual(
      [...new Set([...Object.keys(sample), 'criticalThreshold'])].sort(),
    );
  });
});
