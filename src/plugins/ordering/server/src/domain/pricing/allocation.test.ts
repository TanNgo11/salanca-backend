import { describe, expect, it } from 'vitest';

import { isOrderingError } from '../errors';
import { allocateLargestRemainder } from './allocation';

describe('allocateLargestRemainder', () => {
  it('splits the mockup discount 25000 over 130000/45000/45000', () => {
    expect(allocateLargestRemainder(-25000, [130000, 45000, 45000])).toEqual([
      -14773, -5114, -5113,
    ]);
  });

  it('resolves remainder ties by lower index', () => {
    expect(allocateLargestRemainder(5, [1, 1, 1])).toEqual([2, 2, 1]);
    expect(allocateLargestRemainder(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });

  it('preserves the sign of a negative total', () => {
    const split = allocateLargestRemainder(-7, [2, 1]);
    expect(split.reduce((sum, part) => sum + part, 0)).toBe(-7);
    expect(split.every((part) => part <= 0)).toBe(true);
  });

  it('splits evenly when every weight is zero', () => {
    expect(allocateLargestRemainder(10, [0, 0, 0])).toEqual([4, 3, 3]);
    expect(allocateLargestRemainder(-10, [0, 0])).toEqual([-5, -5]);
  });

  it('returns [] for an empty weight list with a zero total', () => {
    expect(allocateLargestRemainder(0, [])).toEqual([]);
  });

  it('throws when a non-zero total has no lines', () => {
    expect(() => allocateLargestRemainder(5, [])).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });

  it('rejects negative weights', () => {
    expect(() => allocateLargestRemainder(10, [5, -1])).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    try {
      allocateLargestRemainder(10, [5, -1]);
    } catch (error) {
      expect(isOrderingError(error)).toBe(true);
    }
  });

  it('always sums back to the total', () => {
    for (const [total, weights] of [
      [100, [33, 33, 34]],
      [1, [1, 1, 1, 1, 1, 1, 1]],
      [999999, [3, 0, 7, 2]],
      [-4, [2, 2]],
    ] as Array<[number, number[]]>) {
      const split = allocateLargestRemainder(total, weights);
      expect(split).toHaveLength(weights.length);
      expect(split.reduce((sum, part) => sum + part, 0)).toBe(total);
    }
  });
});
