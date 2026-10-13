import {
  formatVnd,
  giftCardWords,
  opsAlertWords,
  templateWords,
  type CartReminderData,
  type GiftCardMailData,
  type OpsAlertData,
  type OtpMailData,
  type TemplateCode,
  type TemplateData,
} from './templates';

/** Mail payloads the render pipeline accepts (order mail, ops alerts, OTP, cart reminder, O9 cards). */
export type AnyMailData =
  | TemplateData
  | OpsAlertData
  | OtpMailData
  | CartReminderData
  | GiftCardMailData;

/**
 * O10 editable email templates — the allowlisted `{{var}}` names each template may use plus the
 * value builders (`buildVars`) and sample data for the admin preview. Variable values are plain
 * text; `markdown: true` vars carry restricted-markdown fragments (`- ` lists, https links) built
 * server-side. `line: true` vars are whole-line blocks — empty data drops the line entirely.
 */
export type TemplateVar = {
  name: string;
  line?: boolean;
  markdown?: boolean;
  description: [vi: string, en: string];
};

export const TEMPLATE_CODES: TemplateCode[] = [
  'staff.order-created',
  'staff.order-overdue',
  'staff.ops-alert',
  'customer.order-placed',
  'customer.order-accepted',
  'customer.order-delayed',
  'customer.order-ready',
  'customer.order-delivered',
  'customer.order-rejected',
  'customer.order-canceled',
  'customer.order-updated',
  'customer.rating-invite',
  'customer.delivery-out',
  'customer.delivery-delivered',
  'customer.delivery-failed',
  'customer.delivery-retry',
  'customer.otp',
  'customer.cart-reminder',
  'customer.gift-card-issued',
];

// Compile-time exhaustiveness: a new TemplateCode without a list entry fails typecheck.
const _allCodes: Record<TemplateCode, true> = {
  'staff.order-created': true,
  'staff.order-overdue': true,
  'staff.ops-alert': true,
  'customer.order-placed': true,
  'customer.order-accepted': true,
  'customer.order-delayed': true,
  'customer.order-ready': true,
  'customer.order-delivered': true,
  'customer.order-rejected': true,
  'customer.order-canceled': true,
  'customer.order-updated': true,
  'customer.rating-invite': true,
  'customer.delivery-out': true,
  'customer.delivery-delivered': true,
  'customer.delivery-failed': true,
  'customer.delivery-retry': true,
  'customer.otp': true,
  'customer.cart-reminder': true,
  'customer.gift-card-issued': true,
};
void _allCodes;

export const isTemplateCode = (value: string): value is TemplateCode =>
  (TEMPLATE_CODES as string[]).includes(value);

export const TEMPLATE_LOCALES = ['vi', 'en'] as const;
export type TemplateLocale = (typeof TEMPLATE_LOCALES)[number];
export const isTemplateLocale = (value: string): value is TemplateLocale =>
  (TEMPLATE_LOCALES as readonly string[]).includes(value);

/** Display names for the admin list ("Đơn đã sẵn sàng"). */
export const TEMPLATE_NAMES: Record<TemplateCode, [vi: string, en: string]> = {
  'staff.order-created': ['Đơn mới cho quán', 'New order for the branch'],
  'staff.order-overdue': ['Đơn chờ nhận quá lâu', 'Order awaiting acceptance too long'],
  'staff.ops-alert': ['Cảnh báo vận hành', 'Operational alert'],
  'customer.order-placed': ['Đã nhận đơn (khách)', 'Order received (customer)'],
  'customer.order-accepted': ['Đơn đã xác nhận (khách)', 'Order accepted (customer)'],
  'customer.order-delayed': ['Giờ lấy mới (khách)', 'New pickup time (customer)'],
  'customer.order-ready': ['Đơn đã sẵn sàng (khách)', 'Order ready (customer)'],
  'customer.order-delivered': ['Đơn đã hoàn tất (khách)', 'Order completed (customer)'],
  'customer.order-rejected': ['Đơn bị từ chối (khách)', 'Order rejected (customer)'],
  'customer.order-canceled': ['Đơn đã hủy (khách)', 'Order canceled (customer)'],
  'customer.order-updated': ['Đơn đã được sửa (khách)', 'Order updated (customer)'],
  'customer.rating-invite': ['Mời đánh giá đơn (khách)', 'Rating invite (customer)'],
  'customer.delivery-out': ['Đơn đang giao (khách)', 'Order out for delivery (customer)'],
  'customer.delivery-delivered': ['Đơn đã giao (khách)', 'Order delivered (customer)'],
  'customer.delivery-failed': ['Giao chưa thành công (khách)', 'Delivery failed (customer)'],
  'customer.delivery-retry': ['Đơn sẽ giao lại (khách)', 'Order redelivery (customer)'],
  'customer.otp': ['Mã đăng nhập OTP (khách)', 'Sign-in OTP code (customer)'],
  'customer.cart-reminder': ['Nhắc giỏ bỏ dở (khách)', 'Abandoned-cart reminder (customer)'],
  'customer.gift-card-issued': ['Thẻ quà tặng đã phát hành (khách)', 'Gift card issued (customer)'],
};

