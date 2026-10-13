import { describe, expect, it } from 'vitest';

import {
  applyAdjustLists,
  type AdjustList,
  type CatalogPriceRow,
  explainPrice,
  priceChannelOf,
  selectCatalogPrice,
} from './price-selection';

const row = (overrides: Partial<CatalogPriceRow> = {}): CatalogPriceRow => ({
  amount: 50000,
  currency: 'VND',
  ...overrides,
});

const at = new Date('2026-10-10T12:00:00Z');
const TZ = 'Asia/Ho_Chi_Minh';
/** Tuesday 11:30 in Asia/Ho_Chi_Minh. */
const TUE_1130 = new Date('2026-10-13T04:30:00.000Z');
/** Tuesday 15:00 in Asia/Ho_Chi_Minh. */
const TUE_1500 = new Date('2026-10-13T08:00:00.000Z');
/** Tuesday 18:00 in Asia/Ho_Chi_Minh. */
const TUE_1800 = new Date('2026-10-13T11:00:00.000Z');
/** Tuesday 23:30 in Asia/Ho_Chi_Minh. */
const TUE_2330 = new Date('2026-10-13T16:30:00.000Z');
/** Wednesday 01:00 in Asia/Ho_Chi_Minh. */
const WED_0100 = new Date('2026-10-13T18:00:00.000Z');

const happyHour = (amount: number, extra: Partial<CatalogPriceRow> = {}): CatalogPriceRow =>
  row({
    amount,
    rules: {
      weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      timeRanges: [{ start: '14:00', end: '17:00' }],
    },
    ...extra,
  });

const adjust = (overrides: Partial<AdjustList> = {}): AdjustList => ({
  id: 'happy',
  name: 'Happy hour đồ uống',
  priority: 10,
  active: true,
  adjust: { type: 'percent', value: 20, target: { kind: 'categories', refs: ['drink'] } },
  ...overrides,
});

