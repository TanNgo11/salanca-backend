import { describe, expect, it, vi } from 'vitest';

import {
  emitReservationCreated,
  subscribeReservationCreated,
  type ReservationInboxItem,
} from './reservation-inbox-events';

const item: ReservationInboxItem = {
  documentId: 'abc123def456',
  fullName: 'Nguyen Van A',
  phone: '0901234567',
  guestCount: 4,
  preferredDate: '2030-06-15',
  preferredTime: '19:00',
  overlapCount: 1,
  createdAt: '2030-06-10T12:00:00.000Z',
};

describe('reservation inbox event bus', () => {
  it('delivers emitted items to subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReservationCreated(listener);

    emitReservationCreated(item);
    unsubscribe();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(item);
  });

  it('stops delivering after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReservationCreated(listener);

    unsubscribe();
    emitReservationCreated(item);

    expect(listener).not.toHaveBeenCalled();
  });

  it('supports multiple concurrent subscribers independently', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeReservationCreated(first);
    const unsubscribeSecond = subscribeReservationCreated(second);

    unsubscribeFirst();
    emitReservationCreated(item);
    unsubscribeSecond();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(item);
  });
});