export const templateAudience = (code: TemplateCode): 'staff' | 'customer' =>
  code.startsWith('staff.') ? 'staff' : 'customer';

const ORDER_VARS: TemplateVar[] = [
  { name: 'code', description: ['Mã đơn', 'Order code'] },
  { name: 'branch', description: ['Tên chi nhánh', 'Branch name'] },
  { name: 'total', description: ['Tổng tiền đã định dạng (55.000đ)', 'Formatted total (55.000đ)'] },
  {
    name: 'items',
    line: true,
    markdown: true,
    description: ['Danh sách món, mỗi dòng một món', 'Item list, one per line'],
  },
  {
    name: 'customer',
    line: true,
    description: [
      'Dòng "- Khách: tên" — chỉ mẫu nhân viên có',
      '"- Customer: name" line — staff templates only',
    ],
  },
  {
    name: 'pickup',
    line: true,
    description: ['Dòng "- Giờ lấy: …" khi đơn có giờ lấy', '"- Pickup: …" line when set'],
  },
  {
    name: 'delivery',
    line: true,
    description: ['Dòng "- Giao lúc: …" khi đơn giao tận nơi', '"- Delivery at: …" line when set'],
  },
  {
    name: 'ready',
    line: true,
    description: [
      'Dòng "- Dự kiến sẵn sàng: …" khi có giờ dự kiến',
      '"- Estimated ready: …" line when set',
    ],
  },
  {
    name: 'reason',
    line: true,
    description: ['Dòng "- Lý do: …" (từ chối/giao lỗi)', '"- Reason: …" line (reject/delivery)'],
  },
  {
    name: 'note',
    line: true,
    description: ['Dòng "- Ghi chú: …" của khách', '"- Note: …" line from the customer'],
  },
  {
    name: 'link',
    description: ['URL tra cứu đơn (mẫu khách)', 'Order lookup URL (customer templates)'],
  },
  {
    name: 'footer',
    line: true,
    markdown: true,
    description: [
      'Dòng cuối: link "Xem đơn" hoặc gợi ý tra cứu (mẫu khách)',
      'Footer: "View order" link or lookup hint (customer templates)',
    ],
  },
];

const OTP_VARS: TemplateVar[] = [
  { name: 'otp', description: ['Mã đăng nhập 6 số', 'The 6-digit sign-in code'] },
  { name: 'minutes', description: ['Số phút hiệu lực của mã', 'Minutes the code stays valid'] },
];

const REMINDER_VARS: TemplateVar[] = [
  { name: 'branch', description: ['Tên chi nhánh', 'Branch name'] },
  {
    name: 'items',
    line: true,
    markdown: true,
    description: ['Danh sách món trong giỏ, mỗi dòng một món', 'Cart item list, one per line'],
  },
  {
    name: 'total',
    line: true,
    description: ['Dòng "- Tạm tính: …" khi giỏ định giá được', '"- Estimated total: …" line when priced'],
  },
];

