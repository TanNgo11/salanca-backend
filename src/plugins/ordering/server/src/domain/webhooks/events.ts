import type { JsonObject } from '../../contracts/common';
import type { OutboxEvent } from '../../contracts/outbox';

/**
 * Public webhook event catalog (O10, plan step 1). Only the types listed here ever leave the
 * system as a signed webhook; everything else stays internal. `fields` is an allowlist — the
 * internal outbox payload is copied field by field, so staff-only keys (actorRef, isPublic,
 * notifyCustomer, raw provider payloads, …) can never leak by accident. Customer data is added
 * only when the receiving endpoint opts in with `includeCustomer`.
 */
export const WEBHOOK_API_VERSION = '2026-10';

/** Synthetic type sent by "Gửi thử"; it is not an outbox event and cannot be subscribed. */
export const PING_EVENT_TYPE = 'ordering.ping';

export type PublicEventGroup =
  | 'order'
  | 'fulfillment'
  | 'payment'
  | 'refund'
  | 'ops'
  | 'promotion'
  | 'gift-card'
  | 'rating'
  | 'customer';

export type PublicEventSpec = {
  type: string;
  group: PublicEventGroup;
  description: { vi: string; en: string };
  /** Payload keys copied into `data`; anything else is dropped. */
  fields: readonly string[];
  /** True when `data` belongs to an order (orderId present) and may carry `customer`. */
  orderScoped: boolean;
  /** Example `data` for the Admin catalog and docs. */
  sample: JsonObject;
};

