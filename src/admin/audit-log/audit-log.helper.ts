import type { IntlShape } from 'react-intl';

import { listActionsForCategory } from '../../domain/audit/audit-event-category';
import {
  AuditAction,
  AuditEventCategory,
  AuditTargetType,
} from '../../domain/audit/audit-event.types';
import { InformationStatusChipTone } from '../information-status-chip/information-status-chip.types';
import {
  ApiAuditLogPermission,
  AuditLogTranslationKey,
  type ApiAuditLogDetail,
  type ApiAuditLogSummary,
  type AuditLogDraftFilters,
  type AuditLogPermissions,
} from './audit-log.types';

const translationNamespace = 'audit-log';
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_DAY_COUNT = 30;

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const auditLogCalendarValueToDate = (value: string): Date | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return undefined;
  }
  const [, year, month, day] = match;
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const date = new Date(numericYear, numericMonth - 1, numericDay, 12, 0, 0);
  return date.getFullYear() === numericYear &&
    date.getMonth() === numericMonth - 1 &&
    date.getDate() === numericDay
    ? date
    : undefined;
};

export const auditLogDateToCalendarValue = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const readVietnamCalendarDate = (
  instant: Date,
): { day: number; month: number; year: number } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const lookup = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: lookup('year'), month: lookup('month'), day: lookup('day') };
};

const addVietnamCalendarDays = (
  date: { day: number; month: number; year: number },
  days: number,
): { day: number; month: number; year: number } => {
  const utcNoon = Date.UTC(date.year, date.month - 1, date.day, 12, 0, 0);
  return readVietnamCalendarDate(new Date(utcNoon + days * 24 * 60 * 60 * 1000));
};

const vietnamLocalMidnightUtc = (year: number, month: number, day: number): Date => {
  const isoDate = `${year}-${pad2(month)}-${pad2(day)}`;
  const utcGuess = new Date(`${isoDate}T00:00:00.000Z`);
  const stamp = new Intl.DateTimeFormat('sv-SE', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(utcGuess);
  const [datePart, timePart] = stamp.split(' ');
  const [localYear, localMonth, localDay] = datePart.split('-').map(Number);
  const [localHour, localMinute, localSecond] = timePart.split(':').map(Number);
  const localAsUtcMs = Date.UTC(
    localYear,
    localMonth - 1,
    localDay,
    localHour,
    localMinute,
    localSecond,
  );
  return new Date(utcGuess.getTime() - (localAsUtcMs - utcGuess.getTime()));
};

const ACTION_LABELS: Readonly<Record<AuditAction, string>> = {
  [AuditAction.CmsEntryCreate]: 'Tạo nội dung',
  [AuditAction.CmsEntryUpdate]: 'Cập nhật nội dung',
  [AuditAction.CmsEntryDelete]: 'Xóa nội dung',
  [AuditAction.CmsEntryPublish]: 'Xuất bản',
  [AuditAction.CmsEntryUnpublish]: 'Bỏ xuất bản',
  [AuditAction.MediaCreate]: 'Thêm media',
  [AuditAction.MediaUpdate]: 'Cập nhật media',
  [AuditAction.MediaDelete]: 'Xóa media',
  [AuditAction.MediaFolderCreate]: 'Tạo thư mục media',
  [AuditAction.MediaFolderUpdate]: 'Cập nhật thư mục media',
  [AuditAction.MediaFolderDelete]: 'Xóa thư mục media',
  [AuditAction.AdminUserCreate]: 'Tạo tài khoản Admin',
  [AuditAction.AdminUserUpdate]: 'Cập nhật tài khoản Admin',
  [AuditAction.AdminUserActivate]: 'Kích hoạt tài khoản Admin',
  [AuditAction.AdminUserDeactivate]: 'Vô hiệu hóa tài khoản Admin',
  [AuditAction.AdminUserDelete]: 'Xóa tài khoản Admin',
  [AuditAction.AdminRoleCreate]: 'Tạo vai trò Admin',
  [AuditAction.AdminRoleUpdate]: 'Cập nhật vai trò Admin',
  [AuditAction.AdminRoleDelete]: 'Xóa vai trò Admin',
  [AuditAction.AdminRolePermissionsUpdate]: 'Cập nhật quyền vai trò',
  [AuditAction.AdminLoginSuccess]: 'Đăng nhập Admin',
  [AuditAction.AdminLoginFailure]: 'Đăng nhập Admin thất bại',
  [AuditAction.AdminLogout]: 'Đăng xuất Admin',
  [AuditAction.ApiTokenCreate]: 'Tạo API token',
  [AuditAction.ApiTokenUpdate]: 'Cập nhật API token',
  [AuditAction.ApiTokenRegenerate]: 'Tạo lại API token',
  [AuditAction.ApiTokenRevoke]: 'Thu hồi API token',
  [AuditAction.TransferTokenCreate]: 'Tạo transfer token',
  [AuditAction.TransferTokenUpdate]: 'Cập nhật transfer token',
  [AuditAction.TransferTokenRegenerate]: 'Tạo lại transfer token',
  [AuditAction.TransferTokenRevoke]: 'Thu hồi transfer token',
  [AuditAction.WebhookCreate]: 'Tạo webhook',
  [AuditAction.WebhookUpdate]: 'Cập nhật webhook',
  [AuditAction.WebhookDelete]: 'Xóa webhook',
  [AuditAction.NotificationSettingsUpdate]: 'Cập nhật email thông báo',
};

const CATEGORY_VALUES = new Set<string>(Object.values(AuditEventCategory));
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  content: 'Nội dung',
  account: 'Tài khoản',
  security: 'Bảo mật',
  error: 'Lỗi',
};

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  admin_panel: 'Admin',
  system_process: 'Hệ thống',
};

