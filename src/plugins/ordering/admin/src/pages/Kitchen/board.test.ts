import { describe, expect, it } from 'vitest';

import { boardFrom } from './board';

describe('boardFrom', () => {
  it('unwraps the { item } envelope the kitchen route answers with', () => {
    expect(boardFrom({ item: { orders: [{ id: 1 }] } })).toEqual({ orders: [{ id: 1 }] });
  });
  it('rejects the flat shape so contract drift fails loudly instead of showing an empty board', () => {
    expect(boardFrom({ orders: [{ id: 1 }] })).toBeNull();
  });
  it('rejects null and non-array orders', () => {
    expect(boardFrom(null)).toBeNull();
    expect(boardFrom({ item: { orders: 'x' } })).toBeNull();
  });
});
