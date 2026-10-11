import { describe, expect, it } from 'vitest';

import { paymentDeadline, paymentWindowStart } from './deadline';

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
});
