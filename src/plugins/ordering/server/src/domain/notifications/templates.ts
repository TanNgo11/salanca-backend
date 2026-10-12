/**
 * Email templates (contracts §14; plan step 11). Pure: the caller passes already-safe data. VI is
 * the default; EN when the order was placed in English. Plain text plus a minimal HTML body with
 * every interpolated value escaped.
 */
export type TemplateCode =
  | 'staff.order-created'
  | 'staff.order-overdue'
  | 'staff.ops-alert'
  | 'customer.order-placed'
  | 'customer.order-accepted'
  | 'customer.order-delayed'
  | 'customer.order-ready'
  | 'customer.order-delivered'
  | 'customer.order-rejected'
  | 'customer.order-canceled'
  | 'customer.delivery-out'
  | 'customer.delivery-delivered'
  | 'customer.delivery-failed'
  | 'customer.delivery-retry';

export type TemplateData = {
  code: string;
  branchName: string;
  total: number;
  items: Array<{ title: string; quantity: number }>;
  pickupLabel?: string;
  deliveryLabel?: string;
  readyLabel?: string;
  reason?: string;
  link?: string;
  customerName?: string;
  note?: string;
};

type Locale = 'vi' | 'en';

export const formatVnd = (amount: number): string =>
  `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;

/** `12:30 · 12/10` in the branch timezone. */
export const formatLocalTime = (iso: string, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
  return `${part('hour')}:${part('minute')} · ${part('day')}/${part('month')}`;
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const copy: Record<TemplateCode, Record<Locale, { subject: string; lead: string }>> = {
  'staff.order-created': {
    vi: { subject: 'Đơn mới {code} · {branch}', lead: 'Có đơn mới cần nhận.' },
    en: { subject: 'New order {code} · {branch}', lead: 'A new order is waiting for acceptance.' },
  },
  'staff.order-overdue': {
    vi: { subject: 'Đơn {code} đang chờ nhận quá lâu', lead: 'Đơn tại {branch} chưa được nhận, khách đang chờ.' },
    en: { subject: 'Order {code} is waiting too long', lead: 'An order at {branch} has not been accepted yet.' },
  },
  // `staff.ops-alert` renders through `renderOpsAlert`; this entry only satisfies the copy record.
  'staff.ops-alert': {
    vi: { subject: '[Bán hàng] Cảnh báo', lead: '' },
    en: { subject: '[Ordering] Alert', lead: '' },
  },
  'customer.order-placed': {
    vi: { subject: 'Đã nhận đơn {code}', lead: 'Cảm ơn bạn! {branch} đã nhận đơn và sẽ xác nhận sớm.' },
    en: { subject: 'Order {code} received', lead: 'Thank you! {branch} has your order and will confirm it soon.' },
  },
  'customer.order-accepted': {
    vi: { subject: 'Đơn {code} đã được xác nhận', lead: '{branch} đã nhận đơn của bạn.' },
    en: { subject: 'Order {code} confirmed', lead: '{branch} has accepted your order.' },
  },
  'customer.order-delayed': {
    vi: { subject: 'Đơn {code}: giờ lấy mới', lead: '{branch} đã nhận đơn và cần thêm chút thời gian.' },
    en: { subject: 'Order {code}: new pickup time', lead: '{branch} accepted your order and needs a little more time.' },
  },
  'customer.order-ready': {
    vi: { subject: 'Đơn {code} đã sẵn sàng', lead: 'Món của bạn đã xong, mời bạn đến {branch} nhận.' },
    en: { subject: 'Order {code} is ready', lead: 'Your order is ready for pickup at {branch}.' },
  },
  'customer.order-delivered': {
    vi: { subject: 'Cảm ơn bạn đã đặt {code}', lead: 'Đơn đã hoàn tất. Hẹn gặp lại!' },
    en: { subject: 'Thanks for order {code}', lead: 'Your order is complete. See you again!' },
  },
  'customer.order-rejected': {
    vi: { subject: 'Đơn {code} chưa thể thực hiện', lead: 'Rất tiếc, {branch} chưa nhận được đơn này.' },
    en: { subject: 'Order {code} could not be accepted', lead: 'Sorry, {branch} could not accept this order.' },
  },
  'customer.order-canceled': {
    vi: { subject: 'Đơn {code} đã hủy', lead: 'Đơn của bạn tại {branch} đã được hủy.' },
    en: { subject: 'Order {code} canceled', lead: 'Your order at {branch} has been canceled.' },
  },
  'customer.delivery-out': {
    vi: { subject: 'Đơn {code} đang được giao', lead: '{branch} đang giao đơn của bạn — người giao sẽ tới sớm.' },
    en: { subject: 'Order {code} is on its way', lead: '{branch} has sent your order out — the courier will arrive soon.' },
  },
  'customer.delivery-delivered': {
    vi: { subject: 'Đơn {code} đã giao xong', lead: 'Đơn của bạn đã được giao. Cảm ơn bạn!' },
    en: { subject: 'Order {code} delivered', lead: 'Your order was delivered. Thank you!' },
  },
  'customer.delivery-failed': {
    vi: {
      subject: 'Đơn {code} giao chưa thành công',
      lead: 'Người giao chưa giao được đơn — {branch} sẽ liên hệ hoặc giao lại cho bạn.',
    },
    en: {
      subject: 'Delivery of order {code} failed',
      lead: 'The courier could not deliver your order — {branch} will contact you or try again.',
    },
  },
  'customer.delivery-retry': {
    vi: { subject: 'Đơn {code} sẽ được giao lại', lead: '{branch} đang chuẩn bị một chuyến giao mới cho đơn của bạn.' },
    en: { subject: 'Order {code} will be redelivered', lead: '{branch} is preparing another delivery for your order.' },
  },
};

const labels: Record<Locale, Record<string, string>> = {
  vi: {
    pickup: 'Giờ lấy',
    delivery: 'Giao lúc',
    ready: 'Dự kiến sẵn sàng',
    total: 'Tổng',
    reason: 'Lý do',
    note: 'Ghi chú',
    link: 'Xem đơn',
    lookup: 'Tra cứu đơn bằng mã đơn và số điện thoại trên website.',
    customer: 'Khách',
  },
  en: {
    pickup: 'Pickup',
    delivery: 'Delivery at',
    ready: 'Estimated ready',
    total: 'Total',
    reason: 'Reason',
    note: 'Note',
    link: 'View order',
    lookup: 'Look up the order on the website with its code and your phone number.',
    customer: 'Customer',
  },
};

export function renderTemplate(
  template: TemplateCode,
  localeInput: string | null | undefined,
  data: TemplateData,
): { subject: string; text: string; html: string } {
  const locale: Locale = localeInput === 'en' ? 'en' : 'vi';
  const words = labels[locale];
  const fill = (value: string) => value.replaceAll('{code}', data.code).replaceAll('{branch}', data.branchName);
  const { subject, lead } = copy[template][locale];
  const rows: Array<[string, string]> = [];
  if (data.customerName && template.startsWith('staff.')) rows.push([words.customer, data.customerName]);
  if (data.pickupLabel) rows.push([words.pickup, data.pickupLabel]);
  if (data.deliveryLabel) rows.push([words.delivery, data.deliveryLabel]);
  if (data.readyLabel) rows.push([words.ready, data.readyLabel]);
  if (data.reason) rows.push([words.reason, data.reason]);
  if (data.note) rows.push([words.note, data.note]);
  rows.push([words.total, formatVnd(data.total)]);
  const items = data.items.map((item) => `${item.quantity} × ${item.title}`);
  const footer = template.startsWith('customer.') ? (data.link ? `${words.link}: ${data.link}` : words.lookup) : '';
  const text = [fill(lead), '', ...items, '', ...rows.map(([key, value]) => `${key}: ${value}`), '', footer]
    .join('\n')
    .trim();
  const html = [
    `<p>${escapeHtml(fill(lead))}</p>`,
    `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`,
    `<table>${rows.map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td><strong>${escapeHtml(value)}</strong></td></tr>`).join('')}</table>`,
    footer
      ? data.link && template.startsWith('customer.')
        ? `<p><a href="${escapeHtml(data.link)}">${escapeHtml(words.link)}</a></p>`
        : `<p>${escapeHtml(footer)}</p>`
      : '',
  ].join('\n');
  return { subject: fill(subject), text, html };
}

