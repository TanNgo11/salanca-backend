import { collection } from '../internal';

/**
 * Staff-edited email template override (O10): one row per (template code, messageLocale).
 * `messageLocale` is not named `locale` — Strapi i18n reserves that attribute. `body` is the
 * restricted-markdown source; rendering happens server-side through the allowlisted variable
 * map (`domain/notifications/render-custom.ts`). Unique (code, message_locale) in migration 0006.
 */
export default collection(
  'notification-template',
  {
    code: { type: 'string', required: true },
    messageLocale: { type: 'string', required: true },
    subject: { type: 'string', required: true },
    body: { type: 'text', required: true },
    /** Actor ref (`admin:<id>`/`system`) — `updatedBy` is reserved for Strapi's admin link. */
    updatedByRef: { type: 'string' },
  },
  { displayName: 'Mẫu email tùy biến' },
);