const TARGET_TYPE_LABELS: Readonly<Record<AuditTargetType, string>> = {
  [AuditTargetType.Authentication]: 'Đăng nhập',
  [AuditTargetType.CmsEntry]: 'Nội dung CMS',
  [AuditTargetType.Media]: 'Tệp media',
  [AuditTargetType.MediaFolder]: 'Thư mục media',
  [AuditTargetType.AdminUser]: 'Tài khoản Admin',
  [AuditTargetType.AdminRole]: 'Vai trò Admin',
  [AuditTargetType.ApiToken]: 'API token',
  [AuditTargetType.TransferToken]: 'Transfer token',
  [AuditTargetType.Webhook]: 'Webhook',
  [AuditTargetType.Setting]: 'Cài đặt hệ thống',
};

/**
 * Vietnamese display names of the Salanca content types, mirroring each
 * schema's info.displayName, so ledger rows read "Tin nhắn liên hệ" instead
 * of a raw UID.
 */
const CONTENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  'api::booking-page.booking-page': 'Trang đặt bàn',
  'api::campaign.campaign': 'Ưu đãi / sự kiện',
  'api::campaign-page.campaign-page': 'Trang ưu đãi',
  'api::contact-message.contact-message': 'Tin nhắn liên hệ',
  'api::contact-page.contact-page': 'Trang liên hệ',
  'api::experience-page.experience-page': 'Trang trải nghiệm',
  'api::footer-setting.footer-setting': 'Chân trang',
  'api::gallery-item.gallery-item': 'Ảnh gallery',
  'api::global-setting.global-setting': 'Cấu hình chung',
  'api::header-setting.header-setting': 'Đầu trang',
  'api::home-page.home-page': 'Trang chủ',
  'api::location.location': 'Chi nhánh',
  'api::menu-category.menu-category': 'Nhóm món',
  'api::menu-item.menu-item': 'Món',
  'api::menu-package.menu-package': 'Gói buffet',
  'api::menu-page.menu-page': 'Trang thực đơn',
  'api::reservation-request.reservation-request': 'Yêu cầu đặt bàn',
  'api::space-page.space-page': 'Trang không gian',
  'api::story-page.story-page': 'Trang câu chuyện',
};

