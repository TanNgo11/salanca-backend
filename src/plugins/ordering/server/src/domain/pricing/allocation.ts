import { OrderingError } from '../errors';
import { assertSafeAmount } from '../money';

/**
 * Largest-remainder split of an integer `total` across `weights`; ties go to the lower index
 * and the sign of `total` is preserved, so Σ result === total exactly. All-zero weights are
 * treated as equal weights. Products stay in bigint so a big `total` cannot overflow mid-math.
 */
export function allocateLargestRemainder(total: number, weights: number[]): number[] {
  assertSafeAmount(total, 'total');
  if (weights.length === 0) {
    if (total !== 0) {
      throw new OrderingError('VALIDATION_ERROR', 'cannot allocate a non-zero amount without lines');
    }
    return [];
  }
  for (const weight of weights) {
    assertSafeAmount(weight, 'weight');
    if (weight < 0) {
      throw new OrderingError('VALIDATION_ERROR', 'allocation weights must not be negative');
    }
  }

  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const effective = weightSum === 0 ? weights.map(() => 1) : weights;
  const divisor = BigInt(effective.reduce((sum, weight) => sum + weight, 0));
  const sign = Math.sign(total);
  const absolute = BigInt(Math.abs(total));

  const floors: number[] = [];
  const remainders: bigint[] = [];
  for (const weight of effective) {
    const product = absolute * BigInt(weight);
    floors.push(Number(product / divisor));
    remainders.push(product % divisor);
  }

  let extra = Math.abs(total) - floors.reduce((sum, share) => sum + share, 0);
  // `extra` is always < weights.length: each remainder numerator is strictly below the divisor.
  const byRemainder = effective
    .map((_, index) => index)
    .sort((a, b) => {
      if (remainders[a] === remainders[b]) return a - b;
      return remainders[a] > remainders[b] ? -1 : 1;
    });
  for (const index of byRemainder) {
    if (extra === 0) break;
    floors[index] += 1;
    extra -= 1;
  }

  // `share === 0` must stay +0 (never -0) so allocations compare equal to 0.
  return floors.map((share) => (share === 0 ? 0 : share * sign));
}
