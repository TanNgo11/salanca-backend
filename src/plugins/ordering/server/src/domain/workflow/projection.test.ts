import { describe, expect, it } from 'vitest';

import { projectFulfillmentStatus, projectOrderStatus, type GroupProjectionInput } from './projection';

const group = (
  status: string,
  terminal: 'success' | 'canceled' | null = null,
): GroupProjectionInput => ({ status, initial: 'initial', terminal });

const INITIAL = group('initial');
const MID = group('mid');
const SUCCESS = group('done', 'success');
const CANCELED = group('canceled', 'canceled');

describe('projectFulfillmentStatus', () => {
  it.each([
    [[], 'not-started'],
    [[INITIAL], 'not-started'],
    [[INITIAL, INITIAL], 'not-started'],
    [[MID], 'in-progress'],
    [[MID, INITIAL], 'in-progress'],
    [[SUCCESS], 'done'],
    [[CANCELED], 'canceled'],
    [[CANCELED, CANCELED], 'canceled'],
    [[SUCCESS, MID], 'partially-done'],
    [[SUCCESS, CANCELED], 'done'],
    [[CANCELED, MID], 'in-progress'],
    [[SUCCESS, MID, CANCELED], 'partially-done'],
  ] as const)('groups %j → %s', (groups, expected) => {
    expect(projectFulfillmentStatus([...groups])).toBe(expected);
  });
});

describe('projectOrderStatus', () => {
  const total = 100;
  const payments = {
    unpaid: 0,
    partial: 50,
    paid: 100,
    overpaid: 150,
  };

  // Explicit table: group sets × payment states → expected order status.
  const cases: Array<[GroupProjectionInput[], number, string]> = [
    [[INITIAL], payments.unpaid, 'open'],
    [[INITIAL], payments.partial, 'open'],
    [[INITIAL], payments.paid, 'open'],
    [[INITIAL], payments.overpaid, 'open'],
    [[MID], payments.unpaid, 'open'],
    [[MID], payments.partial, 'open'],
    [[MID], payments.paid, 'open'],
    [[MID], payments.overpaid, 'open'],
    [[SUCCESS], payments.unpaid, 'open'],
    [[SUCCESS], payments.partial, 'open'],
    [[SUCCESS], payments.paid, 'completed'],
    [[SUCCESS], payments.overpaid, 'completed'],
    [[CANCELED], payments.unpaid, 'canceled'],
    [[CANCELED], payments.partial, 'canceled'],
    [[CANCELED], payments.paid, 'canceled'],
    [[CANCELED], payments.overpaid, 'canceled'],
    [[SUCCESS, MID], payments.unpaid, 'open'],
    [[SUCCESS, MID], payments.partial, 'open'],
    [[SUCCESS, MID], payments.paid, 'open'],
    [[SUCCESS, MID], payments.overpaid, 'open'],
    [[SUCCESS, CANCELED], payments.unpaid, 'open'],
    [[SUCCESS, CANCELED], payments.partial, 'open'],
    [[SUCCESS, CANCELED], payments.paid, 'completed'],
    [[SUCCESS, CANCELED], payments.overpaid, 'completed'],
    [[CANCELED, MID], payments.unpaid, 'open'],
    [[CANCELED, MID], payments.partial, 'open'],
    [[CANCELED, MID], payments.paid, 'open'],
    [[CANCELED, MID], payments.overpaid, 'open'],
  ];

  it.each(cases)('groups %j captured %i → %s', (groups, capturedAmount, expected) => {
    expect(
      projectOrderStatus({
        originKind: 'storefront',
        draftConfirmed: true,
        groups,
        totalAmount: total,
        capturedAmount,
      }),
    ).toBe(expected);
  });

  it('keeps an unconfirmed staff draft in draft regardless of groups', () => {
    expect(
      projectOrderStatus({
        originKind: 'staff-draft',
        draftConfirmed: false,
        groups: [SUCCESS],
        totalAmount: total,
        capturedAmount: total,
      }),
    ).toBe('draft');
  });

  it('confirms a staff draft into the normal flow', () => {
    expect(
      projectOrderStatus({
        originKind: 'staff-draft',
        draftConfirmed: true,
        groups: [SUCCESS],
        totalAmount: total,
        capturedAmount: total,
      }),
    ).toBe('completed');
  });

  it('stays open with no groups', () => {
    expect(
      projectOrderStatus({
        originKind: 'storefront',
        draftConfirmed: true,
        groups: [],
        totalAmount: total,
        capturedAmount: total,
      }),
    ).toBe('open');
  });
});
