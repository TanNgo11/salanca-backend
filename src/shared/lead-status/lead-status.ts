/**
 * Lead workflow statuses, shared by the inbox API, Admin screens and CSV
 * export. Reservations have the full call-back workflow; contact messages
 * (and newsletter sign-ups, which ride on them) keep the original three.
 */
export const RESERVATION_LEAD_STATUSES = [
  'new',
  'read',
  'confirmed',
  'cancelled',
  'no_show',
  'archived',
] as const;
export type ReservationLeadStatus = (typeof RESERVATION_LEAD_STATUSES)[number];

export const CONTACT_LEAD_STATUSES = ['new', 'read', 'archived'] as const;
export type ContactLeadStatus = (typeof CONTACT_LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS_VI: Record<ReservationLeadStatus, string> = {
  new: 'Mới',
  read: 'Đã đọc',
  confirmed: 'Đã xác nhận',
  cancelled: 'Đã huỷ',
  no_show: 'Khách không đến',
  archived: 'Lưu trữ',
};

export const RESERVATION_STAFF_NOTE_MAX_LENGTH = 2000;
