import { describe, expect, it } from 'vitest';

import { validateModifierGroupRefs } from './modifier-groups';
import {
  type ModifierLibrary,
  validateModifierGroups,
} from '../../../../shared/catalog/modifier-groups';

const validGroup = (overrides = {}) => ({
  groupRef: 'grp1',
  required: false,
  min: 0,
  max: 0,
  freeQuantity: 0,
  rank: 0,
  overrides: {},
  ...overrides,
});

describe('validateModifierGroups', () => {
  it('accepts null/undefined as empty', () => {
    expect(validateModifierGroups(null)).toEqual({ valid: true, value: [] });
    expect(validateModifierGroups(undefined).valid).toBe(true);
  });
  it('accepts a valid group with overrides', () => {
    const result = validateModifierGroups([
      validGroup({ overrides: { mod1: { priceDelta: 25000, isDefault: true } } }),
    ]);
    expect(result.valid).toBe(true);
  });
  it('rejects non-array input', () => {
    expect(validateModifierGroups({ groupRef: 'x' }).valid).toBe(false);
    expect(validateModifierGroups('x').valid).toBe(false);
  });
  it('rejects missing required keys and unknown keys', () => {
    expect(validateModifierGroups([{ groupRef: 'g' }]).valid).toBe(false);
    expect(validateModifierGroups([validGroup({ bogus: 1 })]).valid).toBe(false);
  });
  it('rejects min > max (max 0 means unlimited and skips the rule)', () => {
    expect(validateModifierGroups([validGroup({ min: 3, max: 2 })]).valid).toBe(false);
    expect(validateModifierGroups([validGroup({ min: 0, max: 0 })]).valid).toBe(true);
  });
  it('rejects a duplicated groupRef', () => {
    const result = validateModifierGroups([validGroup(), validGroup()]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toContain('duplicated');
  });
  it('rejects non-integer priceDelta overrides', () => {
    const result = validateModifierGroups([
      validGroup({ overrides: { m: { priceDelta: 1.5 } } }),
    ]);
    expect(result.valid).toBe(false);
  });
});

describe('validateModifierGroupRefs', () => {
  const library: ModifierLibrary = {
    groupDocumentIds: new Set(['grp1']),
    modifierDocumentIdsByGroup: new Map([['grp1', new Set(['mod1', 'mod2'])]]),
  };
  const groups = (overrides: Record<string, unknown>) => [
    {
      groupRef: 'grp1',
      required: false,
      min: 0,
      max: 0,
      freeQuantity: 0,
      rank: 0,
      overrides,
    } as never,
  ];

  it('accepts overrides on modifiers inside the group', () => {
    expect(validateModifierGroupRefs(groups({ mod1: { priceDelta: 1000 } }), library).valid).toBe(
      true,
    );
  });
  it('rejects an unknown group', () => {
    const result = validateModifierGroupRefs(
      [{ groupRef: 'nope', required: false, min: 0, max: 0, freeQuantity: 0, rank: 0, overrides: {} } as never],
      library,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.details.groupRef).toBe('nope');
  });
  it('rejects a modifier outside the group', () => {
    const result = validateModifierGroupRefs(groups({ mod3: { hidden: true } }), library);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.details.modifierRef).toBe('mod3');
  });
});
