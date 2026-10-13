/** Shapes returned by the plugin's admin order routes (server/src/services/admin-orders.ts). */
export type NextTransition = {
  to: string;
  kind: 'primary' | 'secondary' | 'danger';
  requires: Array<'reason' | 'cash' | 'assignee'>;
};

export type InboxSettings = {
  newOrderDialog: boolean;
  soundByDefault: boolean;
  rejectReasons: Array<{ code: string; label: Record<string, string> }>;
  delayMinutes: number[];
};

export type OrderRow = {
  id: number;
  code: string;
  status: string;
  groupStatus: string | null;
  tab: string;
  placedAt: string;
  businessDate: string;
  locationRef: string;
  receive: { kind: string; mode: string | null; slotStartsAt: string | null; estimatedReadyAt: string | null };
  customer: { name: string | null; phoneMasked: string | null };
  items: Array<{ title: string; quantity: number }>;
  itemCount: number;
  total: number;
  paymentStatus: string;
  waitingMinutes: number;
  overdue: boolean;
  origin: string;
  next: NextTransition | null;
  /** Delivery-leg info, present on `GET /orders?receive=delivery` rows (screens D2). */
  delivery?: {
    status: string | null;
    assigneeRef: string | null;
    assigneeName: string | null;
    carrier: string | null;
    trackingNumber: string | null;
    address: {
      line1?: string;
      wardName?: string;
      provinceName?: string;
      recipientName?: string;
      phone?: string;
    } | null;
    shippedAt: string | null;
    due: number;
  };
};

export type OrderDetail = {
  order: {
    id: number;
    code: string;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
    placedAt: string;
    businessDate: string;
    locationRef: string;
    branch: { code: string; name: unknown; timezone: string };
    /** O11: the linked customer profile (masked), when the order belongs to one — links S4→C2. */
    customer: { id: string; name: string | null; phoneMasked: string | null; status: string } | null;
    origin: { kind: string; actorRef?: string };
    contact: { name?: string; phone?: string; email?: string };
    consent: { policyVersion?: string; acceptedAt?: string; channel?: string; actorRef?: string; marketingOptIn?: boolean };
    customerNote: string | null;
    placedLocale: string | null;
    receiveMethod: {
      kind?: string;
      timing?: { mode?: string; slot?: { startsAt: string; endsAt: string }; requestedReadyAt?: string };
    };
  };
  group: { id: number; status: string; workflow: string; estimatedReadyAt: string | null; slaMinutes: number } | null;
  lines: Array<{
    id: number;
    title: string;
    sku: string | null;
    options: Array<{ group: string; name: string; quantity: number }>;
    note: string | null;
    quantity: number;
    canceledQuantity: number;
    unitAmount: number;
    optionAmount: number;
    lineTotalAmount: number;
  }>;
  adjustments: Array<{ kind: string; code: string; label: string; amount: number }>;
  totals: {
    currency: string;
    subtotal: number;
    adjustment: number;
    fulfillment: number;
    tax: number;
    total: number;
    paid: number;
    refunded: number;
    due: number;
  };
  payments: Array<{
    id: number;
    providerCode: string;
    status: string;
    capturedAmount: number;
    refundedAmount: number;
    actorName: string | null;
    capturedAt: string | null;
  }>;
  paymentEvents: Array<{
    id: number;
    paymentId: number;
    kind: string | null;
    amount: number;
    referenceMasked: string;
    reviewStatus: string;
    confirmed: boolean;
    receivedAt: string;
  }>;
  refunds: Array<{
    id: number;
    paymentId: number | null;
    amount: number;
    reason: string;
    status: string;
    actorName: string | null;
    settledAt: string | null;
    referenceMasked: string | null;
  }>;
  timeline: Array<{
    id: number;
    type: string;
    isPublic: boolean;
    actorRef: string;
    actorName: string | null;
    payload: Record<string, unknown> | null;
    occurredAt: string;
  }>;
  nextTransitions: NextTransition[];
  paymentLink: { expiresAt: string } | null;
  settings: { delayMinutes: number[] };
  /** The delivery leg of a delivery order (O5); null for pickup orders. */
  delivery: {
    status: string | null;
    assigneeRef: string | null;
    assigneeName: string | null;
    carrier: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    address: {
      line1?: string;
      wardName?: string;
      provinceName?: string;
      recipientName?: string;
      phone?: string;
      note?: string;
    } | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    canceledAt: string | null;
    lastFailure: { code: string; note: string | null; at: string } | null;
    attempts: number;
  } | null;
};

export type BranchSummary = { code: string; name: Record<string, string>; timezone: string; onlineOrdering: boolean };

/** A courier the assign dialog may pick (`GET /orders/delivery-staff`). */
export type DeliveryStaff = { ref: string; name: string };
