import { allocateLargestRemainder } from '../pricing/allocation';
import type { PricingTarget } from '../pricing/pipeline';
import { minutesOf, toLocalParts } from '../scheduling/zoned-time';

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type PromotionLine = {
  index: number;
  sellableUid: string;
  variantUid?: string;
  categoryRefs: string[];
  base: number;
};

export type PromotionTarget = {
  kind: 'order' | 'products' | 'categories';
  refs: string[];
};

/** A promotion the service already decided is active and has usage left. */
export type PromotionSnapshot = {
  id: number;
  /** Entered code, or a stable label such as `P12` for an automatic promotion. */
  code: string;
  label: string;
  kind: 'code' | 'auto';
  discountType: 'percent' | 'amount' | 'free-delivery' | 'delivery-amount';
  value: number | null;
  maxDiscount: number | null;
  target: PromotionTarget;
  minSubtotal: number;
  /** `null` or empty means every branch. */
  locationRefs: string[] | null;
  receiveKinds: Array<'pickup' | 'delivery' | 'dine-in'>;
  startsAt: string;
  endsAt: string | null;
  /** Empty means every day. */
  weekdays: string[];
  /** Empty means all day. `end` < `start` wraps past midnight. */
  timeRanges: Array<{ start: string; end: string }>;
  firstOrderOnly: boolean;
  perCustomerLimit: number | null;
  stackable: boolean;
  priority: number;
};

export type EvaluateInput = {
  now: Date;
  timezone: string;
  locationRef: string;
  // 'dine-in' is a valid order kind; no promotion declares it yet, so dine-in carts
  // match nothing until the promotion vocabulary is extended (O12 keeps that honest).
  receiveKind: 'pickup' | 'delivery' | 'dine-in';
  lines: PromotionLine[];
  fulfillmentAmount: number;
  subtotal: number;
  candidates: PromotionSnapshot[];
  code?: string;
  customer: { isFirstOrder: boolean; usedByPromotion: Record<number, number> };
};

export type AppliedPromotion = {
  promotionId: number;
  code: string;
  label: string;
  /** Negative, in đồng. */
  amount: number;
  target: PricingTarget;
  stackable: boolean;
  priority: number;
  ruleSnapshot: Record<string, unknown>;
};

export type RejectedPromotion = { code: string; reason: string };

type Eligible = AppliedPromotion & { entered: boolean };

const ruleSnapshotOf = (promo: PromotionSnapshot): Record<string, unknown> => ({
  promotionId: promo.id,
  code: promo.code,
  label: promo.label,
  discountType: promo.discountType,
  value: promo.value,
  maxDiscount: promo.maxDiscount,
  target: promo.target,
  minSubtotal: promo.minSubtotal,
  stackable: promo.stackable,
  priority: promo.priority,
});

const inTimeRange = (minute: number, range: { start: string; end: string }): boolean => {
  const start = minutesOf(range.start);
  const end = minutesOf(range.end);
  if (start === end) return false;
  if (end > start) return minute >= start && minute < end;
  return minute >= start || minute < end;
};

/** Why this promotion cannot apply, or null when every condition holds. */
export const rejectionReason = (promo: PromotionSnapshot, input: EvaluateInput): string | null => {
  const start = Date.parse(promo.startsAt);
  const end = promo.endsAt ? Date.parse(promo.endsAt) : null;
  if (Number.isFinite(start) && input.now.getTime() < start) return 'not-started';
  if (end !== null && Number.isFinite(end) && input.now.getTime() >= end) return 'ended';
  if (promo.locationRefs && promo.locationRefs.length > 0 && !promo.locationRefs.includes(input.locationRef)) {
    return 'location';
  }
  if (!promo.receiveKinds.includes(input.receiveKind)) return 'receive-kind';
  const local = toLocalParts(input.now, input.timezone);
  const weekday = WEEKDAYS[local.weekday] ?? 'mon';
  if (promo.weekdays.length > 0 && !promo.weekdays.includes(weekday)) return 'time';
  if (promo.timeRanges.length > 0) {
    const minute = minutesOf(local.time);
    if (!promo.timeRanges.some((range) => inTimeRange(minute, range))) return 'time';
  }
  if (promo.firstOrderOnly && !input.customer.isFirstOrder) return 'first-order';
  if (
    promo.discountType !== 'free-delivery' &&
    promo.discountType !== 'delivery-amount' &&
    matchingIndexes(promo, input.lines).length === 0
  ) {
    return 'products';
  }
  if (input.subtotal < promo.minSubtotal) return 'min-subtotal';
  const used = input.customer.usedByPromotion[promo.id] ?? 0;
  if (promo.perCustomerLimit !== null && used >= promo.perCustomerLimit) return 'per-customer';
  return null;
};

