/**
 * Row shapes for the ordering aggregate. Bigint columns are converted to safe-integer numbers
 * by the repository (`amountFromDb`); everything else is the stored column value. Kept
 * structural (not the contract entities) so the repository stays a thin persistence layer.
 */
export type OrderRow = {
  id: number;
  code: string;
  publicTokenHash: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  subtotalAmount: number;
  adjustmentAmount: number;
  fulfillmentAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  customerRef: string | null;
  contactSnapshot: Record<string, unknown>;
  consentSnapshot: Record<string, unknown>;
  customerNote: string | null;
  branch: number | null;
  locationRef: string;
  branchSnapshot: Record<string, unknown> | null;
  businessDate: string;
  placedAt: string;
  receiveMethod: Record<string, unknown>;
  origin: { kind: 'storefront' | 'staff-draft' | 'import'; actorRef?: string };
  cartHash: string | null;
  draftConfirmedAt: string | null;
};

export type OrderLineRow = {
  id: number;
  order: number;
  fulfillmentGroup: number | null;
  position: number;
  sellableUid: string;
  sourceUid: string | null;
  sourceDocumentId: string | null;
  productType: string;
  variantUid: string | null;
  sku: string | null;
  titleSnapshot: string;
  descriptionSnapshot: string | null;
  imageUrlSnapshot: string | null;
  selectedOptionsSnapshot: unknown;
  componentsSnapshot: unknown;
  categoriesSnapshot: unknown;
  taxSnapshot: { category: string; ratePercent: number; inclusive: boolean } | null;
  note: string | null;
  quantity: number;
  fulfilledQuantity: number;
  returnedQuantity: number;
  canceledQuantity: number;
  unitAmount: number;
  optionAmount: number;
  baseAmount: number;
  discountAmount: number;
  feeAmount: number;
  roundingDelta: number;
  taxAmount: number;
  lineTotalAmount: number;
  currency: string;
};

export type FulfillmentGroupRow = {
  id: number;
  order: number;
  workflowName: string;
  workflowVersion: string;
  receiveMethod: Record<string, unknown>;
  status: string;
  fulfillmentAmount: number;
};

export type AdjustmentRow = {
  id: number;
  order: number | null;
  kind: string;
  code: string;
  label: string;
  sourceRef: string | null;
  ruleSnapshot: Record<string, unknown> | null;
  amount: number;
  taxable: boolean;
  priority: number;
  allocations: Array<{ id: number; line: number | null; weight: number; amount: number }>;
};

export type PaymentRow = {
  id: number;
  order: number;
  providerCode: string;
  requestedAmount: number;
  capturedAmount: number;
  refundedAmount: number;
  currency: string;
  status: string;
  providerReference: string | null;
  actorRef: string | null;
  businessDate: string | null;
  capturedAt: string | null;
};

export type RefundRow = {
  id: number;
  payment: number | null;
  order: number | null;
  amount: number;
  currency: string;
  reason: string;
  actorRef: string | null;
  idempotencyKey: string | null;
  providerReference: string | null;
  status: string;
  settledAt: string | null;
  lines: Array<{ id: number; line: number | null; quantity: number; amount: number }>;
};

export type HoldRow = {
  id: number;
  order: number | null;
  line: number | null;
  group: number | null;
  resourceRef: string | null;
  quantity: number;
  expiresAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
};

export type OrderAggregate = {
  order: OrderRow;
  lines: OrderLineRow[];
  groups: FulfillmentGroupRow[];
  adjustments: AdjustmentRow[];
  payments: PaymentRow[];
  refunds: RefundRow[];
  holds: HoldRow[];
};