describe('selectCatalogPrice', () => {
  it('returns the only base row', () => {
    const result = selectCatalogPrice([row()], { at });
    expect(result).toMatchObject({ amount: 50000, currency: 'VND', matchedRules: [] });
  });
  it('parses bigint amounts from the database', () => {
    const result = selectCatalogPrice([row({ amount: '65000' })], { at });
    expect(result?.amount).toBe(65000);
  });
  it('returns null for an empty list', () => {
    expect(selectCatalogPrice([], { at })).toBeNull();
  });
  it('drops rows outside the valid window', () => {
    const rows = [
      row({ amount: 100, validFrom: '2026-10-01', validTo: '2026-10-05' }),
      row({ amount: 200, validFrom: '2026-10-20' }),
      row({ amount: 300, validTo: '2026-10-01' }),
    ];
    expect(selectCatalogPrice(rows, { at })).toBeNull();
  });
  it('keeps rows whose window covers the instant', () => {
    const rows = [
      row({ amount: 55000, validFrom: '2026-10-01', validTo: '2026-10-31' }),
      row({ amount: 60000 }),
    ];
    const result = selectCatalogPrice(rows, { at });
    expect(result?.amount).toBe(55000);
  });
  it('a location rule only matches that location', () => {
    const rows = [row({ amount: 70000, rules: { locationRef: 'Q1' } }), row({ amount: 65000 })];
    expect(selectCatalogPrice(rows, { at, locationRef: 'Q1' })?.amount).toBe(70000);
    expect(selectCatalogPrice(rows, { at, locationRef: 'Q3' })?.amount).toBe(65000);
    expect(selectCatalogPrice(rows, { at })?.amount).toBe(65000);
  });
  it('more matched rule keys beats priority', () => {
    const rows = [
      row({ amount: 90000, rules: { channel: 'web' }, priority: 100 }),
      row({ amount: 80000, rules: { locationRef: 'Q1', channel: 'web' } }),
    ];
    const result = selectCatalogPrice(rows, { at, locationRef: 'Q1', channel: 'web' });
    expect(result?.amount).toBe(80000);
    expect(result?.matchedRules).toEqual(['locationRef', 'channel']);
  });
  it('priority breaks equal specificity', () => {
    const rows = [row({ amount: 100, priority: 1 }), row({ amount: 200, priority: 5 })];
    expect(selectCatalogPrice(rows, { at })?.amount).toBe(200);
  });
  it('higher minQuantity is more specific when quantity qualifies', () => {
    const rows = [row({ amount: 100 }), row({ amount: 90, minQuantity: 5 })];
    expect(selectCatalogPrice(rows, { at, quantity: 10 })?.amount).toBe(90);
    expect(selectCatalogPrice(rows, { at, quantity: 2 })?.amount).toBe(100);
  });
  it('a rule the context cannot satisfy disqualifies the row', () => {
    const rows = [row({ amount: 100, rules: { customerGroup: 'vip' } }), row({ amount: 200 })];
    expect(selectCatalogPrice(rows, { at })?.amount).toBe(200);
  });
  it('exposes compareAtAmount when set', () => {
    const result = selectCatalogPrice([row({ amount: 45000, compareAtAmount: '59000' })], { at });
    expect(result?.compareAtAmount).toBe(59000);
  });

  it('prices pickup, delivery and dine-in apart from each other', () => {
    const rows = [
      row({ amount: 65000 }),
      row({ amount: 70000, rules: { channel: 'delivery' } }),
      row({ amount: 60000, rules: { channel: 'pickup' } }),
      row({ amount: 55000, rules: { channel: 'dine-in' } }),
    ];
    expect(selectCatalogPrice(rows, { at, channel: 'delivery' })?.amount).toBe(70000);
    expect(selectCatalogPrice(rows, { at, channel: 'pickup' })?.amount).toBe(60000);
    expect(selectCatalogPrice(rows, { at, channel: 'dine-in' })?.amount).toBe(55000);
    expect(selectCatalogPrice(rows, { at, channel: 'staff' })?.amount).toBe(65000);
  });

  it('treats a legacy web-checkout rule as no channel and phone-staff as staff', () => {
    const rows = [
      row({ amount: 65000, rules: { channel: 'web-checkout' } }),
      row({ amount: 40000, rules: { channel: 'phone-staff' } }),
    ];
    expect(selectCatalogPrice(rows, { at, channel: 'pickup' })?.amount).toBe(65000);
    expect(selectCatalogPrice(rows, { at, channel: 'staff' })?.amount).toBe(40000);
    expect(selectCatalogPrice(rows, { at, channel: 'staff' })?.matchedRules).toEqual(['channel']);
  });

  it('matches a customer group and ignores it for a guest', () => {
    const rows = [row({ amount: 45000, rules: { customerGroup: 'thanh-vien' } }), row({ amount: 65000 })];
    expect(selectCatalogPrice(rows, { at, customerGroups: ['thanh-vien'] })?.amount).toBe(45000);
    expect(selectCatalogPrice(rows, { at, customerGroups: [] })?.amount).toBe(65000);
    expect(selectCatalogPrice(rows, { at })?.amount).toBe(65000);
  });

  it('gives a customer in several groups the lowest matching price', () => {
    const rows = [
      row({ amount: 80000, rules: { customerGroup: 'nhan-vien' } }),
      row({ amount: 70000, rules: { customerGroup: 'thanh-vien' } }),
      row({ amount: 90000 }),
    ];
    const result = selectCatalogPrice(rows, { at, customerGroups: ['nhan-vien', 'thanh-vien'] });
    expect(result?.amount).toBe(70000);
    expect(result?.matchedRules).toEqual(['customerGroup']);
  });

  it('does not let a cheaper group beat a more specific row', () => {
    const rows = [
      row({ amount: 50000, rules: { customerGroup: 'vip', locationRef: 'Q1' } }),
      row({ amount: 10000, rules: { customerGroup: 'staff' } }),
    ];
    expect(
      selectCatalogPrice(rows, { at, locationRef: 'Q1', customerGroups: ['vip', 'staff'] })?.amount,
    ).toBe(50000);
  });

  it('applies a weekday and time range on the branch clock', () => {
    const rows = [happyHour(52000), row({ amount: 65000 })];
    expect(selectCatalogPrice(rows, { at: TUE_1500, timezone: TZ })?.amount).toBe(52000);
    expect(selectCatalogPrice(rows, { at: TUE_1800, timezone: TZ })?.amount).toBe(65000);
    expect(selectCatalogPrice(rows, { at: TUE_1130, timezone: TZ })?.amount).toBe(65000);
  });

  it('rejects a happy-hour row when the timezone is missing', () => {
    expect(selectCatalogPrice([happyHour(52000), row({ amount: 65000 })], { at: TUE_1500 })?.amount).toBe(65000);
  });

  it('keeps the end of a time range exclusive', () => {
    const rows = [happyHour(52000), row({ amount: 65000 })];
    const at1700 = new Date('2026-10-13T10:00:00.000Z');
    expect(selectCatalogPrice(rows, { at: at1700, timezone: TZ })?.amount).toBe(65000);
  });

  it('matches an overnight range on both sides of midnight', () => {
    const rows = [
      row({ amount: 30000, rules: { timeRanges: [{ start: '22:00', end: '02:00' }] } }),
      row({ amount: 45000 }),
    ];
    expect(selectCatalogPrice(rows, { at: TUE_2330, timezone: TZ })?.amount).toBe(30000);
    expect(selectCatalogPrice(rows, { at: WED_0100, timezone: TZ })?.amount).toBe(30000);
    expect(selectCatalogPrice(rows, { at: TUE_1500, timezone: TZ })?.amount).toBe(45000);
  });

  it('skips Saturday when the row is weekdays only', () => {
    const saturday = new Date('2026-10-17T08:00:00.000Z');
    const rows = [happyHour(52000), row({ amount: 65000 })];
    expect(selectCatalogPrice(rows, { at: saturday, timezone: TZ })?.amount).toBe(65000);
  });

  it('counts weekdays and time ranges toward specificity', () => {
    const rows = [
      row({ amount: 60000, rules: { channel: 'pickup' }, priority: 50 }),
      happyHour(52000, { rules: { channel: 'pickup', weekdays: ['tue'], timeRanges: [{ start: '14:00', end: '17:00' }] } }),
    ];
    const result = selectCatalogPrice(rows, { at: TUE_1500, timezone: TZ, channel: 'pickup' });
    expect(result?.amount).toBe(52000);
    expect(result?.matchedRules).toEqual(['channel', 'weekdays', 'timeRanges']);
  });

  it('drops an inactive override row and falls back to the base price', () => {
    const rows = [
      row({ amount: 40000, rules: { channel: 'pickup' }, priceList: { active: false } }),
      row({ amount: 65000 }),
    ];
    expect(selectCatalogPrice(rows, { at, channel: 'pickup' })?.amount).toBe(65000);
  });

  it('keeps an active override row', () => {
    const rows = [
      row({ amount: 40000, rules: { channel: 'pickup' }, priceList: { active: true } }),
      row({ amount: 65000 }),
    ];
    expect(selectCatalogPrice(rows, { at, channel: 'pickup' })?.amount).toBe(40000);
  });
});

