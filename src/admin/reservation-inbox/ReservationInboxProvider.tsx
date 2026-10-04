import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { useNotification, useRBAC } from '@strapi/strapi/admin';
import { useNavigate } from 'react-router-dom';

import type { ReservationInboxItem } from '../../domain/reservation-request/reservation-inbox-events';
import {
  readReservationInboxPrefs,
  writeReservationInboxPrefs,
  type ReservationInboxPreferences,
} from './notification-preferences';
import { ReservationInboxWidget } from './ReservationInboxWidget';
import { ReservationInboxContext } from './reservation-inbox.context';
import {
  adminHref,
  contentManagerEditPath,
  formatInboxToastMessage,
  reservationInboxPermissions,
} from './reservation-inbox.helper';
import { playReservationInboxChime } from './reservation-inbox.sound';
import { useReservationInbox } from './useReservationInbox';

export interface ReservationInboxProviderProps {
  children: ReactNode;
}

export const ReservationInboxProvider = ({ children }: ReservationInboxProviderProps) => {
  const { allowedActions, isLoading } = useRBAC(reservationInboxPermissions.read);
  const enabled = !isLoading && allowedActions.canRead === true;
  const { toggleNotification } = useNotification();
  const navigate = useNavigate();

  const [prefs, setPrefsState] = useState<ReservationInboxPreferences>(() =>
    readReservationInboxPrefs(),
  );
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const setPrefs = useCallback((next: ReservationInboxPreferences) => {
    setPrefsState(next);
    writeReservationInboxPrefs(next);
  }, []);

  const handleNewItem = useCallback(
    (item: ReservationInboxItem) => {
      const message = formatInboxToastMessage(item);
      toggleNotification({
        type: 'info',
        message,
        link: {
          url: adminHref(contentManagerEditPath(item.documentId)),
          label: 'Xem',
        },
        timeout: 8_000,
      });

      if (
        prefsRef.current.osNotify &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        try {
          const notification = new Notification('Đặt bàn mới', {
            body: message,
            tag: item.documentId,
          });
          notification.onclick = () => {
            window.focus();
            navigate(contentManagerEditPath(item.documentId));
          };
        } catch {
          // OS notifications are best-effort.
        }
      }

      if (prefsRef.current.sound) {
        playReservationInboxChime();
      }
    },
    [navigate, toggleNotification],
  );

  const inbox = useReservationInbox({ enabled, onNewItem: handleNewItem });

  const value = useMemo(
    () => ({ ...inbox, prefs, setPrefs }),
    [inbox, prefs, setPrefs],
  );

  return (
    <ReservationInboxContext.Provider value={value}>
      <ReservationInboxWidget />
      {children}
    </ReservationInboxContext.Provider>
  );
};

export default ReservationInboxProvider;
