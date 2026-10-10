import { describe, expect, it } from 'vitest';

import { resolveScope, scopeCondition, scopeIncludes, scopeWhere } from './scope';

describe('resolveScope', () => {
  it('grants all locations to a superadmin regardless of the row', () => {
    expect(resolveScope(null, { isSuperAdmin: true })).toEqual({ allLocations: true });
    expect(resolveScope({ allLocations: false, locationRefs: [] }, { isSuperAdmin: true })).toEqual(
      { allLocations: true },
    );
  });

  it('denies when there is no row', () => {
    expect(resolveScope(null, { isSuperAdmin: false })).toBeNull();
    expect(resolveScope(undefined, { isSuperAdmin: false })).toBeNull();
  });

  it('grants all locations when the row says so', () => {
    expect(
      resolveScope({ allLocations: true, locationRefs: [] }, { isSuperAdmin: false }),
    ).toEqual({ allLocations: true });
  });

  it('resolves a stored branch list', () => {
    expect(
      resolveScope(
        { allLocations: false, locationRefs: ['hcm-q1', 'hn-hk'] },
        { isSuperAdmin: false },
      ),
    ).toEqual({ allLocations: false, locationRefs: ['hcm-q1', 'hn-hk'] });
  });

  it('denies malformed rows instead of widening access', () => {
    for (const row of [
      { allLocations: false, locationRefs: [] },
      { allLocations: false },
      {},
      { locationRefs: 'hcm-q1' },
      { locationRefs: [''] },
      { locationRefs: ['hcm-q1', 5] },
      { locationRefs: [null] },
    ]) {
      expect(resolveScope(row, { isSuperAdmin: false })).toBeNull();
    }
  });

  it('honours allLocations only as boolean true; a truthy non-boolean keeps the stored refs', () => {
    expect(
      resolveScope({ allLocations: 'yes', locationRefs: ['hcm-q1'] }, { isSuperAdmin: false }),
    ).toEqual({ allLocations: false, locationRefs: ['hcm-q1'] });
  });
});

describe('scopeIncludes / scopeWhere / scopeCondition', () => {
  const scoped = { allLocations: false as const, locationRefs: ['hcm-q1', 'hn-hk'] };
  const all = { allLocations: true as const };

  it('checks membership', () => {
    expect(scopeIncludes(null, 'hcm-q1')).toBe(false);
    expect(scopeIncludes(all, 'anywhere')).toBe(true);
    expect(scopeIncludes(scoped, 'hcm-q1')).toBe(true);
    expect(scopeIncludes(scoped, 'dn-hh')).toBe(false);
  });

  it('builds a query filter', () => {
    expect(scopeWhere(null)).toBeNull();
    expect(scopeWhere(all)).toEqual({});
    expect(scopeWhere(scoped)).toEqual({ locationRef: { $in: ['hcm-q1', 'hn-hk'] } });
  });

  it('builds a condition predicate', () => {
    expect(scopeCondition(null)).toBe(false);
    expect(scopeCondition(all)).toBe(true);
    expect(scopeCondition(scoped)).toEqual({ locationRef: { $in: ['hcm-q1', 'hn-hk'] } });
  });
});
