/**
 * Pure contact-message intake validation.
 * No Strapi imports — unit-testable and reusable from controllers.
 * Output is Document Service-ready: optional fields are omitted, never null.
 */

import { isValidEmailAddress } from '../../shared/email/email';
import { isPlainRecord } from '../../shared/normalization/value';
import { optionalBoundedString, requiredBoundedString } from '../form-intake/bounded-string';
import {
  createFormFail,
  FormValidationError,
} from '../form-intake/form-validation-error';
import { assertHoneypotClear } from '../form-intake/honeypot';
import { parseFormSourceLocale } from '../form-intake/source-locale';

export { FormValidationError };

export const CONTACT_MESSAGE_LIMITS = {
  fullName: 120,
  email: 254,
  phone: 40,
  topic: 80,
  message: 4000,
  sourcePath: 200,
} as const;

export type ContactMessageSourceLocale = 'vi' | 'en';

/** Payload ready for `strapi.documents(...).create({ data })`. */
export type ContactMessageCreateData = {
  fullName: string;
  email?: string;
  phone?: string;
  topic?: string;
  message: string;
  sourceLocale: ContactMessageSourceLocale;
  sourcePath?: string;
  status: 'new';
};

export enum ContactMessageValidationErrorCode {
  InvalidBody = 'CONTACT_INVALID_BODY',
  Honeypot = 'CONTACT_HONEYPOT',
  FullNameRequired = 'CONTACT_FULL_NAME_REQUIRED',
  FullNameTooLong = 'CONTACT_FULL_NAME_TOO_LONG',
  MessageRequired = 'CONTACT_MESSAGE_REQUIRED',
  MessageTooLong = 'CONTACT_MESSAGE_TOO_LONG',
  ContactRequired = 'CONTACT_EMAIL_OR_PHONE_REQUIRED',
  EmailInvalid = 'CONTACT_EMAIL_INVALID',
  EmailTooLong = 'CONTACT_EMAIL_TOO_LONG',
  PhoneTooLong = 'CONTACT_PHONE_TOO_LONG',
  TopicTooLong = 'CONTACT_TOPIC_TOO_LONG',
  SourceLocaleInvalid = 'CONTACT_SOURCE_LOCALE_INVALID',
  SourcePathTooLong = 'CONTACT_SOURCE_PATH_TOO_LONG',
  RateLimited = 'CONTACT_RATE_LIMITED',
}

/** @deprecated Use FormValidationError — kept as alias for call sites/tests. */
export const ContactMessageValidationError = FormValidationError;

const fail = createFormFail();

/**
 * Parses and validates public contact form payload.
 * Honeypot `website` must be empty/absent; never persisted.
 * Client `status` is ignored; create data always forces status `new`.
 * Accepts legacy body key `locale` as alias for `sourceLocale`.
 */
export function parseContactMessageInput(raw: unknown): ContactMessageCreateData {
  if (!isPlainRecord(raw)) {
    return fail(
      ContactMessageValidationErrorCode.InvalidBody,
      'Contact message body must be a JSON object under data.',
    );
  }

  assertHoneypotClear(
    fail,
    raw.website,
    ContactMessageValidationErrorCode.Honeypot,
    'Unable to submit contact message.',
  );

  const fullName = requiredBoundedString(
    fail,
    raw.fullName,
    CONTACT_MESSAGE_LIMITS.fullName,
    ContactMessageValidationErrorCode.FullNameRequired,
    ContactMessageValidationErrorCode.FullNameTooLong,
    'fullName',
  );

  const message = requiredBoundedString(
    fail,
    raw.message,
    CONTACT_MESSAGE_LIMITS.message,
    ContactMessageValidationErrorCode.MessageRequired,
    ContactMessageValidationErrorCode.MessageTooLong,
    'message',
  );

  const sourceLocale = parseFormSourceLocale(
    fail,
    raw,
    ContactMessageValidationErrorCode.SourceLocaleInvalid,
  );

  const email = optionalBoundedString(
    fail,
    raw.email,
    CONTACT_MESSAGE_LIMITS.email,
    ContactMessageValidationErrorCode.EmailTooLong,
    'email',
    ContactMessageValidationErrorCode.InvalidBody,
  );
  if (email && !isValidEmailAddress(email)) {
    return fail(
      ContactMessageValidationErrorCode.EmailInvalid,
      'email format is invalid.',
    );
  }

  const phone = optionalBoundedString(
    fail,
    raw.phone,
    CONTACT_MESSAGE_LIMITS.phone,
    ContactMessageValidationErrorCode.PhoneTooLong,
    'phone',
    ContactMessageValidationErrorCode.InvalidBody,
  );

  if (!email && !phone) {
    return fail(
      ContactMessageValidationErrorCode.ContactRequired,
      'At least one of email or phone is required.',
    );
  }

  const topic = optionalBoundedString(
    fail,
    raw.topic,
    CONTACT_MESSAGE_LIMITS.topic,
    ContactMessageValidationErrorCode.TopicTooLong,
    'topic',
    ContactMessageValidationErrorCode.InvalidBody,
  );

  const sourcePath = optionalBoundedString(
    fail,
    raw.sourcePath,
    CONTACT_MESSAGE_LIMITS.sourcePath,
    ContactMessageValidationErrorCode.SourcePathTooLong,
    'sourcePath',
    ContactMessageValidationErrorCode.InvalidBody,
  );

  return {
    fullName,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(topic ? { topic } : {}),
    message,
    sourceLocale,
    ...(sourcePath ? { sourcePath } : {}),
    status: 'new',
  };
}