export const auditLogContentTypeLabel = (
  uid: string | null | undefined,
): string | null => (uid ? CONTENT_TYPE_LABELS[uid] ?? null : null);

const SINGLE_TYPE_UIDS = new Set([
  'api::booking-page.booking-page',
  'api::campaign-page.campaign-page',
  'api::contact-page.contact-page',
  'api::experience-page.experience-page',
  'api::footer-setting.footer-setting',
  'api::global-setting.global-setting',
  'api::header-setting.header-setting',
  'api::home-page.home-page',
  'api::menu-page.menu-page',
  'api::space-page.space-page',
  'api::story-page.story-page',
]);

export const auditLogPermissions: AuditLogPermissions = {
  read: [{ action: ApiAuditLogPermission.Read, subject: null }],
  details: [{ action: ApiAuditLogPermission.Details, subject: null }],
  export: [{ action: ApiAuditLogPermission.Export, subject: null }],
};

export const getAuditLogTranslationId = (key: AuditLogTranslationKey): string =>
  `${translationNamespace}.${key}`;

export const formatAuditLogMessage = (
  intl: IntlShape,
  key: AuditLogTranslationKey,
): string => intl.formatMessage({ id: getAuditLogTranslationId(key) });

export const formatAuditLogAction = (action: string, _targetType?: string): string =>
  ACTION_LABELS[action as AuditAction] ?? 'Hoạt động hệ thống';

export const listAuditLogActionOptions = (
  category?: string,
): ReadonlyArray<{ label: string; value: string }> => {
  const actions =
    category && CATEGORY_VALUES.has(category) && category !== AuditEventCategory.Error
      ? listActionsForCategory(category as AuditEventCategory)
      : Object.values(AuditAction);

  return [...actions]
    .map((value) => ({ label: formatAuditLogAction(value), value }))
    .sort((left, right) => left.label.localeCompare(right.label, 'vi'));
};

export const formatAuditLogActor = (actorLabel: string): string => actorLabel.trim();

export const countActiveAuditLogFilters = (draft: AuditLogDraftFilters): number =>
  [draft.search.trim(), draft.category, draft.action, draft.source, draft.success].filter(
    (value) => value.length > 0,
  ).length;

export const formatAuditLogCategory = (category: string): string =>
  CATEGORY_LABELS[category] ?? 'Nội dung';

export const formatAuditLogSource = (source: string): string =>
  SOURCE_LABELS[source] ?? 'Chưa xác định';

export const listAuditLogSourceOptions = (): ReadonlyArray<{
  label: string;
  value: string;
}> => Object.entries(SOURCE_LABELS).map(([value, label]) => ({ label, value }));

export interface AuditLogTargetDisplay {
  accessibleLabel: string;
  detail: string | null;
  fullIdentifier: string | null;
  typeLabel: string;
}

const compactAuditLogIdentifier = (value: string): string =>
  value.length <= 18 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;

export const formatAuditLogTarget = (
  target: Pick<
    ApiAuditLogSummary,
    'targetId' | 'targetLabel' | 'targetType' | 'targetUid'
  >,
): AuditLogTargetDisplay => {
  const typeLabel =
    auditLogContentTypeLabel(target.targetUid) ??
    (target.targetType
      ? TARGET_TYPE_LABELS[target.targetType as AuditTargetType] ?? 'Đối tượng hệ thống'
      : 'Đối tượng hệ thống');
  const targetId = target.targetId?.trim() || null;
  const storedLabel = target.targetLabel.trim();
  const hasMeaningfulLabel =
    storedLabel.length > 0 &&
    storedLabel !== targetId &&
    storedLabel !== 'Không xác định';
  const detail = hasMeaningfulLabel
    ? storedLabel
    : targetId
      ? `Mã: ${compactAuditLogIdentifier(targetId)}`
      : null;

  return {
    accessibleLabel: detail ? `${typeLabel}, ${detail}` : typeLabel,
    detail,
    fullIdentifier: targetId,
    typeLabel,
  };
};

