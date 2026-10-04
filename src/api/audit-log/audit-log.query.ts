import { AuditAction, AuditEventCategory, AuditEventSource } from '../../domain/audit/audit-event.types';
import { trimmedNonEmptyString } from '../../shared/normalization/value';

import {
  AUDIT_LOG_EXPORT_MAX_CALENDAR_DAYS,
  AUDIT_LOG_SEARCH_MAX_CALENDAR_DAYS,
  calendarDaysBetween,
} from './audit-log.date';
import { AuditLogError } from './audit-log.error';
import {
  AUDIT_LOG_DEFAULT_PAGE_SIZE,
  AUDIT_LOG_MAX_PAGE_SIZE,
  AUDIT_LOG_SEARCH_MAX_LENGTH,
  AUDIT_LOG_SEARCH_MIN_LENGTH,
  AuditLogErrorCode,
  type ApiAuditLogListQuery,
} from './audit-log.types';

type QueryValue = string | string[] | number | boolean | undefined;
type QueryCandidate = Record<string, QueryValue>;

export const AUDIT_LOG_ACTOR_LABEL_PREFIX_SQL =
  'lower(actor_label) LIKE ? ESCAPE ?';
export const AUDIT_LOG_TARGET_LABEL_PREFIX_SQL =
  'lower(target_label) LIKE ? ESCAPE ?';

const ACTION_VALUES = new Set<string>(Object.values(AuditAction));
const CATEGORY_VALUES = new Set<string>(Object.values(AuditEventCategory));
const SOURCE_VALUES = new Set<string>(Object.values(AuditEventSource));

const invalidQuery = (field: string, detail: string, vietnamese: string): never => {
  throw new AuditLogError(
    AuditLogErrorCode.InvalidQuery,
    `Invalid audit log query field ${field}: ${detail}`,
    vietnamese,
  );
};

const readRecord = (value: unknown): QueryCandidate => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as QueryCandidate;
};

const readOptionalString = (value: QueryValue, field: string): string | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    return invalidQuery(field, 'must be a string', `Tham số "${field}" không hợp lệ.`);
  }
  return trimmedNonEmptyString(value) ?? undefined;
};

const readPositiveInt = (
  value: QueryValue,
  field: string,
  fallback: number,
  maximum?: number,
): number => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const raw = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(raw) || raw < 1) {
    return invalidQuery(field, 'must be an integer >= 1', `Tham số "${field}" không hợp lệ.`);
  }
  if (maximum !== undefined && raw > maximum) {
    return invalidQuery(
      field,
      `must be <= ${maximum}`,
      `Tham số "${field}" không được vượt quá ${maximum}.`,
    );
  }
  return raw;
};

const readIsoInstant = (value: string | undefined, field: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return invalidQuery(
      field,
      'must be an ISO 8601 instant',
      `Tham số "${field}" phải là thời điểm UTC hợp lệ.`,
    );
  }
  return date.toISOString();
};

const readBoolean = (value: QueryValue, field: string): boolean | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return invalidQuery(field, 'must be boolean', `Tham số "${field}" không hợp lệ.`);
};

const assertDateRange = (
  from: string | undefined,
  toExclusive: string | undefined,
  options: Readonly<{ requireBoth: boolean; maxDays: number; missingMessage: string }>,
): void => {
  if (!from && !toExclusive && !options.requireBoth) {
    return;
  }

  if (!from || !toExclusive) {
    throw new AuditLogError(
      AuditLogErrorCode.InvalidQuery,
      'Date range requires from and toExclusive.',
      options.missingMessage,
    );
  }

  const fromDate = new Date(from);
  const toDate = new Date(toExclusive);
  if (!(fromDate.getTime() < toDate.getTime())) {
    throw new AuditLogError(
      AuditLogErrorCode.InvalidQuery,
      'from must be earlier than toExclusive.',
      'Ngày bắt đầu phải trước ngày kết thúc.',
    );
  }

  if (calendarDaysBetween(fromDate, toDate) > options.maxDays) {
    throw new AuditLogError(
      AuditLogErrorCode.InvalidQuery,
      `Date range exceeds ${options.maxDays} days.`,
      `Khoảng thời gian không được vượt quá ${options.maxDays} ngày.`,
    );
  }
};

