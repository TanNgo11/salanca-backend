/**
 * Pure reservation-request intake validation.
 * No Strapi imports — unit-testable and reusable from controllers.
 * Output is Document Service-ready: optional fields omitted, never null.
 */

import { isValidEmailAddress } from '../../shared/email/email';
import { isPlainRecord, trimmedNonEmptyString } from '../../shared/normalization/value';
import { parseBoundedInt } from '../form-intake/bounded-int';
import { optionalBoundedString, requiredBoundedString } from '../form-intake/bounded-string';
import {
  createFormFail,
  FormValidationError,
} from '../form-intake/form-validation-error';
import { assertHoneypotClear } from '../form-intake/honeypot';
import { parseFormSourceLocale } from '../form-intake/source-locale';

export { FormValidationError };

export const RESERVATION_REQUEST_LIMITS = {
  fullName: 120,
  email: 254,
  phone: 40,
  preferredTime: 40,
  guestCountMin: 1,
  guestCountMax: 100,
  occasion: 80,
  note: 2000,
  sourcePath: 200,
  maxPackages: 5,
  maxItems: 20,
} as const;

export type ReservationSourceLocale = 'vi' | 'en';
export type ReservationMenuSelectionMode = 'later' | 'now';

/** Payload ready for controller enrichment + documents.create. */
export type ReservationRequestCreateData = {
  fullName: string;
  phone: string;
  email?: string;
  preferredDate: string;
  preferredTime: string;
  guestCount: number;
  occasion?: string;
  note?: string;
  menuSelectionMode: ReservationMenuSelectionMode;
  menuPackageIds: string[];
  menuItemIds: string[];
  sourceLocale: ReservationSourceLocale;
  sourcePath?: string;
  status: 'new';
};

export enum ReservationRequestValidationErrorCode {
  InvalidBody = 'RESERVATION_INVALID_BODY',
  Honeypot = 'RESERVATION_HONEYPOT',
  FullNameRequired = 'RESERVATION_FULL_NAME_REQUIRED',
  FullNameTooLong = 'RESERVATION_FULL_NAME_TOO_LONG',
  PhoneRequired = 'RESERVATION_PHONE_REQUIRED',
  PhoneTooLong = 'RESERVATION_PHONE_TOO_LONG',
  EmailInvalid = 'RESERVATION_EMAIL_INVALID',
  EmailTooLong = 'RESERVATION_EMAIL_TOO_LONG',
  PreferredDateRequired = 'RESERVATION_PREFERRED_DATE_REQUIRED',
  PreferredDateInvalid = 'RESERVATION_PREFERRED_DATE_INVALID',
  PreferredDatePast = 'RESERVATION_PREFERRED_DATE_PAST',
  PreferredTimeRequired = 'RESERVATION_PREFERRED_TIME_REQUIRED',
  PreferredTimeTooLong = 'RESERVATION_PREFERRED_TIME_TOO_LONG',
  PreferredTimeInvalid = 'RESERVATION_PREFERRED_TIME_INVALID',
  GuestCountRequired = 'RESERVATION_GUEST_COUNT_REQUIRED',
  GuestCountInvalid = 'RESERVATION_GUEST_COUNT_INVALID',
  OccasionTooLong = 'RESERVATION_OCCASION_TOO_LONG',
  NoteTooLong = 'RESERVATION_NOTE_TOO_LONG',
  MenuModeInvalid = 'RESERVATION_MENU_MODE_INVALID',
  MenuRequired = 'RESERVATION_MENU_REQUIRED',
  MenuNotAllowed = 'RESERVATION_MENU_NOT_ALLOWED',
  MenuIdsInvalid = 'RESERVATION_MENU_IDS_INVALID',
  MenuTooMany = 'RESERVATION_MENU_TOO_MANY',
  SourceLocaleInvalid = 'RESERVATION_SOURCE_LOCALE_INVALID',
  SourcePathTooLong = 'RESERVATION_SOURCE_PATH_TOO_LONG',
  RateLimited = 'RESERVATION_RATE_LIMITED',
}

/** @deprecated Use FormValidationError — kept as alias for call sites/tests. */
export const ReservationRequestValidationError = FormValidationError;

