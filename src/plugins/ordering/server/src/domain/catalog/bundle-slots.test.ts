import { describe, expect, it } from 'vitest';

import { validateBundleSlotRefs, validateBundleSlots } from './bundle-slots';

const slot = (overrides = {}) => ({
  key: 'main',
  name: { vi: 'Món chính' },
  selection: 'single' as const,
  required: true,
  min: 1,
  max: 1,
  rank: 0,
  items: [{ variantRef: 'var1', quantity: 1, isDefault: true, priceDelta: 0 }],
  ...overrides,
});

describe('validateBundleSlots', () => {
  it('accepts null/undefined as empty', () => {
    expect(validateBundleSlots(null)).toEqual({ valid: true, value: [] });
    expect(validateBundleSlots(undefined).valid).toBe(true);
  });
  it('accepts a valid single-choice slot', () => {
    expect(validateBundleSlots([slot()]).valid).toBe(true);
  });
  it('rejects non-array and wrong shapes', () => {
    expect(validateBundleSlots({}).valid).toBe(false);
    expect(validateBundleSlots([{ key: 'x' }]).valid).toBe(false);
    expect(validateBundleSlots([slot({ bogus: 1 })]).valid).toBe(false);
  });
  it('rejects a single-choice slot with max > 1', () => {
    const result = validateBundleSlots([slot({ max: 3 })]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toContain('single');
  });
  it('allows a multiple slot with max > 1 and min <= max', () => {
    const result = validateBundleSlots([slot({ selection: 'multiple', min: 1, max: 3 })]);
    expect(result.valid).toBe(true);
  });
  it('rejects min > max', () => {
    expect(
      validateBundleSlots([slot({ selection: 'multiple', min: 4, max: 2 })]).valid,
    ).toBe(false);
  });
  it('rejects a required slot with min 0', () => {
    const result = validateBundleSlots([slot({ required: true, min: 0, max: 0 })]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toContain('required');
  });
  it('rejects duplicated slot keys', () => {
    const result = validateBundleSlots([slot(), slot({ name: { vi: 'Khác' } })]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toContain('duplicated');
  });
  it('rejects item quantity below 1', () => {
    const result = validateBundleSlots([
      slot({ items: [{ variantRef: 'var1', quantity: 0, isDefault: true, priceDelta: 0 }] }),
    ]);
    expect(result.valid).toBe(false);
  });
});

describe('validateBundleSlotRefs', () => {
  const variants = new Set(['var1', 'var2']);
  const slots = (refs: string[]) => [
    {
      key: 'main',
      name: {},
      selection: 'single' as const,
      required: true,
      min: 1,
      max: 1,
      rank: 0,
      items: refs.map((variantRef) => ({
        variantRef,
        quantity: 1,
        isDefault: true,
        priceDelta: 0,
      })),
    },
  ];

  it('accepts existing variant refs', () => {
    expect(validateBundleSlotRefs(slots(['var1']), variants).valid).toBe(true);
  });
  it('rejects a missing variant with its position', () => {
    const result = validateBundleSlotRefs(slots(['var9']), variants);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.details.variantRef).toBe('var9');
      expect(result.details.itemIndex).toBe(0);
    }
  });
});