describe('applyAdjustLists', () => {
  const base = { amount: 65000, currency: 'VND', matchedRules: [] as string[] };
  const drink = { productRef: 'tra', variantRef: 'tra-ly', categoryRefs: ['drink'] };
  const food = { productRef: 'bun', variantRef: 'bun-to', categoryRefs: ['food'] };

  it('takes 20% off a drink during happy hour and floors to the đồng', () => {
    const list = adjust({
      rules: { weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], timeRanges: [{ start: '14:00', end: '17:00' }] },
    });
    const result = applyAdjustLists(base, [list], drink, { at: TUE_1500, timezone: TZ });
    expect(result.amount).toBe(52000);
    expect(result.compareAtAmount).toBe(65000);
    expect(result.priceListId).toBe('happy');
  });

  it('leaves the base price outside the window and off-target', () => {
    const list = adjust({
      rules: { weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], timeRanges: [{ start: '14:00', end: '17:00' }] },
    });
    expect(applyAdjustLists(base, [list], drink, { at: TUE_1800, timezone: TZ }).amount).toBe(65000);
    expect(applyAdjustLists(base, [list], food, { at: TUE_1500, timezone: TZ }).amount).toBe(65000);
    expect(applyAdjustLists(base, [adjust({ active: false })], drink, { at: TUE_1500, timezone: TZ })).toEqual(base);
  });

  it('never goes below zero', () => {
    const result = applyAdjustLists(base, [adjust({ adjust: { type: 'amount', value: 999999, target: { kind: 'all' } } })], drink, {
      at: TUE_1500,
      timezone: TZ,
    });
    expect(result.amount).toBe(0);
    expect(result.compareAtAmount).toBe(65000);
  });

  it('floors a percent that does not divide evenly', () => {
    const odd = { amount: 10001, currency: 'VND', matchedRules: [] };
    const result = applyAdjustLists(
      odd,
      [adjust({ adjust: { type: 'percent', value: 10, target: { kind: 'all' } } })],
      drink,
      { at },
    );
    expect(result.amount).toBe(9001);
  });

  it('does not stack two adjust lists; the higher priority wins', () => {
    const lists = [
      adjust({ id: 'a', priority: 1, adjust: { type: 'percent', value: 50, target: { kind: 'all' } } }),
      adjust({ id: 'b', priority: 5, adjust: { type: 'percent', value: 10, target: { kind: 'all' } } }),
    ];
    const result = applyAdjustLists(base, lists, drink, { at });
    expect(result.amount).toBe(58500);
    expect(result.priceListId).toBe('b');
  });

  it('breaks an equal adjust priority with the lower price', () => {
    const lists = [
      adjust({ id: 'a', priority: 3, adjust: { type: 'percent', value: 10, target: { kind: 'all' } } }),
      adjust({ id: 'b', priority: 3, adjust: { type: 'amount', value: 20000, target: { kind: 'all' } } }),
    ];
    expect(applyAdjustLists(base, lists, drink, { at }).priceListId).toBe('b');
    expect(applyAdjustLists(base, lists, drink, { at }).amount).toBe(45000);
  });

  it('matches an adjust list on channel and customer group', () => {
    const staff = adjust({
      rules: { channel: 'staff', customerGroup: 'nhan-vien' },
      adjust: { type: 'percent', value: 30, target: { kind: 'all' } },
    });
    const ctx = { at, channel: 'staff' as const, customerGroups: ['nhan-vien'] };
    expect(applyAdjustLists(base, [staff], drink, ctx).amount).toBe(45500);
    expect(applyAdjustLists(base, [staff], drink, { at, channel: 'pickup', customerGroups: ['nhan-vien'] }).amount).toBe(65000);
    expect(applyAdjustLists(base, [staff], drink, { at, channel: 'staff' }).amount).toBe(65000);
  });

  it('matches a product target by variant or product ref', () => {
    const list = adjust({ adjust: { type: 'amount', value: 5000, target: { kind: 'products', refs: ['tra-ly'] } } });
    expect(applyAdjustLists(base, [list], drink, { at }).amount).toBe(60000);
    expect(applyAdjustLists(base, [list], food, { at }).amount).toBe(65000);
  });

  it('ignores a negative adjust value', () => {
    const list = adjust({ adjust: { type: 'amount', value: -5000, target: { kind: 'all' } } });
    expect(applyAdjustLists(base, [list], drink, { at })).toEqual(base);
  });

  it('wraps an adjust list across midnight', () => {
    const list = adjust({
      rules: { timeRanges: [{ start: '22:00', end: '02:00' }] },
      adjust: { type: 'percent', value: 10, target: { kind: 'all' } },
    });
    expect(applyAdjustLists(base, [list], drink, { at: TUE_2330, timezone: TZ }).amount).toBe(58500);
    expect(applyAdjustLists(base, [list], drink, { at: WED_0100, timezone: TZ }).amount).toBe(58500);
    expect(applyAdjustLists(base, [list], drink, { at: TUE_1500, timezone: TZ }).amount).toBe(65000);
  });
});