/** Strict calendar date YYYY-MM-DD. */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Canonical 24-hour HH:mm. Soft-overlap counting matches on exact string
 * equality, so "19:00", "7:00 PM" and "19h" would otherwise be three distinct
 * slots and `overlapCount` would silently under-report.
 */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const isMenuMode = (value: string): value is ReservationMenuSelectionMode =>
  value === 'later' || value === 'now';

const fail = createFormFail();

/**
 * Calendar "today" in Asia/Ho_Chi_Minh as YYYY-MM-DD (en-CA).
 */
export const todayInHoChiMinh = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

/**
 * Validates YYYY-MM-DD is a real calendar date (rejects 2026-02-31).
 */
export const isValidCalendarDate = (value: string): boolean => {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
};

/**
 * Parses documentId list: absent → []; must be string array of non-empty unique ids.
 */
const parseDocumentIdList = (
  value: unknown,
  max: number,
  fieldLabel: string,
): string[] => {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return fail(
      ReservationRequestValidationErrorCode.MenuIdsInvalid,
      `${fieldLabel} must be an array of documentId strings.`,
    );
  }
  if (value.length > max) {
    return fail(
      ReservationRequestValidationErrorCode.MenuTooMany,
      `${fieldLabel} must have at most ${max} entries.`,
    );
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      return fail(
        ReservationRequestValidationErrorCode.MenuIdsInvalid,
        `${fieldLabel} entries must be non-empty documentId strings.`,
      );
    }
    const id = entry.trim();
    if (id.length > 64) {
      return fail(
        ReservationRequestValidationErrorCode.MenuIdsInvalid,
        `${fieldLabel} documentId is too long.`,
      );
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
};

/** Required bounded string, then pinned to canonical 24-hour HH:mm. */
const parsePreferredTime = (value: unknown): string => {
  const preferredTime = requiredBoundedString(
    fail,
    value,
    RESERVATION_REQUEST_LIMITS.preferredTime,
    ReservationRequestValidationErrorCode.PreferredTimeRequired,
    ReservationRequestValidationErrorCode.PreferredTimeTooLong,
    'preferredTime',
  );

  if (!TIME_PATTERN.test(preferredTime)) {
    return fail(
      ReservationRequestValidationErrorCode.PreferredTimeInvalid,
      'preferredTime must be 24-hour HH:mm (e.g. "19:00").',
    );
  }

  return preferredTime;
};

export type ParseReservationRequestOptions = {
  /** Override "today" for tests (YYYY-MM-DD in Asia/Ho_Chi_Minh semantics). */
  today?: string;
};

/**
 * Parses and validates public reservation form payload.
 * Honeypot `website` must be empty/absent; never persisted.
 * Client `status` is ignored; create data always forces status `new`.
 * Accepts legacy body key `locale` as alias for `sourceLocale`.
 * Menu arrays may be sent as `menuPackages` / `menuItems` (documentId strings).
 */