export const parseAuditLogListQuery = (
  value: unknown,
  options: Readonly<{ requireSearchRange?: boolean }> = {},
): ApiAuditLogListQuery => {
  const candidate = readRecord(value);
  const search = readOptionalString(candidate.search, 'search');
  if (search !== undefined) {
    if (
      search.length < AUDIT_LOG_SEARCH_MIN_LENGTH ||
      search.length > AUDIT_LOG_SEARCH_MAX_LENGTH
    ) {
      throw new AuditLogError(
        AuditLogErrorCode.InvalidQuery,
        'Search must be 2-100 characters.',
        'Từ khóa tìm kiếm phải từ 2 đến 100 ký tự.',
      );
    }
  }

  const from = readIsoInstant(readOptionalString(candidate.from, 'from'), 'from');
  const toExclusive = readIsoInstant(
    readOptionalString(candidate.toExclusive, 'toExclusive'),
    'toExclusive',
  );

  assertDateRange(from, toExclusive, {
    requireBoth: options.requireSearchRange === true || Boolean(search),
    maxDays: AUDIT_LOG_SEARCH_MAX_CALENDAR_DAYS,
    missingMessage:
      'Tìm kiếm cần chọn khoảng thời gian Từ ngày và Đến ngày không quá 366 ngày.',
  });

  const action = readOptionalString(candidate.action, 'action');
  if (action && !ACTION_VALUES.has(action)) {
    return invalidQuery('action', 'unknown action', 'Hành động không hợp lệ.');
  }

  const category = readOptionalString(candidate.category, 'category');
  if (category && !CATEGORY_VALUES.has(category)) {
    return invalidQuery('category', 'unknown category', 'Nhóm không hợp lệ.');
  }

  const eventSource = readOptionalString(candidate.eventSource, 'eventSource');
  if (eventSource && !SOURCE_VALUES.has(eventSource)) {
    return invalidQuery('eventSource', 'unknown source', 'Nguồn sự kiện không hợp lệ.');
  }

  return {
    page: readPositiveInt(candidate.page, 'page', 1),
    pageSize: readPositiveInt(
      candidate.pageSize,
      'pageSize',
      AUDIT_LOG_DEFAULT_PAGE_SIZE,
      AUDIT_LOG_MAX_PAGE_SIZE,
    ),
    ...(search ? { search } : {}),
    ...(action ? { action: action as AuditAction } : {}),
    ...(category ? { category: category as AuditEventCategory } : {}),
    ...(eventSource ? { eventSource: eventSource as AuditEventSource } : {}),
    ...(from ? { from } : {}),
    ...(toExclusive ? { toExclusive } : {}),
    success: readBoolean(candidate.success, 'success'),
  };
};

export const parseAuditLogExportQuery = (value: unknown): ApiAuditLogListQuery => {
  const query = parseAuditLogListQuery(value, { requireSearchRange: true });
  assertDateRange(query.from, query.toExclusive, {
    requireBoth: true,
    maxDays: AUDIT_LOG_EXPORT_MAX_CALENDAR_DAYS,
    missingMessage: 'Xuất CSV cần khoảng thời gian không quá 31 ngày.',
  });
  return query;
};

export const parseAuditLogEventId = (value: unknown): string => {
  const eventId = trimmedNonEmptyString(value);
  if (!eventId || eventId.length > 64) {
    throw new AuditLogError(
      AuditLogErrorCode.InvalidQuery,
      'eventId is invalid.',
      'Mã nhật ký không hợp lệ.',
    );
  }
  return eventId;
};

export const escapePrefixSearch = (value: string): string =>
  value
    .split('\\')
    .join('\\\\')
    .split('%')
    .join('\\%')
    .split('_')
    .join('\\_');
