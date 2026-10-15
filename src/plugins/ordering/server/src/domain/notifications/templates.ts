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
  | 'customer.order-updated'
  | 'customer.rating-invite'
  | 'customer.delivery-out'
  | 'customer.delivery-delivered'
  | 'customer.delivery-failed'
  | 'customer.delivery-retry'
  | 'customer.otp'
  | 'customer.cart-reminder'
  | 'customer.gift-card-issued'
  | 'customer.points-expiring'
  | 'customer.tier-up';

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

/** `12/10/2027` in the branch timezone — card expiry is a date, not a time. */
export const formatLocalDate = (iso: string, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')}`;
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
  // `customer.otp` renders through `renderOtp`; this entry only satisfies the copy record.
  'customer.otp': {
    vi: { subject: '', lead: '' },
    en: { subject: '', lead: '' },
  },
  // `customer.cart-reminder` renders through `renderCartReminder`.
  'customer.cart-reminder': {
    vi: { subject: '', lead: '' },
    en: { subject: '', lead: '' },
  },
  // `customer.gift-card-issued` renders through `renderGiftCardIssued` (O9).
  'customer.gift-card-issued': {
    vi: { subject: '', lead: '' },
    en: { subject: '', lead: '' },
  },
  // O16 loyalty mails render through `renderPointsExpiring` / `renderTierUp`.
  'customer.points-expiring': {
    vi: { subject: '', lead: '' },
    en: { subject: '', lead: '' },
  },
  'customer.tier-up': {
    vi: { subject: '', lead: '' },
    en: { subject: '', lead: '' },
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
  'customer.order-updated': {
    vi: { subject: 'Đơn {code} đã được cập nhật', lead: '{branch} đã cập nhật đơn của bạn.' },
    en: { subject: 'Order {code} was updated', lead: '{branch} updated your order.' },
  },
  'customer.rating-invite': {
    vi: { subject: 'Đơn {code} thế nào?', lead: 'Cảm ơn bạn đã đặt tại {branch}. Bạn đánh giá đơn này giúp quán nhé.' },
    en: { subject: 'How was order {code}?', lead: 'Thanks for ordering from {branch}. Please rate this order.' },
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

/** O11 OTP mail data: the one-time code and its validity window (plan step 2). */
export type OtpMailData = {
  otp: string;
  minutes: number;
};

const otpLabels: Record<Locale, Record<string, string>> = {
  vi: {
    lead: 'Mã đăng nhập của bạn là:',
    hint: 'Mã có hiệu lực trong {minutes} phút. Nếu bạn không yêu cầu mã này, hãy bỏ qua email.',
  },
  en: {
    lead: 'Your sign-in code is:',
    hint: 'It is valid for {minutes} minutes. If you did not request this code, ignore this email.',
  },
};

/** Renders `customer.otp` — the code is the whole point of the mail, so it leads subject+body. */
export function renderOtp(
  localeInput: string | null | undefined,
  data: OtpMailData,
): { subject: string; text: string; html: string } {
  const locale: Locale = localeInput === 'en' ? 'en' : 'vi';
  const words = otpLabels[locale];
  const minutes = String(data.minutes);
  const subject =
    locale === 'en' ? `Your sign-in code: ${data.otp}` : `Mã đăng nhập của bạn: ${data.otp}`;
  const hint = words.hint.replace('{minutes}', minutes);
  const text = [words.lead, '', data.otp, '', hint].join('\n');
  const html = [
    `<p>${escapeHtml(words.lead)}</p>`,
    `<p style="font-size:24px;letter-spacing:4px"><strong>${escapeHtml(data.otp)}</strong></p>`,
    `<p>${escapeHtml(hint)}</p>`,
  ].join('\n');
  return { subject, text, html };
}

/** O11 abandoned-cart reminder data: the cart contents + branch, no recipient PII. */
export type CartReminderData = {
  branch: string;
  items: Array<{ title: string; quantity: number }>;
  total?: number;
};

const reminderLabels: Record<Locale, Record<string, string>> = {
  vi: {
    lead: 'Bạn còn món đang chờ trong giỏ tại {branch}. Hoàn tất đơn trước khi giỏ hết hạn nhé!',
    total: 'Tạm tính',
    action: 'Mở website và đăng nhập để xem lại giỏ của bạn.',
  },
  en: {
    lead: 'You still have items waiting in your cart at {branch}. Finish your order before the cart expires!',
    total: 'Estimated total',
    action: 'Open the website and sign in to pick your cart back up.',
  },
};

/** Renders `customer.cart-reminder` — marketing mail, sent once per cart after the idle window. */
export function renderCartReminder(
  localeInput: string | null | undefined,
  data: CartReminderData,
): { subject: string; text: string; html: string } {
  const locale: Locale = localeInput === 'en' ? 'en' : 'vi';
  const words = reminderLabels[locale];
  const fill = (value: string) => value.replaceAll('{branch}', data.branch);
  const subject =
    locale === 'en'
      ? `Your cart at ${data.branch} is waiting`
      : `Giỏ của bạn tại ${data.branch} đang chờ`;
  const items = data.items.map((item) => `${item.quantity} × ${item.title}`);
  const rows: Array<[string, string]> = [];
  if (typeof data.total === 'number') rows.push([words.total, formatVnd(data.total)]);
  const text = [
    fill(words.lead),
    '',
    ...items,
    '',
    ...rows.map(([key, value]) => `${key}: ${value}`),
    '',
    words.action,
  ]
    .join('\n')
    .trim();
  const html = [
    `<p>${escapeHtml(fill(words.lead))}</p>`,
    `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`,
    rows.length
      ? `<table>${rows
          .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td><strong>${escapeHtml(value)}</strong></td></tr>`)
          .join('')}</table>`
      : '',
    `<p>${escapeHtml(words.action)}</p>`,
  ].join('\n');
  return { subject, text, html };
}

/** O9 gift-card mail data: the issued codes are the mail's whole point (plan step 3). */
export type GiftCardMailData = {
  /** The order code, for context — not a card code. Complimentary issue has no order. */
  orderCode?: string;
  branch: string;
  cards: Array<{ code: string; amount: number }>;
  /** `12/10/2027` formatted in the branch timezone. */
  expiresAt?: string;
  recipientName?: string;
  /** Optional gift message the purchaser left for the recipient (≤ 300 chars). */
  message?: string;
  /** Order lookup link — only when the recipient is the purchaser. */
  link?: string;
};

const giftCardLabels: Record<Locale, Record<string, string>> = {
  vi: {
    subject: 'Thẻ quà tặng từ {branch}',
    lead: '{branch} gửi bạn thẻ quà tặng — nhập mã dưới đây khi thanh toán đơn online.',
    expiry: 'Hạn dùng',
    greeting: 'Kính gửi {name},',
    messageLabel: 'Lời chúc',
    hint: 'Nhập mã khi thanh toán đơn hàng online.',
    warning: 'Ai có mã đều dùng được — giữ mã cẩn thận.',
    viewOrder: 'Xem đơn',
    orderLabel: 'Đơn',
  },
  en: {
    subject: 'A gift card from {branch}',
    lead: '{branch} sent you a gift card — enter the code below when paying online.',
    expiry: 'Valid until',
    greeting: 'Dear {name},',
    messageLabel: 'Message',
    hint: 'Enter the code when paying online.',
    warning: 'Anyone holding the code can spend it — keep it safe.',
    viewOrder: 'View order',
    orderLabel: 'Order',
  },
};

/**
 * Renders `customer.gift-card-issued` (O9 plan step 3): one row per card with its plaintext code —
 * the only surface besides the staff reveal that ever shows it. Plain text plus minimal HTML with
 * every value escaped; the sender side is deduped by the delivery log like every other template.
 */
export function renderGiftCardIssued(
  localeInput: string | null | undefined,
  data: GiftCardMailData,
): { subject: string; text: string; html: string } {
  const locale: Locale = localeInput === 'en' ? 'en' : 'vi';
  const words = giftCardLabels[locale];
  const fill = (value: string) => value.replaceAll('{branch}', data.branch);
  const subject = fill(words.subject);
  const lines: string[] = [];
  if (data.recipientName) {
    lines.push(words.greeting.replace('{name}', data.recipientName), '');
  }
  lines.push(fill(words.lead), '');
  for (const card of data.cards) {
    lines.push(`${card.code} — ${formatVnd(card.amount)}`);
  }
  lines.push('');
  if (data.expiresAt) lines.push(`${words.expiry}: ${data.expiresAt}`);
  if (data.orderCode) lines.push(`${words.orderLabel}: ${data.orderCode}`);
  if (data.message) {
    lines.push('', `${words.messageLabel}: ${data.message}`);
  }
  lines.push('', words.hint, words.warning);
  if (data.link) {
    lines.push('', `${words.viewOrder}: ${data.link}`);
  }
  const text = lines.join('\n').trim();
  const html = [
    ...(data.recipientName
      ? [`<p>${escapeHtml(words.greeting.replace('{name}', data.recipientName))}</p>`]
      : []),
    `<p>${escapeHtml(fill(words.lead))}</p>`,
    `<ul>${data.cards
      .map(
        (card) =>
          `<li><code>${escapeHtml(card.code)}</code> — <strong>${escapeHtml(formatVnd(card.amount))}</strong></li>`,
      )
      .join('')}</ul>`,
    `<table>${
      data.orderCode
        ? `<tr><td>${escapeHtml(words.orderLabel)}</td><td><strong>${escapeHtml(data.orderCode)}</strong></td></tr>`
        : ''
    }${
      data.expiresAt
        ? `<tr><td>${escapeHtml(words.expiry)}</td><td><strong>${escapeHtml(data.expiresAt)}</strong></td></tr>`
        : ''
    }</table>`,
    ...(data.message
      ? [`<p>${escapeHtml(words.messageLabel)}: ${escapeHtml(data.message)}</p>`]
      : []),
    `<p>${escapeHtml(words.hint)}<br>${escapeHtml(words.warning)}</p>`,
    ...(data.link
      ? [`<p><a href="${escapeHtml(data.link)}">${escapeHtml(words.viewOrder)}</a></p>`]
      : []),
  ].join('\n');
  return { subject, text, html };
}

/** O16 loyalty mail data: counts and names of the program only — no contact data. */
export type LoyaltyMailData = {
  /** Points expiring (points-expiring) or the new tier's name (tier-up) is in `tierName`. */
  points?: number;
  /** `12/11/2026` in the program timezone. */
  expiresAt?: string;
  balance: number;
  tierName?: string;
  /** Display multiplier such as `1,2`. */
  multiplier?: string;
};

const loyaltyLabels: Record<Locale, Record<string, string>> = {
  vi: {
    expiringSubject: '{points} điểm của bạn sắp hết hạn',
    expiringLead: 'Bạn có {points} điểm sẽ hết hạn vào {expiry}. Dùng điểm cho đơn tiếp theo để không bỏ lỡ nhé!',
    balance: 'Số dư điểm',
    tierSubject: 'Chúc mừng! Bạn đã lên hạng {tier}',
    tierLead: 'Bạn vừa lên hạng {tier}. Từ nay mỗi đơn hoàn tất được nhân {multiplier} điểm.',
    action: 'Đăng nhập website để xem điểm và hạng của bạn.',
  },
  en: {
    expiringSubject: '{points} of your points are about to expire',
    expiringLead: 'You have {points} points expiring on {expiry}. Use them on your next order so they do not go to waste!',
    balance: 'Points balance',
    tierSubject: 'Congratulations! You reached {tier}',
    tierLead: 'You just reached {tier}. Every completed order now earns ×{multiplier} points.',
    action: 'Sign in on the website to see your points and tier.',
  },
};

export const loyaltyWords = (localeInput: string | null | undefined): Record<string, string> =>
  loyaltyLabels[localeInput === 'en' ? 'en' : 'vi'];

const fillLoyalty = (value: string, data: LoyaltyMailData): string =>
  value
    .replaceAll('{points}', String(data.points ?? 0))
    .replaceAll('{expiry}', data.expiresAt ?? '')
    .replaceAll('{tier}', data.tierName ?? '')
    .replaceAll('{multiplier}', data.multiplier ?? '1');

const renderLoyalty = (
  kind: 'expiring' | 'tier',
  localeInput: string | null | undefined,
  data: LoyaltyMailData,
): { subject: string; text: string; html: string } => {
  const words = loyaltyLabels[localeInput === 'en' ? 'en' : 'vi'];
  const subject = fillLoyalty(kind === 'expiring' ? words.expiringSubject : words.tierSubject, data);
  const lead = fillLoyalty(kind === 'expiring' ? words.expiringLead : words.tierLead, data);
  const balance = `${words.balance}: ${data.balance}`;
  const text = [lead, '', balance, '', words.action].join('\n');
  const html = [
    `<p>${escapeHtml(lead)}</p>`,
    `<p>${escapeHtml(words.balance)}: <strong>${escapeHtml(String(data.balance))}</strong></p>`,
    `<p>${escapeHtml(words.action)}</p>`,
  ].join('\n');
  return { subject, text, html };
};

/** Renders `customer.points-expiring` — marketing mail, once per lot before it expires (O16). */
export const renderPointsExpiring = (localeInput: string | null | undefined, data: LoyaltyMailData) =>
  renderLoyalty('expiring', localeInput, data);

/** Renders `customer.tier-up` — sent when the tier job moves a customer up (O16). */
export const renderTierUp = (localeInput: string | null | undefined, data: LoyaltyMailData) =>
  renderLoyalty('tier', localeInput, data);

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

/** Locale label words for building template variable values (O10 custom templates). */
export const templateWords = (localeInput: string | null | undefined): Record<string, string> =>
  labels[localeInput === 'en' ? 'en' : 'vi'];

export const opsAlertWords = (localeInput: string | null | undefined): Record<string, string> =>
  opsAlertLabels[localeInput === 'en' ? 'en' : 'vi'];

export const giftCardWords = (localeInput: string | null | undefined): Record<string, string> =>
  giftCardLabels[localeInput === 'en' ? 'en' : 'vi'];

/**
 * Default editable source of a template (O10): the built-in copy expressed in the restricted
 * markdown `notification-template` syntax — `{code}`/`{branch}` become `{{var}}` placeholders and
 * optional detail rows are the whole-line variables (`{{pickup}}`, `{{footer}}`, …) that drop out
 * when their data is absent. `renderCustom` on this source reproduces `renderTemplate`'s output.
 */
export function defaultTemplateSource(
  template: TemplateCode,
  localeInput: string | null | undefined,
): { subject: string; body: string } {
  const locale: Locale = localeInput === 'en' ? 'en' : 'vi';
  const fill = (value: string) =>
    value.replaceAll('{code}', '{{code}}').replaceAll('{branch}', '{{branch}}');
  if (template === 'customer.otp') {
    const w = otpLabels[locale];
    return {
      subject: locale === 'en' ? 'Your sign-in code: {{otp}}' : 'Mã đăng nhập của bạn: {{otp}}',
      body: [w.lead, '', '**{{otp}}**', '', w.hint.replace('{minutes}', '{{minutes}}')].join('\n'),
    };
  }
  if (template === 'customer.cart-reminder') {
    const w = reminderLabels[locale];
    return {
      subject:
        locale === 'en' ? 'Your cart at {{branch}} is waiting' : 'Giỏ của bạn tại {{branch}} đang chờ',
      body: [fill(w.lead), '', '{{items}}', '', '{{total}}', '', w.action].join('\n'),
    };
  }
  if (template === 'customer.gift-card-issued') {
    const w = giftCardLabels[locale];
    return {
      subject: fill(w.subject),
      body: [
        '{{greeting}}',
        fill(w.lead),
        '',
        '{{cards}}',
        '',
        `- ${w.orderLabel}: {{orderCode}}`,
        '{{expiry}}',
        '{{message}}',
        '',
        w.hint,
        w.warning,
        '',
        '{{link}}',
      ].join('\n'),
    };
  }
  if (template === 'customer.points-expiring' || template === 'customer.tier-up') {
    const w = loyaltyLabels[locale];
    const expiring = template === 'customer.points-expiring';
    const fillVars = (value: string) =>
      value
        .replaceAll('{points}', '{{points}}')
        .replaceAll('{expiry}', '{{expiry}}')
        .replaceAll('{tier}', '{{tier}}')
        .replaceAll('{multiplier}', '{{multiplier}}');
    return {
      subject: fillVars(expiring ? w.expiringSubject : w.tierSubject),
      body: [fillVars(expiring ? w.expiringLead : w.tierLead), '', `- ${w.balance}: {{balance}}`, '', w.action].join('\n'),
    };
  }
  if (template === 'staff.ops-alert') {
    const w = opsAlertLabels[locale];
    return {
      subject: `${locale === 'en' ? '[Ordering] Alert' : '[Bán hàng] Cảnh báo'}: {{label}}{{severityMark}}`,
      body: [
        w.lead,
        '',
        `- ${w.type}: {{label}}`,
        `- ${w.count}: {{count}}`,
        `- ${w.first}: {{firstSeen}}`,
        `- ${w.last}: {{lastSeen}}`,
        '{{branch}}',
        '{{ref}}',
        '',
        w.action,
      ].join('\n'),
    };
  }
  const words = labels[locale];
  const { subject, lead } = copy[template][locale];
  return {
    subject: fill(subject),
    body: [
      fill(lead),
      '',
      '{{items}}',
      '',
      '{{pickup}}',
      '{{delivery}}',
      '{{ready}}',
      '{{reason}}',
      '{{note}}',
      '{{customer}}',
      `- ${words.total}: {{total}}`,
      '',
      '{{footer}}',
    ].join('\n'),
  };
}

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
