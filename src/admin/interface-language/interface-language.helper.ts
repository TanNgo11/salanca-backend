/* Strapi reads the interface locale from local storage while building its store,
   before anyone is authenticated, and falls back to `en` when the key is absent.
   The signed-in locale comes later from the admin user's `preferedLanguage`
   (see src/bootstrap/admin-user-language), so without this seed a fresh browser
   still shows the login screen in English. Seeding runs in the admin
   `bootstrap()`, which Strapi awaits before `render()` reads the key. */

export const ADMIN_LANGUAGE_STORAGE_KEY = 'strapi-admin-language';

/** The Admin registers this single locale in `src/admin/app.tsx`. */
export const DEFAULT_ADMIN_LOCALE = 'vi';

type LocaleStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Writes the default locale only when nothing is stored, so an administrator
 * who picked another language in Profile keeps it.
 */
export const seedDefaultAdminLocale = (storage: LocaleStorage): void => {
  try {
    if (storage.getItem(ADMIN_LANGUAGE_STORAGE_KEY) !== null) {
      return;
    }

    storage.setItem(ADMIN_LANGUAGE_STORAGE_KEY, DEFAULT_ADMIN_LOCALE);
  } catch {
    /* storage unavailable (private mode etc.) — the admin falls back to `en` */
  }
};
