export const RESERVATION_INBOX_PREFS_KEY = 'salanca.reservationInbox.prefs';

export interface ReservationInboxPreferences {
  osNotify: boolean;
  sound: boolean;
}

export const defaultReservationInboxPrefs: ReservationInboxPreferences = {
  osNotify: false,
  sound: false,
};

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

const resolveStorage = (): PreferenceStorage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const readReservationInboxPrefs = (
  storage: PreferenceStorage | null = resolveStorage(),
): ReservationInboxPreferences => {
  try {
    const raw = storage?.getItem(RESERVATION_INBOX_PREFS_KEY);
    if (!raw) {
      return { ...defaultReservationInboxPrefs };
    }
    const parsed = JSON.parse(raw) as Partial<ReservationInboxPreferences> | null;
    return {
      osNotify: parsed?.osNotify === true,
      sound: parsed?.sound === true,
    };
  } catch {
    return { ...defaultReservationInboxPrefs };
  }
};

export const writeReservationInboxPrefs = (
  prefs: ReservationInboxPreferences,
  storage: PreferenceStorage | null = resolveStorage(),
): boolean => {
  try {
    if (!storage) {
      return false;
    }
    storage.setItem(RESERVATION_INBOX_PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
};
