import { OrderingError } from './errors';

/**
 * Money is an integer amount in minor-free VND plus a currency code. Amounts must stay inside
 * `Number.isSafeInteger` so JSON and Postgres bigint round-trips never lose precision; `bigint`
 * is only a parsing tool on the database boundary and is never returned.
 */
export type Currency = string;
export type Money = { amount: number; currency: Currency };

export const DEFAULT_CURRENCY = 'VND';

export function assertSafeAmount(value: unknown, field = 'amount'): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isInteger(value)) {
    throw new OrderingError('MONEY_INVALID', `${field} must be an integer number`, {
      details: { field },
    });
  }
  if (!Number.isSafeInteger(value)) {
    throw new OrderingError('MONEY_OUT_OF_RANGE', `${field} is outside the safe integer range`, {
      details: { field },
    });
  }
  return value;
}

export function toMoney(amount: unknown, currency: Currency = DEFAULT_CURRENCY): Money {
  return { amount: assertSafeAmount(amount), currency };
}

export function moneyFromDb(
  value: string | number | bigint | null | undefined,
  currency: Currency = DEFAULT_CURRENCY,
): Money {
  if (value === null || value === undefined) {
    return { amount: 0, currency };
  }
  if (typeof value === 'number') {
    return toMoney(value, currency);
  }
  let parsed: bigint;
  if (typeof value === 'bigint') {
    parsed = value;
  } else {
    // Knex returns Postgres bigint/numeric columns as strings.
    if (!/^-?\d+$/.test(value)) {
      throw new OrderingError('MONEY_INVALID', 'money value from the database is not an integer');
    }
    parsed = BigInt(value);
  }
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new OrderingError(
      'MONEY_OUT_OF_RANGE',
      'money value from the database exceeds the safe integer range',
    );
  }
  return { amount: Number(parsed), currency };
}

export function amountFromDb(value: string | number | bigint | null | undefined): number {
  return moneyFromDb(value).amount;
}

export function assertSameCurrency(...monies: Money[]): Currency {
  const [first, ...rest] = monies;
  if (first === undefined) {
    throw new OrderingError('MONEY_INVALID', 'assertSameCurrency requires at least one money value');
  }
  for (const money of rest) {
    if (money.currency !== first.currency) {
      throw new OrderingError('CURRENCY_MISMATCH', 'money values must share one currency', {
        details: { expected: first.currency, actual: money.currency },
      });
    }
  }
  return first.currency;
}

export function addMoney(a: Money, b: Money): Money {
  const currency = assertSameCurrency(a, b);
  return { amount: assertSafeAmount(a.amount + b.amount), currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  const currency = assertSameCurrency(a, b);
  return { amount: assertSafeAmount(a.amount - b.amount), currency };
}

export function multiplyMoney(money: Money, factor: number): Money {
  assertSafeAmount(factor, 'factor');
  if (factor < 0) {
    throw new OrderingError('MONEY_INVALID', 'factor must be zero or positive');
  }
  return { amount: assertSafeAmount(money.amount * factor), currency: money.currency };
}

export function sumAmounts(values: number[]): number {
  let total = 0;
  for (const value of values) {
    assertSafeAmount(value);
    total = assertSafeAmount(total + value);
  }
  return total;
}

/** Rounding for tax and allocation steps; ties move away from zero, like accounting practice. */
export function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}