export const auditLogResultTone = (success: boolean): InformationStatusChipTone =>
  success ? InformationStatusChipTone.Published : InformationStatusChipTone.Warning;

export const formatAuditLogDateTime = (iso: string): string =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));

export const toVietnamInputDate = (instant: Date): string => {
  const local = readVietnamCalendarDate(instant);
  return `${local.year}-${pad2(local.month)}-${pad2(local.day)}`;
};

export const defaultAuditLogDraftFilters = (
  now: Date = new Date(),
): AuditLogDraftFilters => {
  const today = readVietnamCalendarDate(now);
  const from = addVietnamCalendarDays(today, -(DEFAULT_DAY_COUNT - 1));
  return {
    action: '',
    category: '',
    from: `${from.year}-${pad2(from.month)}-${pad2(from.day)}`,
    search: '',
    source: '',
    success: '',
    to: `${today.year}-${pad2(today.month)}-${pad2(today.day)}`,
  };
};

export const toggleAuditLogQuickCategory = (
  draft: AuditLogDraftFilters,
  category: string,
): AuditLogDraftFilters => {
  if (draft.category === category) {
    return {
      ...draft,
      action: '',
      category: '',
      success: category === AuditEventCategory.Error ? '' : draft.success,
    };
  }

  return {
    ...draft,
    action: '',
    category,
    success:
      category === AuditEventCategory.Error
        ? 'false'
        : draft.category === AuditEventCategory.Error
          ? ''
          : draft.success,
  };
};

export const draftFiltersToUrlParams = (
  draft: AuditLogDraftFilters,
  page: number,
): Record<string, string> => {
  const params: Record<string, string> = {
    page: String(page),
    from: draft.from,
    to: draft.to,
  };
  if (draft.search.trim()) {
    params.search = draft.search.trim();
  }
  if (draft.category) {
    params.category = draft.category;
  }
  if (draft.action) {
    params.action = draft.action;
  }
  if (draft.source) {
    params.source = draft.source;
  }
  if (draft.success) {
    params.success = draft.success;
  }
  return params;
};

