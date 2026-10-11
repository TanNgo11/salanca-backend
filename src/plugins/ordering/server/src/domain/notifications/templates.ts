/**
 * Email templates (contracts §14; plan step 11). Pure: the caller passes already-safe data. VI is
 * the default; EN when the order was placed in English. Plain text plus a minimal HTML body with
 * every interpolated value escaped.
 */
export type TemplateCode =
  | 'staff.order-created'
  | 'staff.order-overdue'
  | 'customer.order-placed'
  | 'customer.order-accepted'
  | 'customer.order-delayed'
  | 'customer.order-ready'
  | 'customer.order-delivered'
  | 'customer.order-rejected'
  | 'customer.order-canceled';

export type TemplateData = {
  code: string;
  branchName: string;
  total: number;
  items: Array<{ title: string; quantity: number }>;
  pickupLabel?: string;
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
};

const labels: Record<Locale, Record<string, string>> = {
  vi: {
    pickup: 'Giờ lấy',
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

/** Customer template for a group transition, or null when that step sends nothing. */
export function customerTemplateFor(to: string, delayed: boolean): TemplateCode | null {
  switch (to) {
    case 'preparing':
    case 'awaiting-payment':
      return delayed ? 'customer.order-delayed' : 'customer.order-accepted';
    case 'ready':
      return 'customer.order-ready';
    case 'delivered':
      return 'customer.order-delivered';
    case 'rejected':
      return 'customer.order-rejected';
    case 'canceled':
    case 'expired':
      return 'customer.order-canceled';
    default:
      return null;
  }
}
