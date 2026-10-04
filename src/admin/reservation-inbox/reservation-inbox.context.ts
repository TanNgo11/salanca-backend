import { createContext, useContext } from 'react';

import type { ReservationInboxPreferences } from './notification-preferences';
import type { UseReservationInbox } from './useReservationInbox';

export interface ReservationInboxContextValue extends UseReservationInbox {
  prefs: ReservationInboxPreferences;
  setPrefs(next: ReservationInboxPreferences): void;
}

export const ReservationInboxContext = createContext<ReservationInboxContextValue | null>(
  null,
);

export const useReservationInboxContext = (): ReservationInboxContextValue => {
  const value = useContext(ReservationInboxContext);
  if (!value) {
    throw new Error('useReservationInboxContext must be used inside ReservationInboxProvider.');
  }
  return value;
};
