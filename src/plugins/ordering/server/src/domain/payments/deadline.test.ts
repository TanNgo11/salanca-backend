import { describe, expect, it } from 'vitest';

import { laterDeadline, paymentDeadline, paymentWindowStart } from './deadline';

const placedAt = new Date('2026-10-11T10:00:00.000Z');

describe('payment window', () => {
  it('starts at placement when the group was born awaiting payment', () => {
    const start = paymentWindowStart({ placedAt, groupId: 4, events: [] });
    expect(start).toEqual(placedAt);
    expect(paymentDeadline(start, 15).toISOString()).toBe('2026-10-11T10:15:00.000Z');
  });

  it('starts when the group entered awaiting-payment, ignoring other groups', () => {
    const start = paymentWindowStart({
      placedAt,
      groupId: 4,
      events: [
        {
          type: 'fulfillment-group.transitioned',
          occurredAt: '2026-10-11T10:05:00.000Z',
          payload: { groupId: 9, to: 'awaiting-payment' },
        },
        {
          type: 'fulfillment-group.transitioned',
          occurredAt: '2026-10-11T11:00:00.000Z',
          payload: { groupId: 4, to: 'awaiting-acceptance' },
        },
        {
          type: 'fulfillment-group.transitioned',
          occurredAt: '2026-10-11T11:30:00.000Z',
          payload: { groupId: '4', to: 'awaiting-payment' },
        },
      ],
    });
    expect(start.toISOString()).toBe('2026-10-11T11:30:00.000Z');
  });

  it('keeps a stored extension when it is later than the computed window', () => {
    const computed = paymentDeadline(placedAt, 15);
    expect(laterDeadline(computed, null).toISOString()).toBe('2026-10-11T10:15:00.000Z');
    expect(laterDeadline(computed, 'not-a-date').toISOString()).toBe('2026-10-11T10:15:00.000Z');
    expect(laterDeadline(computed, '2026-10-11T10:10:00.000Z').toISOString()).toBe(
      '2026-10-11T10:15:00.000Z',
    );
    expect(laterDeadline(computed, '2026-10-11T12:00:00.000Z').toISOString()).toBe(
      '2026-10-11T12:00:00.000Z',
    );
  });
});
