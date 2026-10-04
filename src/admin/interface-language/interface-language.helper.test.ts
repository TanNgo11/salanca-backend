import { describe, expect, it, vi } from 'vitest';

import {
  ADMIN_LANGUAGE_STORAGE_KEY,
  DEFAULT_ADMIN_LOCALE,
  seedDefaultAdminLocale,
} from './interface-language.helper';

const createStorage = (stored: string | null) => ({
  getItem: vi.fn(() => stored),
  setItem: vi.fn(),
});

describe('seedDefaultAdminLocale', () => {
  it('stores Vietnamese when the browser has no locale yet', () => {
    const storage = createStorage(null);

    seedDefaultAdminLocale(storage);

    expect(storage.setItem).toHaveBeenCalledWith(
      ADMIN_LANGUAGE_STORAGE_KEY,
      DEFAULT_ADMIN_LOCALE,
    );
  });

  it('keeps a locale the administrator already picked', () => {
    const storage = createStorage('en');

    seedDefaultAdminLocale(storage);

    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('ignores unavailable storage', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('storage disabled');
      }),
      setItem: vi.fn(),
    };

    expect(() => seedDefaultAdminLocale(storage)).not.toThrow();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
