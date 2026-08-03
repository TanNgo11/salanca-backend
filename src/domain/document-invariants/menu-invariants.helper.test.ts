import { describe, expect, it } from 'vitest';

import { hasCategoryRelation } from './menu-invariants.helper';

describe('hasCategoryRelation', () => {
  it('accepts documentId', () => {
    expect(hasCategoryRelation({ documentId: 'abc' })).toBe(true);
  });

  it('accepts numeric id', () => {
    expect(hasCategoryRelation({ id: 3 })).toBe(true);
  });

  it('accepts connect array', () => {
    expect(hasCategoryRelation({ connect: [{ documentId: 'abc' }] })).toBe(true);
  });

  it('accepts set array', () => {
    expect(hasCategoryRelation({ set: [{ id: 1 }] })).toBe(true);
  });

  it('accepts bare string id', () => {
    expect(hasCategoryRelation('abc')).toBe(true);
  });

  it('rejects empty and missing shapes', () => {
    expect(hasCategoryRelation(undefined)).toBe(false);
    expect(hasCategoryRelation(null)).toBe(false);
    expect(hasCategoryRelation({})).toBe(false);
    expect(hasCategoryRelation({ connect: [] })).toBe(false);
    expect(hasCategoryRelation({ set: [] })).toBe(false);
    expect(hasCategoryRelation('')).toBe(false);
  });
});
