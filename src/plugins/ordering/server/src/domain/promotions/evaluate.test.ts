import { describe, expect, it } from 'vitest';

import { evaluate, type EvaluateInput, type PromotionSnapshot } from './evaluate';

const NOW = new Date('2026-10-13T04:30:00.000Z'); // Tuesday 11:30 in Asia/Ho_Chi_Minh

const promo = (overrides: Partial<PromotionSnapshot> = {}): PromotionSnapshot => ({
  id: 1,
  code: 'GIAM10',
  label: 'Giảm 10%',
  kind: 'code',
  discountType: 'percent',
  value: 10,
  maxDiscount: null,
  target: { kind: 'order', refs: [] },
  minSubtotal: 0,
  locationRefs: null,
  receiveKinds: ['pickup', 'delivery'],
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-11-01T00:00:00.000Z',
  weekdays: [],
  timeRanges: [],
  firstOrderOnly: false,
  perCustomerLimit: null,
  stackable: false,
  priority: 0,
  ...overrides,
});

const input = (overrides: Partial<EvaluateInput> = {}): EvaluateInput => ({
  now: NOW,
  timezone: 'Asia/Ho_Chi_Minh',
  locationRef: 'Q1',
  receiveKind: 'delivery',
  lines: [
    { index: 0, sellableUid: 'pho', variantUid: 'pho-tai', categoryRefs: ['noodle'], base: 100000 },
    { index: 1, sellableUid: 'tra', categoryRefs: ['drink'], base: 20000 },
  ],
  fulfillmentAmount: 25000,
  subtotal: 120000,
  candidates: [promo()],
  code: 'giam10',
  customer: { isFirstOrder: true, usedByPromotion: {} },
  ...overrides,
});

const reasons = (result: ReturnType<typeof evaluate>) => result.rejected.map((row) => row.reason);