/** Ops-alert mail data: refs and counts only, never PII (contracts §12). */
export type OpsAlertData = {
  label: string;
  severity: 'info' | 'warning' | 'critical';
  count: number;
  firstSeen: string;
  lastSeen: string;
  branchRef?: string;
  aggregateRef?: string;
};

const opsAlertLabels: Record<Locale, Record<string, string>> = {
  vi: {
    lead: 'Hệ thống bán hàng vừa ghi nhận một cảnh báo vận hành.',
    type: 'Loại',
    count: 'Số lần',
    first: 'Lần đầu',
    last: 'Gần nhất',
    branch: 'Chi nhánh',
    ref: 'Tham chiếu',
    action: 'Vào Admin → Bán hàng → Cảnh báo để xem và bấm Đã biết.',
  },
  en: {
    lead: 'The ordering system recorded an operational alert.',
    type: 'Type',
    count: 'Occurrences',
    first: 'First seen',
    last: 'Last seen',
    branch: 'Branch',
    ref: 'Reference',
    action: 'Open Admin → Ordering → Alerts to review and press Acknowledge.',
  },
};

/** Renders `staff.ops-alert` — a plain alert summary; critical marks the subject. */
export function renderOpsAlert(
  localeInput: string | null | undefined,
  data: OpsAlertData,
): { subject: string; text: string; html: string } {
  const locale: Locale = localeInput === 'en' ? 'en' : 'vi';
  const words = opsAlertLabels[locale];
  const subject =
    locale === 'en'
      ? `[Ordering] Alert: ${data.label}${data.severity === 'critical' ? ' (CRITICAL)' : ''}`
      : `[Bán hàng] Cảnh báo: ${data.label}${data.severity === 'critical' ? ' (NGHIÊM TRỌNG)' : ''}`;
  const rows: Array<[string, string]> = [
    [words.type, data.label],
    [words.count, String(data.count)],
    [words.first, data.firstSeen],
    [words.last, data.lastSeen],
  ];
  if (data.branchRef) rows.push([words.branch, data.branchRef]);
  if (data.aggregateRef) rows.push([words.ref, data.aggregateRef]);
  const text = [words.lead, '', ...rows.map(([key, value]) => `${key}: ${value}`), '', words.action]
    .join('\n')
    .trim();
  const html = [
    `<p>${escapeHtml(words.lead)}</p>`,
    `<table>${rows.map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td><strong>${escapeHtml(value)}</strong></td></tr>`).join('')}</table>`,
    `<p>${escapeHtml(words.action)}</p>`,
  ].join('\n');
  return { subject, text, html };
}

/** Customer-facing label for a delivery failure code (delivery-assignment.ts). */
export const deliveryFailureReason = (code: string, localeInput: string): string | undefined => {
  const locale: Locale = localeInput === 'en' ? 'en' : 'vi';
  const map: Record<string, Record<Locale, string>> = {
    unreachable: { vi: 'Không liên lạc được', en: 'We could not reach you' },
    'wrong-address': { vi: 'Địa chỉ chưa đúng', en: 'The address was wrong' },
    refused: { vi: 'Khách từ chối nhận', en: 'The delivery was refused' },
    other: { vi: 'Khác', en: 'Other' },
  };
  return map[code]?.[locale];
};

/**
 * Customer template for a group transition, or null when that step sends nothing. Delivery legs
 * have their own wording (screens O5) — a pickup phrase like "mời bạn đến nhận" must never go out
 * on a delivery order. A delivery `ready` step only mails on a retry (`failed → ready`); the first
 * one is followed by `out-for-delivery` right after.
 */
export function customerTemplateFor(
  to: string,
  options: { delayed?: boolean; from?: string; receiveKind?: string },
): TemplateCode | null {
  const { delayed = false, from, receiveKind } = options;
  switch (to) {
    case 'preparing':
    case 'awaiting-payment':
      return delayed ? 'customer.order-delayed' : 'customer.order-accepted';
    case 'ready':
      if (receiveKind === 'delivery') return from === 'failed' ? 'customer.delivery-retry' : null;
      return 'customer.order-ready';
    case 'out-for-delivery':
      return 'customer.delivery-out';
    case 'delivered':
      return receiveKind === 'delivery' ? 'customer.delivery-delivered' : 'customer.order-delivered';
    case 'failed':
      return 'customer.delivery-failed';
    case 'rejected':
      return 'customer.order-rejected';
    case 'canceled':
    case 'expired':
      return 'customer.order-canceled';
    default:
      return null;
  }
}
