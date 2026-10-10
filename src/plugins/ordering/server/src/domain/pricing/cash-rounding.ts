import { OrderingError } from '../errors';
import { assertSafeAmount } from '../money';

/** Branch/policy-level cash rounding config; `providerCodes` defaults to `['cash']` in config. */
export type CashRoundingPolicy = {
  enabled: boolean;
  multiple: number;
  providerCodes: string[];
};

/**
 * Signed delta that moves `amount` onto the nearest multiple, rounding half away from zero
 * (195500 → +500, 195400 → −400, −195500 → −500). `multiple` must be an integer ≥ 1.
 */
export function cashRoundingDelta(amount: number, multiple: number): number {
  assertSafeAmount(amount, 'amount');
  assertSafeAmount(multiple, 'multiple');
  if (multiple < 1) {
    throw new OrderingError('VALIDATION_ERROR', 'cash rounding multiple must be >= 1');
  }
  const rounded = Math.sign(amount) * Math.round(Math.abs(amount) / multiple) * multiple;
  return rounded - amount;
}

/** Rounding applies only to the configured payment provider codes (cash by default). */
export function appliesCashRounding(
  policy: CashRoundingPolicy | null | undefined,
  providerCode: string | undefined,
): boolean {
  if (!policy?.enabled || providerCode === undefined) return false;
  return policy.providerCodes.includes(providerCode);
}