describe('evaluate conditions', () => {
  it('applies a code that meets every condition', () => {
    const result = evaluate(input());
    expect(result.applied.map((row) => row.amount)).toEqual([-12000]);
    expect(result.applied[0].target).toEqual({ kind: 'order' });
    expect(result.rejected).toEqual([]);
  });

  it('rejects a code that has not started', () => {
    const result = evaluate(input({ candidates: [promo({ startsAt: '2026-10-20T00:00:00.000Z' })] }));
    expect(result.applied).toEqual([]);
    expect(reasons(result)).toEqual(['not-started']);
  });

  it('rejects a code that has ended', () => {
    const result = evaluate(input({ candidates: [promo({ endsAt: '2026-10-13T04:30:00.000Z' })] }));
    expect(reasons(result)).toEqual(['ended']);
  });

  it('keeps a promotion with no end date', () => {
    const result = evaluate(input({ candidates: [promo({ endsAt: null })] }));
    expect(result.applied).toHaveLength(1);
  });

  it('rejects the wrong branch and accepts every branch when refs are empty', () => {
    expect(reasons(evaluate(input({ candidates: [promo({ locationRefs: ['Q3'] })] })))).toEqual(['location']);
    expect(evaluate(input({ candidates: [promo({ locationRefs: [] })] })).applied).toHaveLength(1);
    expect(evaluate(input({ candidates: [promo({ locationRefs: null })] })).applied).toHaveLength(1);
  });

  it('rejects the wrong receive kind and accepts pickup', () => {
    expect(
      reasons(evaluate(input({ candidates: [promo({ receiveKinds: ['pickup'] })] }))),
    ).toEqual(['receive-kind']);
    expect(
      evaluate(input({ receiveKind: 'pickup', candidates: [promo({ receiveKinds: ['pickup'] })] })).applied,
    ).toHaveLength(1);
  });

  it('rejects the wrong weekday and accepts an empty weekday list', () => {
    expect(reasons(evaluate(input({ candidates: [promo({ weekdays: ['mon'] })] })))).toEqual(['time']);
    expect(evaluate(input({ candidates: [promo({ weekdays: ['tue'] })] })).applied).toHaveLength(1);
    expect(evaluate(input({ candidates: [promo({ weekdays: [] })] })).applied).toHaveLength(1);
  });

  it('rejects outside a time range and accepts inside it', () => {
    expect(
      reasons(evaluate(input({ candidates: [promo({ timeRanges: [{ start: '17:00', end: '21:00' }] })] }))),
    ).toEqual(['time']);
    expect(
      evaluate(input({ candidates: [promo({ timeRanges: [{ start: '11:00', end: '14:00' }] })] })).applied,
    ).toHaveLength(1);
  });

  it('accepts an overnight range on both sides of midnight and rejects midday', () => {
    const overnight = promo({ timeRanges: [{ start: '22:00', end: '02:00' }], kind: 'auto', code: 'P1' });
    const late = evaluate(input({ now: new Date('2026-10-13T16:30:00.000Z'), code: undefined, candidates: [overnight] }));
    const early = evaluate(input({ now: new Date('2026-10-13T18:30:00.000Z'), code: undefined, candidates: [overnight] }));
    const noon = evaluate(input({ now: NOW, code: undefined, candidates: [overnight] }));
    expect(late.applied).toHaveLength(1);
    expect(early.applied).toHaveLength(1);
    expect(noon.applied).toEqual([]);
  });

  it('rejects a repeat customer when the promotion is first-order only', () => {
    const candidate = promo({ firstOrderOnly: true });
    expect(
      reasons(evaluate(input({ candidates: [candidate], customer: { isFirstOrder: false, usedByPromotion: {} } }))),
    ).toEqual(['first-order']);
    expect(
      evaluate(input({ candidates: [candidate], customer: { isFirstOrder: true, usedByPromotion: {} } })).applied,
    ).toHaveLength(1);
  });

  it('matches a product by sellable or variant and a category by ref', () => {
    const byProduct = promo({ target: { kind: 'products', refs: ['pho'] }, discountType: 'amount', value: 5000 });
    const byVariant = promo({ target: { kind: 'products', refs: ['pho-tai'] }, discountType: 'amount', value: 5000 });
    const byCategory = promo({ target: { kind: 'categories', refs: ['drink'] }, discountType: 'amount', value: 5000 });
    const missed = promo({ target: { kind: 'products', refs: ['com'] } });
    expect(evaluate(input({ candidates: [byProduct] })).applied[0].target).toEqual({
      kind: 'lines',
      lineIndexes: [0],
    });
    expect(evaluate(input({ candidates: [byVariant] })).applied[0].amount).toBe(-5000);
    expect(evaluate(input({ candidates: [byCategory] })).applied[0].target).toEqual({
      kind: 'lines',
      lineIndexes: [1],
    });
    expect(reasons(evaluate(input({ candidates: [missed] })))).toEqual(['products']);
  });

  it('rejects a subtotal under the minimum and accepts the exact minimum', () => {
    const candidate = promo({ minSubtotal: 120000 });
    expect(reasons(evaluate(input({ subtotal: 119999, candidates: [candidate] })))).toEqual(['min-subtotal']);
    expect(evaluate(input({ subtotal: 120000, candidates: [candidate] })).applied).toHaveLength(1);
  });

  it('rejects a customer who already used their limit', () => {
    const candidate = promo({ perCustomerLimit: 1 });
    expect(
      reasons(evaluate(input({ candidates: [candidate], customer: { isFirstOrder: false, usedByPromotion: { 1: 1 } } }))),
    ).toEqual(['per-customer']);
    expect(
      evaluate(input({ candidates: [candidate], customer: { isFirstOrder: false, usedByPromotion: { 1: 0 } } }))
        .applied,
    ).toHaveLength(1);
  });
});

