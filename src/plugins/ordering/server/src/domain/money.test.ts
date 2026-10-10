import { describe, expect, it } from 'vitest';

import {
  addMoney,
  amountFromDb,
  assertSafeAmount,
  assertSameCurrency,
  moneyFromDb,
  multiplyMoney,
  roundHalfAwayFromZero,
  subtractMoney,
  sumAmounts,
  toMoney,
} from './money';

describe('assertSafeAmount and toMoney', () => {
  it('accepts safe integers and defaults to VND', () => {
    expect(assertSafeAmount(0)).toBe(0);
    expect(assertSafeAmount(-45)).toBe(-45);
    expect(toMoney(15000)).toEqual({ amount: 15000, currency: 'VND' });
    expect(toMoney(15000, 'USD')).toEqual({ amount: 15000, currency: 'USD' });
  });

  it('rejects values beyond the safe integer range', () => {
    for (const value of [Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1)]) {
      expect(() => assertSafeAmount(value)).toThrowError(
        expect.objectContaining({ code: 'MONEY_OUT_OF_RANGE' })
      );
    }
  });

  it('rejects non-numbers, NaN and non-integers as MONEY_INVALID', () => {
    for (const value of ['12', NaN, 12.5, Infinity, undefined, null, {}]) {
      expect(() => assertSafeAmount(value)).toThrowError(
        expect.objectContaining({ code: 'MONEY_INVALID' })
      );
    }
  });
});

describe('moneyFromDb and amountFromDb', () => {
  it('parses integer strings including negatives', () => {
    expect(moneyFromDb('123')).toEqual({ amount: 123, currency: 'VND' });
    expect(moneyFromDb('-45')).toEqual({ amount: -45, currency: 'VND' });
    expect(moneyFromDb('9007199254740991')).toEqual({
      amount: Number.MAX_SAFE_INTEGER,
      currency: 'VND',
    });
  });

  it('rejects database strings beyond the safe integer range', () => {
    expect(() => moneyFromDb('9007199254740993')).toThrowError(
      expect.objectContaining({ code: 'MONEY_OUT_OF_RANGE' })
    );
    expect(() => moneyFromDb('-9007199254740993')).toThrowError(
      expect.objectContaining({ code: 'MONEY_OUT_OF_RANGE' })
    );
  });

  it('rejects non-integer strings as MONEY_INVALID', () => {
    for (const value of ['1e3', 'abc', '12.5', '', ' 12', '1_000']) {
      expect(() => moneyFromDb(value)).toThrowError(
        expect.objectContaining({ code: 'MONEY_INVALID' })
      );
    }
  });

  it('accepts bigint input and never returns a bigint', () => {
    const money = moneyFromDb(10n);
    expect(money).toEqual({ amount: 10, currency: 'VND' });
    expect(typeof money.amount).toBe('number');
    expect(() => moneyFromDb(9007199254740993n)).toThrowError(
      expect.objectContaining({ code: 'MONEY_OUT_OF_RANGE' })
    );
  });

  it('maps null and undefined to zero and keeps number input checked', () => {
    expect(moneyFromDb(null)).toEqual({ amount: 0, currency: 'VND' });
    expect(moneyFromDb(undefined)).toEqual({ amount: 0, currency: 'VND' });
    expect(amountFromDb('500')).toBe(500);
    expect(amountFromDb(null)).toBe(0);
    expect(() => moneyFromDb(12.5)).toThrowError(
      expect.objectContaining({ code: 'MONEY_INVALID' })
    );
  });
});

describe('money arithmetic', () => {
  it('adds and subtracts in the same currency', () => {
    const a = toMoney(1000);
    const b = toMoney(250);
    expect(addMoney(a, b)).toEqual({ amount: 1250, currency: 'VND' });
    expect(subtractMoney(a, b)).toEqual({ amount: 750, currency: 'VND' });
    expect(subtractMoney(toMoney(-100), toMoney(-50))).toEqual({ amount: -50, currency: 'VND' });
  });

  it('rejects arithmetic across currencies', () => {
    expect(() => addMoney(toMoney(1, 'VND'), toMoney(1, 'USD'))).toThrowError(
      expect.objectContaining({ code: 'CURRENCY_MISMATCH' })
    );
    expect(() =>
      assertSameCurrency(toMoney(1), toMoney(2, 'USD')),
    ).toThrowError(expect.objectContaining({ code: 'CURRENCY_MISMATCH' }));
  });

  it('rejects sums that leave the safe integer range', () => {
    expect(() =>
      addMoney(toMoney(Number.MAX_SAFE_INTEGER), toMoney(1)),
    ).toThrowError(expect.objectContaining({ code: 'MONEY_OUT_OF_RANGE' }));
    expect(() =>
      sumAmounts([Number.MAX_SAFE_INTEGER, 1]),
    ).toThrowError(expect.objectContaining({ code: 'MONEY_OUT_OF_RANGE' }));
  });

  it('multiplies by a safe non-negative integer factor', () => {
    expect(multiplyMoney(toMoney(300), 3)).toEqual({ amount: 900, currency: 'VND' });
    expect(multiplyMoney(toMoney(300), 0)).toEqual({ amount: 0, currency: 'VND' });
    expect(() => multiplyMoney(toMoney(300), -1)).toThrowError(
      expect.objectContaining({ code: 'MONEY_INVALID' })
    );
    expect(() => multiplyMoney(toMoney(300), 1.5)).toThrowError(
      expect.objectContaining({ code: 'MONEY_INVALID' })
    );
    expect(() => multiplyMoney(toMoney(Number.MAX_SAFE_INTEGER), 2)).toThrowError(
      expect.objectContaining({ code: 'MONEY_OUT_OF_RANGE' })
    );
  });

  it('sums checked amounts with a checked running total', () => {
    expect(sumAmounts([1, 2, 3])).toBe(6);
    expect(sumAmounts([])).toBe(0);
    expect(() => sumAmounts([1, 1.5])).toThrowError(
      expect.objectContaining({ code: 'MONEY_INVALID' })
    );
  });
});

describe('roundHalfAwayFromZero', () => {
  it.each([
    [2954.5, 2955],
    [-2.5, -3],
    [2.4, 2],
    [-2.4, -2],
    [0, 0],
  ])('rounds %f to %i', (value, expected) => {
    expect(roundHalfAwayFromZero(value)).toBe(expected);
  });
});