const OPS_VARS: TemplateVar[] = [
  { name: 'label', description: ['Tên cảnh báo', 'Alert label'] },
  {
    name: 'severity',
    description: ['Mức độ: info / warning / critical', 'Severity: info / warning / critical'],
  },
  {
    name: 'severityMark',
    description: ['" (NGHIÊM TRỌNG)" khi critical, rỗng nếu không', '" (CRITICAL)" when critical, empty otherwise'],
  },
  { name: 'count', description: ['Số lần xảy ra', 'Occurrence count'] },
  { name: 'firstSeen', description: ['Lần đầu ghi nhận', 'First seen'] },
  { name: 'lastSeen', description: ['Lần gần nhất', 'Last seen'] },
  {
    name: 'branch',
    line: true,
    description: ['Dòng "- Chi nhánh: …" khi có', '"- Branch: …" line when set'],
  },
  {
    name: 'ref',
    line: true,
    description: ['Dòng "- Tham chiếu: …" khi có', '"- Reference: …" line when set'],
  },
  { name: 'action', description: ['Câu hướng dẫn mở Admin', 'The open-Admin instruction'] },
];

const GIFT_CARD_VARS: TemplateVar[] = [
  { name: 'orderCode', description: ['Mã đơn mua thẻ', 'The order the cards were bought on'] },
  { name: 'branch', description: ['Tên chi nhánh', 'Branch name'] },
  {
    name: 'cards',
    line: true,
    markdown: true,
    description: [
      'Danh sách thẻ, mỗi dòng "MÃ — mệnh giá"',
      'Card list, one "CODE — amount" per line',
    ],
  },
  {
    name: 'greeting',
    line: true,
    description: ['Dòng chào "Kính gửi tên," khi có tên', '"Dear name," line when set'],
  },
  {
    name: 'expiry',
    line: true,
    description: ['Dòng "- Hạn dùng: …" khi thẻ có hạn', '"- Valid until: …" line when set'],
  },
  {
    name: 'message',
    line: true,
    description: ['Dòng "- Lời chúc: …" của người mua', '"- Message: …" line from the buyer'],
  },
  {
    name: 'link',
    line: true,
    markdown: true,
    description: [
      'Link "Xem đơn" — chỉ khi người nhận là người mua',
      '"View order" link — only when the recipient is the buyer',
    ],
  },
];

/** Allowed `{{var}}` names for a template — used by the editor, validation and preview. */
export const variablesFor = (code: TemplateCode): TemplateVar[] =>
  code === 'staff.ops-alert'
    ? OPS_VARS
    : code === 'customer.otp'
      ? OTP_VARS
      : code === 'customer.cart-reminder'
        ? REMINDER_VARS
        : code === 'customer.gift-card-issued'
          ? GIFT_CARD_VARS
          : ORDER_VARS;

const mdEscape = (value: string): string => value.replace(/([\\[\]()*])/g, '\\$1');