export function parseReservationRequestInput(
  raw: unknown,
  options: ParseReservationRequestOptions = {},
): ReservationRequestCreateData {
  if (!isPlainRecord(raw)) {
    return fail(
      ReservationRequestValidationErrorCode.InvalidBody,
      'Reservation request body must be a JSON object under data.',
    );
  }

  assertHoneypotClear(
    fail,
    raw.website,
    ReservationRequestValidationErrorCode.Honeypot,
    'Unable to submit reservation request.',
  );

  const fullName = requiredBoundedString(
    fail,
    raw.fullName,
    RESERVATION_REQUEST_LIMITS.fullName,
    ReservationRequestValidationErrorCode.FullNameRequired,
    ReservationRequestValidationErrorCode.FullNameTooLong,
    'fullName',
  );

  const phone = requiredBoundedString(
    fail,
    raw.phone,
    RESERVATION_REQUEST_LIMITS.phone,
    ReservationRequestValidationErrorCode.PhoneRequired,
    ReservationRequestValidationErrorCode.PhoneTooLong,
    'phone',
  );

  const email = optionalBoundedString(
    fail,
    raw.email,
    RESERVATION_REQUEST_LIMITS.email,
    ReservationRequestValidationErrorCode.EmailTooLong,
    'email',
    ReservationRequestValidationErrorCode.InvalidBody,
  );
  if (email && !isValidEmailAddress(email)) {
    return fail(
      ReservationRequestValidationErrorCode.EmailInvalid,
      'email format is invalid.',
    );
  }

  const preferredDateRaw = trimmedNonEmptyString(raw.preferredDate);
  if (!preferredDateRaw) {
    return fail(
      ReservationRequestValidationErrorCode.PreferredDateRequired,
      'preferredDate is required.',
    );
  }
  if (!isValidCalendarDate(preferredDateRaw)) {
    return fail(
      ReservationRequestValidationErrorCode.PreferredDateInvalid,
      'preferredDate must be a valid YYYY-MM-DD date.',
    );
  }
  const today = options.today ?? todayInHoChiMinh();
  if (preferredDateRaw < today) {
    return fail(
      ReservationRequestValidationErrorCode.PreferredDatePast,
      'preferredDate must be today or a future date (Asia/Ho_Chi_Minh).',
    );
  }

  const preferredTime = parsePreferredTime(raw.preferredTime);

  const guestCount = parseBoundedInt(fail, raw.guestCount, {
    min: RESERVATION_REQUEST_LIMITS.guestCountMin,
    max: RESERVATION_REQUEST_LIMITS.guestCountMax,
    requiredCode: ReservationRequestValidationErrorCode.GuestCountRequired,
    invalidCode: ReservationRequestValidationErrorCode.GuestCountInvalid,
    fieldLabel: 'guestCount',
  });

  const occasion = optionalBoundedString(
    fail,
    raw.occasion,
    RESERVATION_REQUEST_LIMITS.occasion,
    ReservationRequestValidationErrorCode.OccasionTooLong,
    'occasion',
    ReservationRequestValidationErrorCode.InvalidBody,
  );

  const note = optionalBoundedString(
    fail,
    raw.note,
    RESERVATION_REQUEST_LIMITS.note,
    ReservationRequestValidationErrorCode.NoteTooLong,
    'note',
    ReservationRequestValidationErrorCode.InvalidBody,
  );

  const menuModeRaw = trimmedNonEmptyString(raw.menuSelectionMode);
  if (!menuModeRaw || !isMenuMode(menuModeRaw)) {
    return fail(
      ReservationRequestValidationErrorCode.MenuModeInvalid,
      'menuSelectionMode must be "later" or "now".',
    );
  }

  const menuPackageIds = parseDocumentIdList(
    raw.menuPackages,
    RESERVATION_REQUEST_LIMITS.maxPackages,
    'menuPackages',
  );
  const menuItemIds = parseDocumentIdList(
    raw.menuItems,
    RESERVATION_REQUEST_LIMITS.maxItems,
    'menuItems',
  );

  if (menuModeRaw === 'later') {
    if (menuPackageIds.length > 0 || menuItemIds.length > 0) {
      return fail(
        ReservationRequestValidationErrorCode.MenuNotAllowed,
        'menuPackages and menuItems must be empty when menuSelectionMode is "later".',
      );
    }
  } else if (menuPackageIds.length === 0 && menuItemIds.length === 0) {
    return fail(
      ReservationRequestValidationErrorCode.MenuRequired,
      'At least one menuPackages or menuItems entry is required when menuSelectionMode is "now".',
    );
  }

  const sourceLocale = parseFormSourceLocale(
    fail,
    raw,
    ReservationRequestValidationErrorCode.SourceLocaleInvalid,
  );

  const sourcePath = optionalBoundedString(
    fail,
    raw.sourcePath,
    RESERVATION_REQUEST_LIMITS.sourcePath,
    ReservationRequestValidationErrorCode.SourcePathTooLong,
    'sourcePath',
    ReservationRequestValidationErrorCode.InvalidBody,
  );

  return {
    fullName,
    phone,
    ...(email ? { email } : {}),
    preferredDate: preferredDateRaw,
    preferredTime,
    guestCount,
    ...(occasion ? { occasion } : {}),
    ...(note ? { note } : {}),
    menuSelectionMode: menuModeRaw,
    menuPackageIds,
    menuItemIds,
    sourceLocale,
    ...(sourcePath ? { sourcePath } : {}),
    status: 'new',
  };
}
