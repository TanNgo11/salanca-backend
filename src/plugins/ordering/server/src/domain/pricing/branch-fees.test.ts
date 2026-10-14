import { describe, expect, it } from 'vitest';

import {
  branchFeeAdjustments,
  branchFeeAmount,
  discountedMerchandise,
} from './branch-fees';
import type { BranchFee } from '../branch-settings';

const fee = (overrides: Partial<BranchFee>): BranchFee => ({
  code: 'phuc-vu',
  label: { vi: 'Phí phục vụ', en: 'Service fee' },
  kind: 'service',
  receiveKinds: ['pickup'],
  taxable: true,
  ...overrides,
}) as BranchFee;

describe('discountedMerchandise', () => {
  it('subtracts fixed discounts on the order and selected lines only', () => {
    const bases = [100_000, 50_000];
    const adjustments = [
      { kind: 'discount' as const, amount: -30_000 },
      { kind: 'discount' as const, amount: -10_000, target: { kind: 'lines' as const, lineIndexes: [1] } },
      { kind: 'discount' as const, amount: -20_000, target: { kind: 'fulfillment' as const } },
      { kind: 'fee' as const, amount: 7_500 },
    ];
    // 150_000 − 30_000 − 10_000; the fulfillment discount and the fee stay out.
    expect(discountedMerchandise(bases, adjustments)).toBe(110_000);
  });

  it('resolves percent discounts on their own target base', () => {
    const bases = [100_000, 100_000];
    const adjustments = [
      { kind: 'discount' as const, percent: 10 }, // −20_000 on the whole order
      { kind: 'discount' as const, percent: 50, target: { kind: 'lines' as const, lineIndexes: [0] } },
    ];
    expect(discountedMerchandise(bases, adjustments)).toBe(130_000);
  });
});

describe('branchFeeAmount', () => {
  it('prices a percent fee on the discounted subtotal', () => {
    expect(
      branchFeeAmount(fee({ percent: 5 }), {
        receiveKind: 'pickup',
        merchandiseSubtotal: 200_000,
        discountedSubtotal: 180_000,
      }),
    ).toBe(9_000);
  });

  it('returns a flat fee as configured', () => {
    expect(
      branchFeeAmount(fee({ amount: 15_000, percent: undefined }), {
        receiveKind: 'pickup',
        merchandiseSubtotal: 200_000,
        discountedSubtotal: 180_000,
      }),
    ).toBe(15_000);
  });

  it('skips receive kinds the fee does not cover', () => {
    expect(
      branchFeeAmount(fee({ percent: 5, receiveKinds: ['delivery'] }), {
        receiveKind: 'pickup',
        merchandiseSubtotal: 200_000,
        discountedSubtotal: 180_000,
      }),
    ).toBeNull();
  });

  it('skips orders below minSubtotal (checked on the pre-discount merchandise)', () => {
    const args = { receiveKind: 'pickup', merchandiseSubtotal: 90_000, discountedSubtotal: 80_000 };
    expect(branchFeeAmount(fee({ percent: 5, minSubtotal: 100_000 }), args)).toBeNull();
    expect(
      branchFeeAmount(fee({ percent: 5, minSubtotal: 90_000 }), args),
    ).toBe(4_000);
  });

  it('never prices a negative percent base', () => {
    expect(
      branchFeeAmount(fee({ percent: 5 }), {
        receiveKind: 'pickup',
        merchandiseSubtotal: 100_000,
        discountedSubtotal: -5_000,
      }),
    ).toBe(0);
  });
});

describe('branchFeeAdjustments', () => {
  it('emits fee adjustments with the recompute snapshot', () => {
    const [adjustment] = branchFeeAdjustments([fee({ percent: 5 })], {
      receiveKind: 'pickup',
      merchandiseSubtotal: 200_000,
      discountedSubtotal: 180_000,
      labelFor: (f) => f.label.vi,
    });
    expect(adjustment).toMatchObject({
      kind: 'fee',
      code: 'phuc-vu',
      label: 'Phí phục vụ',
      amount: 9_000,
      sourceRef: 'fee:phuc-vu',
      ruleSnapshot: { branchFee: { percent: 5, amount: null, minSubtotal: null } },
    });
  });
});
