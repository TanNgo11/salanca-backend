import { describe, expect, it } from 'vitest';

import { isOrderingError } from '../errors';
import { parsePromotionInput, type PromotionInput } from './schema';

const base = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: { vi: 'Giảm 10%', en: '10% off' },
  kind: 'code',
  discountType: 'percent',
  value: 10,
  maxDiscount: 30000,
  target: { kind: 'order' },
  minSubtotal: 100000,
  locationRefs: ['Q1'],
  receiveKinds: ['pickup', 'delivery'],
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-10-31T00:00:00.000Z',
  weekdays: ['mon', 'fri'],
  timeRanges: [{ start: '11:00', end: '14:00' }],
  firstOrderOnly: false,
  usageLimit: 100,
  perCustomerLimit: 1,
  stackable: true,
  priority: 5,
  active: true,
  ...overrides,
});

const invalid = (raw: Record<string, unknown>, path: string) => {
  try {
    parsePromotionInput(raw);
    expect.unreachable('should have failed');
  } catch (error) {
    expect(isOrderingError(error)).toBe(true);
    expect((error as { details?: { issues?: Array<{ path: string }> } }).details?.issues?.[0].path).toBe(
      path,
    );
  }
};

describe('parsePromotionInput', () => {
  it('accepts a percent code with a cap', () => {
    const parsed = parsePromotionInput(base());
    expect(parsed.value).toBe(10);
    expect(parsed.target).toEqual({ kind: 'order', refs: [] });
    expect(parsed.minSubtotal).toBe(100000);
  });

  it('accepts free delivery without a value and an overnight window', () => {
    const parsed = parsePromotionInput(
      base({
        kind: 'auto',
        discountType: 'free-delivery',
        value: null,
        maxDiscount: null,
        timeRanges: [{ start: '22:00', end: '02:00' }],
        target: { kind: 'categories', refs: ['cat-com'] },
      }),
    );
    expect(parsed.discountType).toBe('free-delivery');
    expect(parsed.value).toBeNull();
  });

  it('accepts a fixed amount and a delivery amount', () => {
    expect(parsePromotionInput(base({ discountType: 'amount', value: 20000, maxDiscount: null })).value).toBe(
      20000,
    );
    expect(
      parsePromotionInput(base({ discountType: 'delivery-amount', value: 15000, maxDiscount: null }))
        .discountType,
    ).toBe('delivery-amount');
  });

  it('rejects a percent outside 1–100', () => {
    invalid(base({ value: 0 }), 'value');
    invalid(base({ value: 101 }), 'value');
  });

  it('rejects an end that is not after the start', () => {
    invalid(base({ endsAt: '2026-10-01T00:00:00.000Z' }), 'endsAt');
    invalid(base({ endsAt: '2026-09-01T00:00:00.000Z' }), 'endsAt');
  });

  it('rejects an empty or impossible time range', () => {
    invalid(base({ timeRanges: [{ start: '11:00', end: '11:00' }] }), 'timeRanges');
    invalid(base({ timeRanges: [{ start: '25:00', end: '26:00' }] }), 'timeRanges.0.start');
  });

  it('requires refs only for a product or category target', () => {
    invalid(base({ target: { kind: 'products', refs: [] } }), 'target.refs');
    invalid(base({ target: { kind: 'order', refs: ['bun-bo'] } }), 'target.refs');
  });

  it('rejects a value on free delivery and a missing value on an amount', () => {
    invalid(base({ discountType: 'free-delivery', value: 1 }), 'value');
    invalid(base({ discountType: 'amount', value: null, maxDiscount: null }), 'value');
    invalid(base({ discountType: 'amount', maxDiscount: 1000 }), 'maxDiscount');
  });
});

describe('PromotionInput', () => {
  it('keeps the parsed type assignable', () => {
    const parsed: PromotionInput = parsePromotionInput(base());
    expect(parsed.kind).toBe('code');
  });
});

describe('customer groups (O16)', () => {
  it('defaults to no condition and accepts a list of group codes', () => {
    expect(parsePromotionInput(base()).customerGroups).toEqual([]);
    expect(parsePromotionInput(base({ customerGroups: ['hang-bac', 'hang-vang'] })).customerGroups).toEqual([
      'hang-bac',
      'hang-vang',
    ]);
  });

  it('rejects duplicate codes regardless of case', () => {
    invalid(base({ customerGroups: ['hang-bac', 'HANG-BAC'] }), 'customerGroups');
  });
});

describe('parsePromotionInput issue codes', () => {
  const issueOf = (raw: Record<string, unknown>) => {
    try {
      parsePromotionInput(raw);
    } catch (error) {
      const issues = (error as { details?: { issues?: Array<Record<string, unknown>> } }).details?.issues;
      return issues?.[0];
    }
    return undefined;
  };

  it('gives each rule a code (and bounds) the Admin can translate', () => {
    expect(issueOf(base({ endsAt: '2026-10-01T00:00:00.000Z' }))).toMatchObject({ path: 'endsAt', code: 'range_order' });
    expect(issueOf(base({ timeRanges: [{ start: '11:00', end: '11:00' }] }))).toMatchObject({ path: 'timeRanges', code: 'empty_range' });
    expect(issueOf(base({ target: { kind: 'order', refs: ['x'] } }))).toMatchObject({ path: 'target.refs', code: 'order_has_refs' });
    expect(issueOf(base({ target: { kind: 'products', refs: [] } }))).toMatchObject({ path: 'target.refs', code: 'no_target' });
    expect(issueOf(base({ weekdays: ['mon', 'mon'] }))).toMatchObject({ path: 'weekdays', code: 'not_unique' });
    expect(issueOf(base({ discountType: 'free-delivery', value: 5, maxDiscount: null }))).toMatchObject({ path: 'value', code: 'free_delivery_no_value' });
    expect(issueOf(base({ discountType: 'free-delivery', value: null }))).toMatchObject({ path: 'maxDiscount', code: 'free_delivery_no_cap' });
    expect(issueOf(base({ value: null }))).toMatchObject({ path: 'value', code: 'required' });
    expect(issueOf(base({ value: 101 }))).toMatchObject({ path: 'value', code: 'percent_range', min: 1, max: 100 });
    expect(issueOf(base({ discountType: 'amount', value: 20000, maxDiscount: 1000 }))).toMatchObject({ path: 'maxDiscount', code: 'cap_percent_only' });
  });
});
