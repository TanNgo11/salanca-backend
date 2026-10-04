/**
 * The Admin ships a single interface locale (`locales: [vi]` in
 * `src/admin/app.tsx`), but Strapi still boots every session in English until the
 * admin user row carries a language: `AuthProvider` only dispatches a locale
 * when `preferedLanguage` is set, and the initial store falls back to `en`.
 * New accounts therefore had to pick Tiếng Việt by hand in Profile.
 */
export const DEFAULT_ADMIN_INTERFACE_LANGUAGE = 'vi';

/** `preferedLanguage` is Strapi's own spelling of the admin user attribute. */
export const ADMIN_USER_LANGUAGE_FIELD = 'preferedLanguage';

/**
 * Only an unset language is defaulted. An administrator who picked English in
 * Profile keeps it, on this and on every later save.
 */
export const shouldApplyDefaultAdminLanguage = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim() === '';