/** `{{var}}` → raw value for a real render. Line vars carry their whole line (or ''). */
export const buildVars = (
  code: TemplateCode,
  localeInput: string | null | undefined,
  data: AnyMailData,
): Record<string, string> => {
  const locale = localeInput === 'en' ? 'en' : 'vi';
  if (code === 'customer.otp') {
    const d = data as OtpMailData;
    return { otp: d.otp, minutes: String(d.minutes) };
  }
  if (code === 'customer.cart-reminder') {
    const d = data as CartReminderData;
    const label = locale === 'en' ? 'Estimated total' : 'Tạm tính';
    return {
      branch: d.branch,
      items: d.items.map((item) => `- ${item.quantity} × ${mdEscape(item.title)}`).join('\n'),
      total: typeof d.total === 'number' ? `- ${label}: ${formatVnd(d.total)}` : '',
    };
  }
  if (code === 'customer.gift-card-issued') {
    const d = data as GiftCardMailData;
    const w = giftCardWords(locale);
    return {
      orderCode: d.orderCode,
      branch: d.branch,
      cards: d.cards
        .map((card) => `- ${card.code} — ${formatVnd(card.amount)}`)
        .join('\n'),
      greeting: d.recipientName ? w.greeting.replace('{name}', d.recipientName) : '',
      expiry: d.expiresAt ? `- ${w.expiry}: ${d.expiresAt}` : '',
      message: d.message ? `- ${w.messageLabel}: ${d.message}` : '',
      link: d.link ? `[${w.viewOrder}](${d.link})` : '',
    };
  }
  if (code === 'staff.ops-alert') {
    const d = data as OpsAlertData;
    const w = opsAlertWords(locale);
    const critical = d.severity === 'critical';
    return {
      label: d.label,
      severity: d.severity,
      severityMark: critical ? (locale === 'en' ? ' (CRITICAL)' : ' (NGHIÊM TRỌNG)') : '',
      count: String(d.count),
      firstSeen: d.firstSeen,
      lastSeen: d.lastSeen,
      branch: d.branchRef ? `- ${w.branch}: ${d.branchRef}` : '',
      ref: d.aggregateRef ? `- ${w.ref}: ${d.aggregateRef}` : '',
      action: w.action,
    };
  }
  const d = data as TemplateData;
  const w = templateWords(locale);
  const line = (key: string, value: string | undefined) => (value ? `- ${w[key]}: ${value}` : '');
  const isStaff = code.startsWith('staff.');
  const isCustomer = code.startsWith('customer.');
  return {
    code: d.code,
    branch: d.branchName,
    total: formatVnd(d.total),
    // `items` is a markdown var — titles are escaped here so a stray `[x](…)` can't form a link.
    items: d.items.map((item) => `- ${item.quantity} × ${mdEscape(item.title)}`).join('\n'),
    customer: isStaff ? line('customer', d.customerName) : '',
    pickup: line('pickup', d.pickupLabel),
    delivery: line('delivery', d.deliveryLabel),
    ready: line('ready', d.readyLabel),
    reason: line('reason', d.reason),
    note: line('note', d.note),
    link: isCustomer ? (d.link ?? '') : '',
    footer: isCustomer ? (d.link ? `[${w.link}](${d.link})` : w.lookup) : '',
  };
};

/** Filled preview/sample row for the admin editor — every optional field present. */
export const sampleDataFor = (code: TemplateCode): AnyMailData =>
  code === 'customer.otp'
    ? { otp: '123456', minutes: 5 }
    : code === 'customer.cart-reminder'
      ? {
          branch: 'Quán Quận 1',
          items: [
            { title: 'Phở bò', quantity: 2 },
            { title: 'Trà đá', quantity: 1 },
          ],
          total: 148000,
        }
      : code === 'customer.gift-card-issued'
        ? {
            orderCode: 'A1B2C3',
            branch: 'Quán Quận 1',
            cards: [
              { code: 'ABCD-EFGH-JKMN-PQRS', amount: 200000 },
              { code: 'WXYZ-2345-6789-ABCD', amount: 100000 },
            ],
            expiresAt: '12/10/2027',
            recipientName: 'Chị Lan',
            message: 'Chúc mừng sinh nhật!',
            link: 'https://example.invalid/don-hang#t=demo',
          }
        : code === 'staff.ops-alert'
    ? {
        label: 'Endpoint webhook tự tắt sau 50 lỗi liên tiếp',
        severity: 'warning',
        count: 3,
        firstSeen: '09:12 · 12/10',
        lastSeen: '10:03 · 12/10',
        branchRef: 'Q1',
        aggregateRef: 'webhook-endpoint:7',
      }
    : {
        code: 'A1B2C3',
        branchName: 'Quán Quận 1',
        total: 148000,
        items: [
          { title: 'Phở bò', quantity: 2 },
          { title: 'Trà đá', quantity: 1 },
        ],
        pickupLabel: '12:30 · 12/10',
        deliveryLabel: '18:45 · 12/10',
        readyLabel: '12:15 · 12/10',
        reason: 'Khách hẹn lại giờ',
        note: 'Ít đá, không hành',
        customerName: 'Anh Minh',
        link: 'https://example.invalid/don-hang#t=demo',
      };

/** Values escaped for the markdown pass — plain vars neutralize `[ ] ( ) * \`. */
export const markdownVars = (vars: Record<string, string>, code: TemplateCode) => {
  const markdown = new Set(
    variablesFor(code)
      .filter((v) => v.markdown)
      .map((v) => v.name),
  );
  return Object.fromEntries(
    Object.entries(vars).map(([name, value]) => [
      name,
      markdown.has(name) ? value : mdEscape(value),
    ]),
  );
};
