import {
  LEAD_STATUS_LABELS_VI,
  RESERVATION_LEAD_STATUSES,
} from '../../shared/lead-status/lead-status';

type Row = Record<string, unknown>;

export const RESERVATION_CSV_HEADERS = [
  'Nhận lúc',
  'Họ tên',
  'Số điện thoại',
  'Email',
  'Ngày đến',
  'Giờ đến',
  'Số khách',
  'Dịp',
  'Yêu cầu của khách',
  'Gói đã chọn',
  'Món đã chọn',
  'Trạng thái',
  'Ghi chú nội bộ',
  'Trùng khung giờ',
  'Ngôn ngữ',
] as const;

export const CONTACT_CSV_HEADERS = [
  'Nhận lúc',
  'Họ tên',
  'Email',
  'Số điện thoại',
  'Chủ đề',
  'Nội dung',
  'Trạng thái',
  'Ngôn ngữ',
  'Trang gửi',
] as const;

export const NEWSLETTER_CSV_HEADERS = ['Đăng ký lúc', 'Email', 'Ngôn ngữ', 'Trang đăng ký'] as const;

const str = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

/** `dd/mm/yyyy HH:mm` in Vietnam time, the way staff read dates. */
export const toVietnamDateTime = (value: unknown): string => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return date
    .toLocaleString('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    .replace(',', '');
};

const toDayMonthYear = (isoDate: unknown): string => {
  const [year, month, day] = str(isoDate).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '';
};

// Rows saved before the status column existed hold NULL; they read as new.
const statusLabel = (value: unknown): string => {
  const status = RESERVATION_LEAD_STATUSES.find((candidate) => candidate === value) ?? 'new';
  return LEAD_STATUS_LABELS_VI[status];
};

const names = (value: unknown): string =>
  Array.isArray(value)
    ? value
        .map((entry) => str((entry as { name?: unknown } | null)?.name))
        .filter(Boolean)
        .join(', ')
    : '';

export const reservationRow = (row: Row): string[] => [
  toVietnamDateTime(row.createdAt),
  str(row.fullName),
  str(row.phone),
  str(row.email),
  toDayMonthYear(row.preferredDate),
  str(row.preferredTime),
  str(row.guestCount),
  str(row.occasion),
  str(row.note),
  names(row.menuPackages),
  names(row.menuItems),
  statusLabel(row.leadStatus),
  str(row.staffNote),
  str(row.overlapCount),
  str(row.sourceLocale),
];

export const contactRow = (row: Row): string[] => [
  toVietnamDateTime(row.createdAt),
  str(row.fullName),
  str(row.email),
  str(row.phone),
  str(row.topic),
  str(row.message),
  statusLabel(row.leadStatus),
  str(row.sourceLocale),
  str(row.sourcePath),
];

export const newsletterRow = (row: Row): string[] => [
  toVietnamDateTime(row.createdAt),
  str(row.email),
  str(row.sourceLocale),
  str(row.sourcePath),
];
