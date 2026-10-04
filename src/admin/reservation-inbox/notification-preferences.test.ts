import { describe, expect, it, vi } from 'vitest';

import {
  RESERVATION_INBOX_PREFS_KEY,
  defaultReservationInboxPrefs,
  readReservationInboxPrefs,
  writeReservationInboxPrefs,
} from './notification-preferences';

const buildStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  };
};

describe('readReservationInboxPrefs', () => {
  it('returns defaults when nothing is stored', () => {
    expect(readReservationInboxPrefs(buildStorage())).toEqual(defaultReservationInboxPrefs);
    expect(readReservationInboxPrefs(null)).toEqual(defaultReservationInboxPrefs);
  });

  it('parses a stored payload and coerces non-boolean fields to false', () => {
    const storage = buildStorage({
      [RESERVATION_INBOX_PREFS_KEY]: JSON.stringify({ osNotify: true, sound: 'yes' }),
    });

    expect(readReservationInboxPrefs(storage)).toEqual({ osNotify: true, sound: false });
  });

  it('returns defaults when the stored payload is malformed', () => {
    const storage = buildStorage({ [RESERVATION_INBOX_PREFS_KEY]: '{oops' });

    expect(readReservationInboxPrefs(storage)).toEqual(defaultReservationInboxPrefs);
  });

  it('returns defaults when storage access throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: vi.fn(),
    };

    expect(readReservationInboxPrefs(storage)).toEqual(defaultReservationInboxPrefs);
  });
});

describe('writeReservationInboxPrefs', () => {
  it('persists the payload and reports success', () => {
    const storage = buildStorage();

    expect(writeReservationInboxPrefs({ osNotify: true, sound: true }, storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      RESERVATION_INBOX_PREFS_KEY,
      JSON.stringify({ osNotify: true, sound: true }),
    );
  });

  it('reports failure instead of throwing when storage rejects', () => {
    const storage = {
      getItem: vi.fn(),
      setItem: () => {
        throw new Error('quota');
      },
    };

    expect(writeReservationInboxPrefs({ osNotify: false, sound: false }, storage)).toBe(false);
  });

  it('reports failure when no storage is available', () => {
    expect(writeReservationInboxPrefs({ osNotify: false, sound: false }, null)).toBe(false);
  });
});
