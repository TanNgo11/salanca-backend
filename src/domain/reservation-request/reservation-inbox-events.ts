/**
 * In-process event source for the reservation inbox: the public create
 * controller emits once per accepted lead and admin SSE connections subscribe.
 */

import { EventEmitter } from 'node:events';

export const RESERVATION_CREATED_EVENT = 'reservation.created';

export interface ReservationInboxItem {
  documentId: string;
  fullName: string;
  phone: string;
  guestCount: number;
  preferredDate: string;
  preferredTime: string;
  overlapCount: number;
  createdAt: string;
}

export type ReservationCreatedListener = (item: ReservationInboxItem) => void;

const reservationInboxBus = new EventEmitter();
// Subscribers scale with open admin tabs; the default limit of 10 is too low.
reservationInboxBus.setMaxListeners(50);

export const emitReservationCreated = (item: ReservationInboxItem): void => {
  reservationInboxBus.emit(RESERVATION_CREATED_EVENT, item);
};

/**
 * Returns the unsubscribe function; callers must run it on connection close.
 */
export const subscribeReservationCreated = (
  listener: ReservationCreatedListener,
): (() => void) => {
  reservationInboxBus.on(RESERVATION_CREATED_EVENT, listener);
  return () => {
    reservationInboxBus.off(RESERVATION_CREATED_EVENT, listener);
  };
};