export const PUBLIC_EVENTS: readonly PublicEventSpec[] = [
  {
    type: 'order.created',
    group: 'order',
    description: {
      vi: 'Đơn mới được tạo (khách đặt hoặc nhân viên nhập)',
      en: 'A new order was placed (storefront or staff draft)',
    },
    fields: ['orderId', 'code', 'status', 'totalAmount', 'currency', 'locationRef'],
    orderScoped: true,
    sample: {
      orderId: 1001,
      code: 'SLC-20261012-0042',
      status: 'open',
      totalAmount: 175000,
      currency: 'VND',
      locationRef: 'Q1',
    },
  },
  {
    type: 'order.transitioned',
    group: 'order',
    description: {
      vi: 'Trạng thái tổng của đơn thay đổi (mở → hoàn tất / hủy…)',
      en: 'The order projection changed status (open → completed / canceled…)',
    },
    fields: ['orderId', 'from', 'to', 'locationRef'],
    orderScoped: true,
    sample: { orderId: 1001, from: 'open', to: 'completed', locationRef: 'Q1' },
  },
  {
    type: 'order.line.canceled',
    group: 'order',
    description: {
      vi: 'Một dòng món trong đơn bị hủy (kèm số tiền liên quan)',
      en: 'An order line was canceled (with the affected amount)',
    },
    fields: ['orderId', 'lineId', 'quantity', 'amount'],
    orderScoped: true,
    sample: { orderId: 1001, lineId: 12, quantity: 1, amount: 55000 },
  },
  {
    type: 'fulfillment-group.transitioned',
    group: 'fulfillment',
    description: {
      vi: 'Nhóm món chuyển bước chế biến/giao (đã nhận, đang làm, sẵn sàng, đang giao…)',
      en: 'A fulfillment group moved step (accepted, preparing, ready, out for delivery…)',
    },
    fields: [
      'orderId',
      'groupId',
      'from',
      'to',
      'workflowName',
      'workflowVersion',
      'locationRef',
      'delayed',
      'reasonCode',
    ],
    orderScoped: true,
    sample: {
      orderId: 1001,
      groupId: 55,
      from: 'placed',
      to: 'preparing',
      workflowName: 'kitchen',
      workflowVersion: 1,
      locationRef: 'Q1',
    },
  },
  {
    type: 'payment.initiated',
    group: 'payment',
    description: {
      vi: 'Bắt đầu một lần thanh toán (mã QR/phiên provider đã tạo)',
      en: 'A payment was initiated (QR/provider session created)',
    },
    fields: ['orderId', 'paymentId', 'providerCode', 'amount', 'providerReference'],
    orderScoped: true,
    sample: {
      orderId: 1001,
      paymentId: 301,
      providerCode: 'sepay',
      amount: 175000,
      providerReference: 'SLC-20261012-0042',
    },
  },
  {
    type: 'payment.captured',
    group: 'payment',
    description: {
      vi: 'Tiền đã ghi nhận vào sổ thanh toán của đơn',
      en: 'Money was captured into the order payment ledger',
    },
    fields: ['orderId', 'paymentId', 'capturedAmount', 'providerReference'],
    orderScoped: true,
    sample: { orderId: 1001, paymentId: 301, capturedAmount: 175000, providerReference: 'MBVCB.123456' },
  },
  {
    type: 'payment.event.received',
    group: 'payment',
    description: {
      vi: 'Một giao dịch thô từ provider được ghi nhận (kể cả chưa khớp đơn)',
      en: 'A raw provider transaction was recorded (even before order matching)',
    },
    fields: ['paymentEventId', 'providerCode', 'providerTransactionId', 'kind', 'amount', 'transferType'],
    orderScoped: false,
    sample: {
      paymentEventId: 77,
      providerCode: 'sepay',
      providerTransactionId: 'FT26286123456',
      kind: 'bank-transfer',
      amount: 175000,
      transferType: 'in',
    },
  },
  {
    type: 'refund.settled',
    group: 'refund',
    description: {
      vi: 'Một khoản hoàn tiền đã được đối chiếu/xác nhận',
      en: 'A refund was settled against provider records',
    },
    fields: ['orderId', 'paymentId', 'refundId', 'amount'],
    orderScoped: true,
    sample: { orderId: 1001, paymentId: 301, refundId: 18, amount: 55000 },
  },
  {
    type: 'ops-alert.opened',
    group: 'ops',
    description: {
      vi: 'Cảnh báo vận hành mới (ví dụ webhook nhiều lỗi, đơn chờ lâu)',
      en: 'A new operational alert was raised (failing endpoint, awaiting orders…)',
    },
    fields: ['alertId', 'alertCode', 'aggregateRef', 'locationRef', 'severity', 'count'],
    orderScoped: false,
    sample: {
      alertId: 9,
      alertCode: 'order-awaiting-acceptance',
      aggregateRef: 'location:Q1',
      locationRef: 'Q1',
      severity: 'warning',
      count: 3,
    },
  },
  {
    type: 'ops-alert.escalated',
    group: 'ops',
    description: {
      vi: 'Cảnh báo vận hành leo thang (vượt ngưỡng nghiêm trọng)',
      en: 'An operational alert escalated past its critical threshold',
    },
    fields: ['alertId', 'alertCode', 'aggregateRef', 'locationRef', 'severity', 'count'],
    orderScoped: false,
    sample: {
      alertId: 9,
      alertCode: 'order-awaiting-acceptance',
      aggregateRef: 'location:Q1',
      locationRef: 'Q1',
      severity: 'critical',
      count: 8,
    },
  },
  {
    // O9: a gift card was issued after payment capture. `last4` only — the code itself
    // is never in the payload, and the recipient email stays internal.
    type: 'gift-card.issued',
    group: 'gift-card',
    description: {
      vi: 'Thẻ quà tặng đã phát hành sau khi thu tiền',
      en: 'A gift card was issued after payment capture',
    },
    fields: ['orderId', 'cardId', 'last4', 'amount', 'currency', 'expiresAt'],
    orderScoped: true,
    sample: {
      orderId: 1001,
      cardId: 77,
      last4: 'AB7K',
      amount: 500000,
      currency: 'VND',
      expiresAt: '2027-10-12T00:00:00.000Z',
    },
  },
  {
    // Core gaps step 5: a promotion was reserved for a placed order (inside the create
    // transaction). `code` is the code the customer typed (null for an automatic promotion) — a
    // marketing token, not a secret. Cancelling the order does not retract the event; subscribers
    // follow `order.transitioned`.
    type: 'promotion.redeemed',
    group: 'promotion',
    description: {
      vi: 'Một khuyến mãi đã được áp vào đơn vừa tạo',
      en: 'A promotion was applied to a newly placed order',
    },
    fields: ['orderId', 'orderCode', 'promotionId', 'code', 'discountAmount', 'locationRef'],
    orderScoped: true,
    sample: {
      orderId: 1001,
      orderCode: 'SLC-20261012-0042',
      promotionId: 7,
      code: 'KHAITRUONG',
      discountAmount: 25000,
      locationRef: 'Q1',
    },
  },
  {
    // Core gaps step 5: first rating of an order. The free-text `comment` is deliberately not in
    // the allowlist — customers type names and phone numbers there; staff read it in Admin.
    // Editing a rating does not emit again.
    type: 'rating.created',
    group: 'rating',
    description: {
      vi: 'Khách gửi đánh giá cho đơn (không kèm nội dung bình luận)',
      en: 'A customer rated an order (the comment text is not included)',
    },
    fields: ['orderId', 'orderCode', 'ratingId', 'stars', 'tags', 'locationRef'],
    orderScoped: true,
    sample: {
      orderId: 1001,
      orderCode: 'SLC-20261012-0042',
      ratingId: 55,
      stars: 4,
      tags: ['tasty', 'fast'],
      locationRef: 'Q1',
    },
  },
  {
    // O11 step 6: Decree 13 erasure notice. `customerHash` is the irreversible HMAC the
    // profile kept — enough for receivers to forget their own copy of that identity.
    type: 'customer.erased',
    group: 'customer',
    description: {
      vi: 'Dữ liệu khách hàng đã được ẩn danh theo yêu cầu xóa',
      en: 'A customer profile was anonymized per an erasure request',
    },
    fields: ['customerId', 'customerHash'],
    orderScoped: false,
    sample: { customerId: 42, customerHash: 'f2b9…c41d' },
  },
  {
    // O16: no contact data — receivers look the customer up through their own link to the documentId.
    type: 'loyalty.points.earned',
    group: 'customer',
    description: {
      vi: 'Khách được cộng điểm sau khi đơn hoàn tất',
      en: 'A customer earned loyalty points for a completed order',
    },
    fields: ['customerDocumentId', 'points'],
    orderScoped: false,
    sample: { customerDocumentId: 'k2m9x4qz7c1d', points: 19 },
  },
  {
    type: 'loyalty.tier.changed',
    group: 'customer',
    description: {
      vi: 'Hạng thành viên của khách thay đổi',
      en: 'A customer loyalty tier changed',
    },
    fields: ['customerDocumentId', 'tierCode', 'previousTierCode'],
    orderScoped: false,
    sample: { customerDocumentId: 'k2m9x4qz7c1d', tierCode: 'bac', previousTierCode: 'thanh-vien' },
  },
];