const readCalendarDateParam = (
  value: string | null,
  fallback: string,
  options: Readonly<{ exclusiveEnd?: boolean }> = {},
): string => {
  if (!value) {
    return fallback;
  }
  if (DATE_ONLY_PATTERN.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  if (options.exclusiveEnd) {
    const local = readVietnamCalendarDate(parsed);
    const end = addVietnamCalendarDays(local, -1);
    return `${end.year}-${pad2(end.month)}-${pad2(end.day)}`;
  }
  return toVietnamInputDate(parsed);
};

export const queryParamsToDraftFilters = (
  params: URLSearchParams,
  now: Date = new Date(),
): { draft: AuditLogDraftFilters; page: number } => {
  const defaults = defaultAuditLogDraftFilters(now);
  const pageValue = params.get('page') ?? '1';
  const page = /^\d+$/.test(pageValue) && Number(pageValue) >= 1 ? Number(pageValue) : 1;
  return {
    page,
    draft: {
      action: params.get('action')?.trim() ?? '',
      category: params.get('category')?.trim() ?? '',
      from: readCalendarDateParam(params.get('from'), defaults.from),
      search: params.get('search')?.trim() ?? '',
      source: params.get('source')?.trim() ?? '',
      success: params.get('success')?.trim() ?? '',
      to: readCalendarDateParam(
        params.get('to') ?? params.get('toExclusive'),
        defaults.to,
        { exclusiveEnd: Boolean(params.get('toExclusive') && !params.get('to')) },
      ),
    },
  };
};

export const draftFiltersToQuery = (
  draft: AuditLogDraftFilters,
  page: number,
): Record<string, string> => {
  const [fromYear, fromMonth, fromDay] = draft.from.split('-').map(Number);
  const [toYear, toMonth, toDay] = draft.to.split('-').map(Number);
  const toExclusive = addVietnamCalendarDays(
    { year: toYear, month: toMonth, day: toDay },
    1,
  );
  const params: Record<string, string> = {
    page: String(page),
    from: vietnamLocalMidnightUtc(fromYear, fromMonth, fromDay).toISOString(),
    toExclusive: vietnamLocalMidnightUtc(
      toExclusive.year,
      toExclusive.month,
      toExclusive.day,
    ).toISOString(),
  };
  if (draft.search.trim()) {
    params.search = draft.search.trim();
  }
  if (draft.category) {
    params.category = draft.category;
  }
  if (draft.action) {
    params.action = draft.action;
  }
  if (draft.source) {
    params.eventSource = draft.source;
  }
  if (draft.success) {
    params.success = draft.success;
  }
  return params;
};

export const parseAuditLogListResponse = (
  payload: unknown,
): { items: readonly ApiAuditLogSummary[]; pageCount: number; total: number } => {
  if (!payload || typeof payload !== 'object') {
    return { items: [], pageCount: 1, total: 0 };
  }
  const candidate = payload as {
    data?: unknown;
    meta?: { pagination?: { pageCount?: unknown; total?: unknown } };
  };
  const items = Array.isArray(candidate.data)
    ? candidate.data.filter((item): item is ApiAuditLogSummary => {
        if (!item || typeof item !== 'object') {
          return false;
        }
        const row = item as Partial<ApiAuditLogSummary>;
        return typeof row.eventId === 'string' && typeof row.occurredAt === 'string';
      })
    : [];
  const pageCount =
    typeof candidate.meta?.pagination?.pageCount === 'number'
      ? candidate.meta.pagination.pageCount
      : 1;
  const total =
    typeof candidate.meta?.pagination?.total === 'number'
      ? candidate.meta.pagination.total
      : items.length;
  return { items, pageCount, total };
};

export const parseAuditLogDetailResponse = (payload: unknown): ApiAuditLogDetail | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') {
    return null;
  }
  const row = data as Partial<ApiAuditLogDetail>;
  if (typeof row.eventId !== 'string' || typeof row.requestId !== 'string') {
    return null;
  }
  return row as ApiAuditLogDetail;
};

const AUDIT_VALUE_LABELS: Readonly<Record<string, string>> = {
  locale: 'Ngôn ngữ',
  maskedIdentifier: 'Định danh đã che',
  publicationStatus: 'Trạng thái xuất bản',
};

const PUBLICATION_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Bản nháp',
  published: 'Đã xuất bản',
};

const auditValueLabel = (key: string): string => AUDIT_VALUE_LABELS[key] ?? key;

const formatAuditValue = (key: string, value: string | number | boolean): string => {
  if (key === 'publicationStatus') {
    return PUBLICATION_STATUS_LABELS[String(value)] ?? String(value);
  }
  return String(value);
};

export const allowlistedTargetPath = (
  targetUid: string | null | undefined,
  targetId: string | null | undefined,
): string | null => {
  if (!targetUid || !CONTENT_TYPE_LABELS[targetUid]) {
    return null;
  }
  if (SINGLE_TYPE_UIDS.has(targetUid)) {
    return `/content-manager/single-types/${targetUid}`;
  }
  if (!targetId) {
    return null;
  }
  return `/content-manager/collection-types/${targetUid}/${targetId}`;
};

export const readChangedFields = (values: unknown): readonly string[] => {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return [];
  }
  const changed = (values as { changedFields?: unknown }).changedFields;
  return Array.isArray(changed)
    ? changed.filter((entry): entry is string => typeof entry === 'string')
    : [];
};

export const readAuditLogValueRows = (
  values: unknown,
): ReadonlyArray<{ key: string; value: string }> => {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return [];
  }

  return Object.entries(values as Record<string, unknown>)
    .filter(([key, value]) => key !== 'changedFields' && value != null)
    .flatMap(([key, value]) => {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        return [{ key: auditValueLabel(key), value: formatAuditValue(key, value) }];
      }
      return [];
    })
    .sort((left, right) => left.key.localeCompare(right.key));
};