describe('priceChannelOf', () => {
  it('maps a staff draft to staff and receive kinds otherwise', () => {
    expect(priceChannelOf({ originKind: 'staff-draft', receiveKind: 'delivery' })).toBe('staff');
    expect(priceChannelOf({ originKind: 'storefront', receiveKind: 'pickup' })).toBe('pickup');
    expect(priceChannelOf({ originKind: 'storefront', receiveKind: 'delivery' })).toBe('delivery');
    expect(priceChannelOf({ originKind: 'storefront', receiveKind: 'dine-in' })).toBe('dine-in');
    expect(priceChannelOf({ originKind: 'storefront', receiveKind: 'appointment' })).toBeUndefined();
  });
});

describe('explainPrice', () => {
  it('names the winning adjust list and why the others miss', () => {
    const rows = [row({ amount: 65000 })];
    const lists = [
      adjust(),
      adjust({ id: 'off', name: 'Tắt', active: false }),
    ];
    const explained = explainPrice(rows, lists, { categoryRefs: ['drink'] }, { at: TUE_1500, timezone: TZ });
    expect(explained.amount).toBe(52000);
    expect(explained.compareAtAmount).toBe(65000);
    expect(explained.winner).toMatchObject({ kind: 'list', id: 'happy', reason: 'winner' });
    expect(explained.candidates.find((item) => item.id === 'off')?.reason).toBe('inactive');
  });
});
