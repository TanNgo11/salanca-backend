import { describe, expect, it } from 'vitest';

import { type ChainRow, GENESIS_HASH, canonicalJson, rowHash } from './chain';

const row = (overrides: Partial<ChainRow> = {}): ChainRow => ({
  id: 1,
  actorRef: 'admin:1',
  action: 'refund.create',
  entityType: 'refund',
  entityId: '7',
  locationRef: 'Q1',
  occurredAt: '2026-10-12T05:00:00.000Z',
  changes: { amount: { before: null, after: 30000 } },
  category: 'money',
  entityLabel: null,
  orderId: 42,
  requestId: 'r-1',
  ...overrides,
});

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] }, x: undefined })).toBe(
      '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
    );
  });
});

describe('rowHash', () => {
  it('is stable across key order, Date vs ISO string and JSON-string changes', () => {
    const a = rowHash(GENESIS_HASH, row());
    const b = rowHash(
      GENESIS_HASH,
      row({
        occurredAt: new Date('2026-10-12T05:00:00.000Z'),
        changes: JSON.stringify({ amount: { after: 30000, before: null } }),
      }),
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any content, the id or the previous hash changes', () => {
    const base = rowHash(GENESIS_HASH, row());
    expect(rowHash(GENESIS_HASH, row({ changes: { amount: { before: null, after: 30001 } } }))).not.toBe(base);
    expect(rowHash(GENESIS_HASH, row({ actorRef: 'admin:2' }))).not.toBe(base);
    expect(rowHash(GENESIS_HASH, row({ id: 2 }))).not.toBe(base);
    expect(rowHash('other', row())).not.toBe(base);
  });
});
