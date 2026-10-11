import { describe, expect, it } from 'vitest';

import { matchTransfer, type MatchInput, type MatchOrder } from './match';

const order = (overrides: Partial<MatchOrder> = {}): MatchOrder => ({
  code: 'SLC-000124',
  locationRef: 'Q1',
  status: 'awaiting-payment',
  totalAmount: 175_000,
  capturedAmount: 0,
  ...overrides,
});

const base = (overrides: Partial<MatchInput> = {}): MatchInput => ({
  transferType: 'in',
  orderCode: 'SLC-000124',
  order: order(),
  amount: 175_000,
  amountTolerance: 0,
  accountBelongsToBranch: true,
  captureMode: 'auto',
  ...overrides,
});

describe('matchTransfer', () => {
  it('auto-matches when every condition holds', () => {
    expect(matchTransfer(base())).toEqual({
      outcome: 'auto-matched',
      orderCode: 'SLC-000124',
      dueAmount: 175_000,
    });
  });

  it('auto-matches a coded top-up of the remaining amount', () => {
    const decision = matchTransfer(
      base({
        order: order({ capturedAmount: 100_000 }),
        amount: 75_000,
      }),
    );
    expect(decision).toMatchObject({ outcome: 'auto-matched', dueAmount: 75_000 });
  });

  it('treats an amount inside the tolerance as a match', () => {
    expect(matchTransfer(base({ amount: 174_000, amountTolerance: 1_000 })).outcome).toBe('auto-matched');
    expect(matchTransfer(base({ amount: 176_000, amountTolerance: 1_000 })).outcome).toBe('auto-matched');
  });

  it.each([
    ['no-code', base({ orderCode: null, order: null, accountBelongsToBranch: false })],
    ['order-not-found', base({ orderCode: 'SLC-999999', order: null })],
    ['underpaid', base({ amount: 174_999 })],
    ['overpaid', base({ amount: 175_001 })],
    ['order-closed', base({ order: order({ status: 'canceled' }) })],
    ['order-closed', base({ order: order({ status: 'expired' }), amount: 1 })],
    ['already-paid', base({ order: order({ capturedAmount: 175_000 }) })],
    ['account-mismatch', base({ accountBelongsToBranch: false })],
  ] as const)('needs review: %s', (reason, input) => {
    const decision = matchTransfer(input);
    expect(decision).toMatchObject({ outcome: 'needs-review', reviewReason: reason });
  });

  it('holds a perfect match when capture mode is review-all', () => {
    expect(matchTransfer(base({ captureMode: 'review-all' }))).toMatchObject({
      outcome: 'needs-review',
      reviewReason: 'review-all',
    });
  });

  it('ignores money leaving the account', () => {
    expect(matchTransfer(base({ transferType: 'out' }))).toEqual({ outcome: 'ignored' });
  });

  it('reports no-code before an unknown account, and account-mismatch before a closed order', () => {
    expect(matchTransfer(base({ orderCode: null, order: order(), accountBelongsToBranch: false }))).toMatchObject({
      reviewReason: 'no-code',
    });
    expect(
      matchTransfer(base({ order: order({ status: 'rejected' }), accountBelongsToBranch: false })),
    ).toMatchObject({ reviewReason: 'account-mismatch' });
  });

  it('reports underpaid just outside the tolerance', () => {
    expect(matchTransfer(base({ amount: 173_999, amountTolerance: 1_000 }))).toMatchObject({
      reviewReason: 'underpaid',
    });
    expect(matchTransfer(base({ amount: 176_001, amountTolerance: 1_000 }))).toMatchObject({
      reviewReason: 'overpaid',
    });
  });
});