const matchingIndexes = (promo: PromotionSnapshot, lines: PromotionLine[]): number[] => {
  if (promo.discountType === 'free-delivery' || promo.discountType === 'delivery-amount') {
    return [];
  }
  if (promo.target.kind === 'order') return lines.map((line) => line.index);
  const refs = new Set(promo.target.refs);
  if (promo.target.kind === 'products') {
    return lines
      .filter((line) => refs.has(line.sellableUid) || (line.variantUid !== undefined && refs.has(line.variantUid)))
      .map((line) => line.index);
  }
  return lines
    .filter((line) => line.categoryRefs.some((ref) => refs.has(ref)))
    .map((line) => line.index);
};

const floorPercent = (base: number, percent: number): number => Math.floor((base * percent) / 100);

/**
 * Discount for one promotion that already passed the conditions. `null` when the
 * discount would be zero (a free-delivery promotion on a zero fee, or an empty base).
 * Percent rounds down. The amount never exceeds the target base.
 */
export const pricePromotion = (
  promo: PromotionSnapshot,
  input: Pick<EvaluateInput, 'lines' | 'fulfillmentAmount' | 'subtotal'>,
): Pick<AppliedPromotion, 'amount' | 'target'> | null => {
  if (promo.discountType === 'free-delivery' || promo.discountType === 'delivery-amount') {
    if (input.fulfillmentAmount <= 0) return null;
    const cut =
      promo.discountType === 'free-delivery'
        ? input.fulfillmentAmount
        : Math.min(promo.value ?? 0, input.fulfillmentAmount);
    if (cut <= 0) return null;
    return { amount: -cut, target: { kind: 'fulfillment' } };
  }
  const indexes = matchingIndexes(promo, input.lines);
  const bases = new Map(input.lines.map((line) => [line.index, line.base]));
  const base = indexes.reduce((sum, index) => sum + (bases.get(index) ?? 0), 0);
  if (base <= 0) return null;
  let cut = 0;
  if (promo.discountType === 'percent') {
    cut = floorPercent(base, promo.value ?? 0);
    if (promo.maxDiscount !== null) cut = Math.min(cut, promo.maxDiscount);
  } else {
    cut = Math.min(promo.value ?? 0, base);
  }
  if (cut <= 0) return null;
  const target: PricingTarget =
    promo.target.kind === 'order' ? { kind: 'order' } : { kind: 'lines', lineIndexes: indexes };
  return { amount: -cut, target };
};

type LineState = { lines: Map<number, number>; fulfillment: number };

const fits = (
  state: LineState,
  promo: AppliedPromotion,
  bases: Map<number, number>,
  fulfillmentAmount: number,
): LineState | null => {
  if (promo.target.kind === 'fulfillment') {
    const fulfillment = state.fulfillment + promo.amount;
    if (fulfillmentAmount + fulfillment < 0) return null;
    return { lines: state.lines, fulfillment };
  }
  const indexes =
    promo.target.kind === 'lines' ? promo.target.lineIndexes : [...bases.keys()];
  const weights = indexes.map((index) => bases.get(index) ?? 0);
  const shares = allocateLargestRemainder(promo.amount, weights);
  const lines = new Map(state.lines);
  for (let i = 0; i < indexes.length; i += 1) {
    const index = indexes[i];
    const discount = (lines.get(index) ?? 0) + shares[i];
    if ((bases.get(index) ?? 0) + discount < 0) return null;
    lines.set(index, discount);
  }
  return { lines, fulfillment: state.fulfillment };
};

