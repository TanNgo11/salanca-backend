import { describe, expect, it } from 'vitest';

import { canonicalJson, hashPayload, sha256Hex } from './hashing';

describe('canonicalJson', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts nested objects but keeps array order', () => {
    expect(canonicalJson({ z: [{ b: 1, a: 2 }, { d: 4, c: 3 }] })).toBe(
      '{"z":[{"a":2,"b":1},{"c":3,"d":4}]}',
    );
  });

  it('drops undefined values', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('sha256Hex / hashPayload', () => {
  it('produces a 64-char hex digest', () => {
    expect(sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashPayload is stable across key order and differs on change', () => {
    const a = hashPayload({ lines: [{ sku: 'a', qty: 1 }], branch: 'Q1' });
    const b = hashPayload({ branch: 'Q1', lines: [{ qty: 1, sku: 'a' }] });
    expect(a).toBe(b);
    expect(hashPayload({ branch: 'Q3' })).not.toBe(a);
  });
});
