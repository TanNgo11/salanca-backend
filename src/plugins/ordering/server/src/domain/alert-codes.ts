/**
 * The eight operational alert codes (contracts §12) and their staff-facing labels. The set is
 * fixed: alert rules, the alert engine and the ops-alert email all key off this list.
 */
export const ALERT_CODES = [
  'webhook-failing',
  'payment-unmatched',
  'outbox-stuck',
  'job-heartbeat-missed',
  'order-awaiting-acceptance',
  'reconciliation-mismatch',
  'manual-payment-unconfirmed',
  'cash-closing-mismatch',
] as const;

export type AlertCode = (typeof ALERT_CODES)[number];

export const isAlertCode = (value: string): value is AlertCode =>
  (ALERT_CODES as readonly string[]).includes(value);

const labels: Record<AlertCode, { vi: string; en: string }> = {
  'webhook-failing': { vi: 'Webhook thanh toán lỗi liên tiếp', en: 'Payment webhook failing' },
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
};

export const alertLabel = (code: string, locale: string | null | undefined): string =>
  labels[code as AlertCode]?.[locale === 'en' ? 'en' : 'vi'] ?? code;
