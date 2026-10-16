/**
 * The operational alert codes (contracts §12, + O15 `audit-tampered`) and their staff-facing
 * labels (+ O8 `low-rating`). The set is fixed: alert rules, the alert engine and the ops-alert email all key off this list.
 */
export const ALERT_CODES = [
  'webhook-failing',
  'webhook-endpoint-disabled',
  'payment-unmatched',
  'outbox-stuck',
  'job-heartbeat-missed',
  'order-awaiting-acceptance',
  'reconciliation-mismatch',
  'manual-payment-unconfirmed',
  'cash-closing-mismatch',
  'audit-tampered',
  'notification-template-broken',
  'notification-daily-limit',
  'low-rating',
  'gift-card-probing',
  'gift-card-underfunded',
  'table-session-open',
  'data-request-overdue',
  'carrier-operation-unknown',
] as const;

export type AlertCode = (typeof ALERT_CODES)[number];

export const isAlertCode = (value: string): value is AlertCode =>
  (ALERT_CODES as readonly string[]).includes(value);

const labels: Record<AlertCode, { vi: string; en: string }> = {
  'webhook-failing': { vi: 'Webhook thanh toán lỗi liên tiếp', en: 'Payment webhook failing' },
  'webhook-endpoint-disabled': {
    vi: 'Endpoint webhook tự tắt sau 50 lỗi liên tiếp',
    en: 'Webhook endpoint auto-disabled after 50 failures',
  },
  'payment-unmatched': { vi: 'Tiền về không khớp đơn', en: 'Unmatched incoming transfer' },
  'outbox-stuck': { vi: 'Hàng đợi gửi bị kẹt', en: 'Outbox stuck' },
  'job-heartbeat-missed': { vi: 'Job định kỳ im lặng', en: 'Scheduled job silent' },
  'order-awaiting-acceptance': { vi: 'Đơn chờ nhận quá lâu', en: 'Order awaiting acceptance' },
  'reconciliation-mismatch': { vi: 'Đối soát không khớp', en: 'Reconciliation mismatch' },
  'manual-payment-unconfirmed': {
    vi: 'Chuyển khoản ghi tay chưa xác nhận',
    en: 'Manual transfer unconfirmed',
  },
  'cash-closing-mismatch': { vi: 'Chốt tiền mặt chênh lệch', en: 'Cash closing mismatch' },
  'audit-tampered': { vi: 'Lịch sử thay đổi bị sửa ngoài hệ thống', en: 'Audit log tampered' },
  'notification-template-broken': {
    vi: 'Mẫu email tùy biến lỗi, đã dùng mẫu mặc định',
    en: 'Custom email template failed, the default was used',
  },
  'notification-daily-limit': {
    vi: 'Đã chạm hạn mức tin Zalo/SMS trong ngày, đang dùng kênh dự phòng',
    en: 'Daily Zalo/SMS message limit reached, falling back to cheaper channels',
  },
  'low-rating': { vi: 'Khách đánh giá thấp', en: 'Low customer rating' },
  'gift-card-probing': { vi: 'Dò mã thẻ quà tặng', en: 'Gift-card code probing' },
  'gift-card-underfunded': {
    vi: 'Đơn bán thẻ quà tặng không còn đủ tiền để phát thẻ',
    en: 'Gift-card order no longer holds the money for its cards',
  },
  'table-session-open': {
    vi: 'Phiên bàn chưa đóng sau giờ cuối ngày',
    en: 'Table session left open after business day end',
  },
  'data-request-overdue': {
    vi: 'Yêu cầu dữ liệu cá nhân quá hạn xử lý',
    en: 'Personal-data request past its deadline',
  },
  'carrier-operation-unknown': {
    vi: 'Kết quả gọi/hủy xe của đối tác chưa rõ, cần đối soát',
    en: 'Carrier call result unknown, needs reconciliation',
  },
};

export const alertLabel = (code: string, locale: string | null | undefined): string =>
  labels[code as AlertCode]?.[locale === 'en' ? 'en' : 'vi'] ?? code;