export const PUBLIC_EVENT_TYPES: readonly string[] = PUBLIC_EVENTS.map((spec) => spec.type);

const SPECS = new Map(PUBLIC_EVENTS.map((spec) => [spec.type, spec]));

/** Keys that must never appear in a webhook payload, even by future payload growth. */
const CUSTOMER_KEYS = ['name', 'phone', 'email', 'address', 'contact', 'customer'];

const cleanCustomer = (customer: JsonObject): JsonObject => {
  const out: JsonObject = {};
  for (const key of CUSTOMER_KEYS) {
    if (customer[key] !== undefined && customer[key] !== null && customer[key] !== '') {
      out[key] = customer[key];
    }
  }
  return out;
};

/**
 * Filters an outbox event into the public `data` object. Returns `null` for event types that are
 * not part of the public catalog — the fanout uses this to skip internal traffic. Allowlisted
 * keys are copied verbatim (absent keys stay absent); `customer` is attached only for
 * order-scoped events on endpoints that opted into `includeCustomer`.
 */
export function publicEventData(
  event: Pick<OutboxEvent, 'type' | 'payload'>,
  opts: { includeCustomer?: boolean; customer?: JsonObject } = {},
): JsonObject | null {
  const spec = SPECS.get(event.type);
  if (!spec) return null;
  const payload = event.payload ?? {};
  const data: JsonObject = {};
  for (const key of spec.fields) {
    if (payload[key] !== undefined) data[key] = payload[key];
  }
  if (opts.includeCustomer && spec.orderScoped && opts.customer) {
    const customer = cleanCustomer(opts.customer);
    if (Object.keys(customer).length > 0) data.customer = customer;
  }
  return data;
}

/**
 * The signed body posted to a subscriber (plan: `{ id, type, apiVersion, occurredAt, data }`).
 * `id` is the webhook-delivery id — retries and manual resends keep it, so receivers can dedupe.
 */
export function publicPayload(
  deliveryId: string,
  event: Pick<OutboxEvent, 'type' | 'payload' | 'occurredAt'>,
  opts: { includeCustomer?: boolean; customer?: JsonObject } = {},
): JsonObject | null {
  const data = publicEventData(event, opts);
  if (data === null) return null;
  return {
    id: deliveryId,
    type: event.type,
    apiVersion: WEBHOOK_API_VERSION,
    occurredAt: event.occurredAt,
    data,
  };
}