describe('evaluate amounts', () => {
  it('floors a percent and caps it', () => {
    const odd = evaluate(
      input({
        subtotal: 10555,
        lines: [{ index: 0, sellableUid: 'pho', categoryRefs: [], base: 10555 }],
        candidates: [promo({ value: 10 })],
      }),
    );
    expect(odd.applied[0].amount).toBe(-1055);
    const capped = evaluate(input({ candidates: [promo({ value: 50, maxDiscount: 30000 })] }));
    expect(capped.applied[0].amount).toBe(-30000);
  });

  it('prices a percent on the matching lines only', () => {
    const result = evaluate(
      input({
        candidates: [promo({ value: 10, target: { kind: 'categories', refs: ['drink'] } })],
      }),
    );
    expect(result.applied[0].amount).toBe(-2000);
  });

  it('caps a fixed amount at the target base', () => {
    const result = evaluate(
      input({
        candidates: [
          promo({
            discountType: 'amount',
            value: 50000,
            target: { kind: 'categories', refs: ['drink'] },
          }),
        ],
      }),
    );
    expect(result.applied[0].amount).toBe(-20000);
  });

  it('waives the delivery fee and skips free delivery when the fee is zero', () => {
    const free = promo({ discountType: 'free-delivery', value: null, kind: 'auto', code: 'P9' });
    expect(evaluate(input({ code: undefined, candidates: [free] })).applied[0]).toMatchObject({
      amount: -25000,
      target: { kind: 'fulfillment' },
    });
    expect(evaluate(input({ code: 'GIAM10', fulfillmentAmount: 0, candidates: [promo({ discountType: 'free-delivery', value: null })] })).rejected).toEqual([
      { code: 'GIAM10', reason: 'fulfillment' },
    ]);
  });

  it('reduces the delivery fee by a fixed amount', () => {
    const result = evaluate(
      input({
        code: undefined,
        candidates: [promo({ kind: 'auto', code: 'P2', discountType: 'delivery-amount', value: 10000 })],
      }),
    );
    expect(result.applied[0].amount).toBe(-10000);
  });
});