const planDiscount = (promos: Eligible[]): number => promos.reduce((sum, promo) => sum + promo.amount, 0);

const better = (candidate: Eligible[], current: Eligible[] | null): boolean => {
  if (!current) return candidate.length > 0;
  const discount = planDiscount(candidate);
  const currentDiscount = planDiscount(current);
  if (discount !== currentDiscount) return discount < currentDiscount;
  const candidateCode = candidate.some((promo) => promo.entered);
  const currentCode = current.some((promo) => promo.entered);
  if (candidateCode !== currentCode) return candidateCode;
  const priority = (promos: Eligible[]) => Math.max(...promos.map((promo) => promo.priority));
  if (priority(candidate) !== priority(current)) return priority(candidate) > priority(current);
  const smallest = (promos: Eligible[]) => Math.min(...promos.map((promo) => promo.promotionId));
  return smallest(candidate) < smallest(current);
};

/**
 * Picks the promotions for one quote. Automatic misses stay quiet. The entered
 * code is either applied or returned in `rejected` with one reason.
 * Stackable promotions combine, highest priority first, and a promotion that
 * would push a line or the delivery fee below zero is left out. A non-stackable
 * promotion is its own plan. The plan with the larger discount wins; a tie
 * prefers the entered code, then higher priority, then the smaller id.
 */
export const evaluate = (input: EvaluateInput): { applied: AppliedPromotion[]; rejected: RejectedPromotion[] } => {
  const wanted = input.code?.trim().toUpperCase() ?? '';
  const bases = new Map(input.lines.map((line) => [line.index, line.base]));
  const rejected: RejectedPromotion[] = [];
  const eligible: Eligible[] = [];
  let sawCode = false;

  for (const promo of input.candidates) {
    const entered = wanted !== '' && promo.kind === 'code' && promo.code.toUpperCase() === wanted;
    if (entered) sawCode = true;
    const reason = rejectionReason(promo, input);
    if (reason) {
      if (entered) rejected.push({ code: promo.code, reason });
      continue;
    }
    const priced = pricePromotion(promo, input);
    if (!priced) {
      if (entered) rejected.push({ code: promo.code, reason: 'fulfillment' });
      continue;
    }
    eligible.push({
      promotionId: promo.id,
      code: promo.code,
      label: promo.label,
      amount: priced.amount,
      target: priced.target,
      stackable: promo.stackable,
      priority: promo.priority,
      ruleSnapshot: ruleSnapshotOf(promo),
      entered,
    });
  }
  if (wanted !== '' && !sawCode) rejected.push({ code: wanted, reason: 'invalid' });

  const stackable = eligible
    .filter((promo) => promo.stackable)
    .sort((a, b) => b.priority - a.priority || a.promotionId - b.promotionId);
  const stack: Eligible[] = [];
  let state: LineState = { lines: new Map(), fulfillment: 0 };
  for (const promo of stackable) {
    const next = fits(state, promo, bases, input.fulfillmentAmount);
    if (!next) continue;
    state = next;
    stack.push(promo);
  }

  let best: Eligible[] | null = stack.length > 0 ? stack : null;
  for (const promo of eligible) {
    if (promo.stackable) continue;
    if (!fits({ lines: new Map(), fulfillment: 0 }, promo, bases, input.fulfillmentAmount)) continue;
    if (better([promo], best)) best = [promo];
  }
  if (best && planDiscount(best) === 0) best = null;

  const chosen = new Set((best ?? []).map((promo) => promo.promotionId));
  for (const promo of eligible) {
    if (promo.entered && !chosen.has(promo.promotionId)) {
      rejected.push({ code: promo.code, reason: 'not-best' });
    }
  }

  const applied = (best ?? []).map(({ entered: _entered, ...promo }) => promo);
  return { applied, rejected };
};
