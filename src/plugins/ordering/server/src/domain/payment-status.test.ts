import { describe, expect, it } from 'vitest';

import { projectPaymentStatus } from './payment-status';

describe('projectPaymentStatus', () => {
  it.each([
    [{ totalAmount: 100, capturedAmount: 0, refundedAmount: 0 }, 'unpaid'],
    [{ totalAmount: 100, capturedAmount: 40, refundedAmount: 0 }, 'partially-paid'],
    [{ totalAmount: 100, capturedAmount: 100, refundedAmount: 0 }, 'paid'],
    [{ totalAmount: 100, capturedAmount: 120, refundedAmount: 0 }, 'overpaid'],
    [{ totalAmount: 100, capturedAmount: 100, refundedAmount: 30 }, 'partially-refunded'],
    [{ totalAmount: 100, capturedAmount: 100, refundedAmount: 100 }, 'refunded'],
    // No capture: nothing to refund meaningfully → unpaid.
    [{ totalAmount: 100, capturedAmount: 0, refundedAmount: 10 }, 'unpaid'],
    // Over-refund (chargeback edge) reads as fully refunded.
    [{ totalAmount: 100, capturedAmount: 100, refundedAmount: 150 }, 'refunded'],
  ])('%j → %s', (input, expected) => {
    expect(projectPaymentStatus(input)).toBe(expected);
  });
});

describe('projectPaymentStatus with canceled units', () => {
  it('is paid once captured covers the payable total', () => {
    expect(
      projectPaymentStatus({
        totalAmount: 195000,
        payableAmount: 155114,
        capturedAmount: 155114,
        refundedAmount: 0,
      }),
    ).toBe('paid');
  });

  it('stays paid, not overpaid, while a canceled share waits for its refund', () => {
    expect(
      projectPaymentStatus({
        totalAmount: 195000,
        payableAmount: 155114,
        capturedAmount: 195000,
        refundedAmount: 0,
      }),
    ).toBe('paid');
  });

  it('is partially paid below the payable total', () => {
    expect(
      projectPaymentStatus({
        totalAmount: 195000,
        payableAmount: 155114,
        capturedAmount: 100000,
        refundedAmount: 0,
      }),
    ).toBe('partially-paid');
  });
});