describe('evaluate selection', () => {
  const auto = (overrides: Partial<PromotionSnapshot>): PromotionSnapshot =>
    promo({ kind: 'auto', code: `P${overrides.id ?? 1}`, stackable: true, ...overrides });

  it('stacks two automatic promotions', () => {
    const result = evaluate(
      input({
        code: undefined,
        candidates: [
          auto({ id: 2, discountType: 'amount', value: 10000, priority: 1 }),
          auto({ id: 3, discountType: 'free-delivery', value: null, priority: 2 }),
        ],
      }),
    );
    expect(result.applied.map((row) => row.promotionId).sort()).toEqual([2, 3]);
    expect(result.applied.reduce((sum, row) => sum + row.amount, 0)).toBe(-35000);
  });

  it('prefers one non-stackable promotion when it saves more', () => {
    const result = evaluate(
      input({
        code: undefined,
        candidates: [
          auto({ id: 2, discountType: 'amount', value: 10000, stackable: true }),
          auto({ id: 4, discountType: 'amount', value: 40000, stackable: false, priority: 0 }),
        ],
      }),
    );
    expect(result.applied.map((row) => row.promotionId)).toEqual([4]);
  });

  it('keeps the stack when it saves more than the single promotion', () => {
    const result = evaluate(
      input({
        code: undefined,
        candidates: [
          auto({ id: 2, discountType: 'amount', value: 20000 }),
          auto({ id: 3, discountType: 'amount', value: 15000 }),
          auto({ id: 4, discountType: 'amount', value: 30000, stackable: false }),
        ],
      }),
    );
    expect(result.applied.map((row) => row.promotionId).sort()).toEqual([2, 3]);
  });

  it('adds a stackable code to the stack', () => {
    const result = evaluate(
      input({
        candidates: [
          promo({ stackable: true, discountType: 'amount', value: 10000 }),
          auto({ id: 5, discountType: 'free-delivery', value: null }),
        ],
      }),
    );
    expect(result.applied).toHaveLength(2);
    expect(result.rejected).toEqual([]);
  });

  it('rejects the entered code as not-best when another plan wins', () => {
    const result = evaluate(
      input({
        candidates: [
          promo({ discountType: 'amount', value: 5000, stackable: false }),
          auto({ id: 8, discountType: 'amount', value: 20000, stackable: false, priority: 1 }),
        ],
      }),
    );
    expect(result.applied.map((row) => row.promotionId)).toEqual([8]);
    expect(result.rejected).toEqual([{ code: 'GIAM10', reason: 'not-best' }]);
  });

  it('breaks a tie toward the entered code, then priority, then the smaller id', () => {
    const withCode = evaluate(
      input({
        candidates: [
          promo({ id: 9, discountType: 'amount', value: 10000, priority: 0, stackable: false }),
          auto({ id: 3, discountType: 'amount', value: 10000, priority: 5, stackable: false }),
        ],
      }),
    );
    expect(withCode.applied.map((row) => row.promotionId)).toEqual([9]);

    const byPriority = evaluate(
      input({
        code: undefined,
        candidates: [
          auto({ id: 3, discountType: 'amount', value: 10000, priority: 1, stackable: false }),
          auto({ id: 2, discountType: 'amount', value: 10000, priority: 4, stackable: false }),
        ],
      }),
    );
    expect(byPriority.applied.map((row) => row.promotionId)).toEqual([2]);

    const byId = evaluate(
      input({
        code: undefined,
        candidates: [
          auto({ id: 6, discountType: 'amount', value: 10000, priority: 2, stackable: false }),
          auto({ id: 4, discountType: 'amount', value: 10000, priority: 2, stackable: false }),
        ],
      }),
    );
    expect(byId.applied.map((row) => row.promotionId)).toEqual([4]);
  });

  it('drops the lower-priority stackable promotion when the pair would exceed the subtotal', () => {
    const result = evaluate(
      input({
        code: undefined,
        subtotal: 100000,
        lines: [{ index: 0, sellableUid: 'pho', categoryRefs: [], base: 100000 }],
        fulfillmentAmount: 0,
        candidates: [
          auto({ id: 2, discountType: 'percent', value: 60, priority: 1 }),
          auto({ id: 3, discountType: 'percent', value: 60, priority: 5 }),
        ],
      }),
    );
    expect(result.applied.map((row) => row.promotionId)).toEqual([3]);
    expect(result.applied[0].amount).toBe(-60000);
  });

  it('stays quiet about an automatic promotion that does not match', () => {
    const result = evaluate(
      input({
        code: undefined,
        candidates: [auto({ id: 2, locationRefs: ['Q9'], discountType: 'amount', value: 1000 })],
      }),
    );
    expect(result).toEqual({ applied: [], rejected: [] });
  });

  it('reports an unknown code without applying anything else as that code', () => {
    const result = evaluate(input({ code: 'NOPE', candidates: [auto({ id: 2, discountType: 'amount', value: 1000 })] }));
    expect(result.rejected).toEqual([{ code: 'NOPE', reason: 'invalid' }]);
    expect(result.applied.map((row) => row.promotionId)).toEqual([2]);
  });

  it('caps a delivery amount at the fee', () => {
    const result = evaluate(
      input({
        code: undefined,
        fulfillmentAmount: 8000,
        candidates: [promo({ kind: 'auto', code: 'P4', discountType: 'delivery-amount', value: 15000 })],
      }),
    );
    expect(result.applied[0].amount).toBe(-8000);
  });

  it('matches the entered code without regard to case', () => {
    const result = evaluate(input({ code: 'Giam10' }));
    expect(result.applied[0].code).toBe('GIAM10');
  });

  it('still applies an automatic promotion when the entered code is expired', () => {
    const result = evaluate(
      input({
        candidates: [
          promo({ endsAt: '2026-10-02T00:00:00.000Z' }),
          promo({ id: 4, kind: 'auto', code: 'P4', discountType: 'amount', value: 1000, stackable: true }),
        ],
      }),
    );
    expect(result.applied.map((row) => row.code)).toEqual(['P4']);
    expect(result.rejected).toEqual([{ code: 'GIAM10', reason: 'ended' }]);
  });

  it('is deterministic for the same input', () => {
    const same = input();
    expect(evaluate(same)).toEqual(evaluate(same));
  });
});

describe('digital (gift-card) carts', () => {
  const digitalPromo = (target: PromotionSnapshot['target']) =>
    promo({ receiveKinds: ['digital'], target });
  it('rejects an order-wide promotion even when it declares digital', () => {
    const result = evaluate(
      input({ receiveKind: 'digital', fulfillmentAmount: 0, candidates: [digitalPromo({ kind: 'order', refs: [] })] }),
    );
    expect(result.applied).toEqual([]);
    expect(reasons(result)).toEqual(['receive-kind']);
  });

  it('keeps a promotion aimed at the card products', () => {
    const result = evaluate(
      input({
        receiveKind: 'digital',
        fulfillmentAmount: 0,
        candidates: [digitalPromo({ kind: 'products', refs: ['pho'] })],
      }),
    );
    expect(result.applied.map((row) => row.amount)).toEqual([-10000]);
  });
});
