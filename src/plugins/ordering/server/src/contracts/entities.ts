import type { AddressSnapshot, ConsentSnapshot, JsonObject, ReceiveMethod } from './common';
import type { Currency, Money } from '../domain/money';
import type { Payment, Refund } from './payment';

/**
 * Core entity shapes (contracts doc §3, §5). Fields mirror the internal content types; snapshots
 * are immutable once the order is placed. Kept here so provider contracts can name relations
 * without importing Strapi.
 */
export type OrderStatus = 'draft' | 'open' | 'completed' | 'canceled';
export type OrderPaymentStatus =
  | 'unpaid'
  | 'partially-paid'
  | 'paid'
  | 'overpaid'
  | 'partially-refunded'
  | 'refunded';
export type OrderFulfillmentStatus =
  | 'not-started'
  | 'in-progress'
  | 'partially-done'
  | 'done'
  | 'canceled';

export type OrderLine = {
  id: string;
  order: Order;
  fulfillmentGroup: FulfillmentGroup;
  sellableUid: string;
  sourceUid?: string;
  sourceDocumentId?: string;
  productType: string;
  variantUid?: string;
  sku?: string;
  titleSnapshot: string;
  descriptionSnapshot?: string;
  imageUrlSnapshot?: string;
  selectedOptionsSnapshot: JsonObject;
  componentsSnapshot?: JsonObject;
  categoriesSnapshot: JsonObject;
  note?: string;
  quantity: number;
  fulfilledQuantity: number;
  returnedQuantity: number;
  canceledQuantity: number;
  unitAmount: number;
  optionAmount: number;
  discountAmount: number;
  feeAmount: number;
  roundingDelta: number;
  taxAmount: number;
  lineTotalAmount: number;
  currency: Currency;
};

export type FulfillmentGroup = {
  id: string;
  order: Order;
  workflowName: string;
  workflowVersion: string;
  receiveMethod: JsonObject;
  status: string;
  lines: OrderLine[];
};

export type Fulfillment = {
  id: string;
  order: Order;
  group: FulfillmentGroup;
  providerCode: string;
  providerReference?: string;
  status: string;
  assigneeRef?: string;
  addressSnapshot?: AddressSnapshot;
  packedAt?: string;
  shippedAt?: string;
  deliveredAt?: string;
  canceledAt?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  metadata?: JsonObject;
};

export type FulfillmentLine = {
  fulfillment: Fulfillment;
  line: OrderLine;
  quantity: number;
};

export type OrderAdjustment = {
  id: string;
  order: Order;
  kind: 'discount' | 'fee' | 'rounding';
  code: string;
  label: string;
  sourceRef?: string;
  ruleSnapshot?: JsonObject;
  amount: number;
  taxable: boolean;
  allocations: AdjustmentAllocation[];
};

export type AdjustmentAllocation = {
  adjustment: OrderAdjustment;
  line: OrderLine;
  weight: number;
  amount: number;
};

export type RefundLine = {
  refund: Refund;
  line: OrderLine;
  quantity: number;
  amount: number;
};

export type OrderEvent = {
  order: Order;
  type: string;
  actorRef?: string;
  isPublic: boolean;
  payload: JsonObject;
  occurredAt: string;
};

export type Order = {
  id: string;
  lines: OrderLine[];
  fulfillmentGroups: FulfillmentGroup[];
  fulfillments: Fulfillment[];
  adjustments: OrderAdjustment[];
  payments: Payment[];
  refunds: Refund[];
  timeline: OrderEvent[];
  code: string;
  publicTokenHash: string;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  fulfillmentStatus: OrderFulfillmentStatus;
  subtotalAmount: number;
  adjustmentAmount: number;
  fulfillmentAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: Currency;
  customerRef?: string;
  contactSnapshot: { name?: string; phone?: string; email?: string };
  consentSnapshot: ConsentSnapshot;
  customerNote?: string;
  locationRef?: string;
  branchSnapshot?: JsonObject;
  businessDate: string;
  placedAt: string;
  receiveMethod: ReceiveMethod;
  origin: {
    kind: 'storefront' | 'staff-draft' | 'import';
    actorRef?: string;
    staffPriceOverride?: { reason: string; actorRef: string; amount: Money };
  };
};
