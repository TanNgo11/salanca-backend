/** Shapes returned by the plugin's admin order routes (server/src/services/admin-orders.ts). */
export type NextTransition = {
  to: string;
  kind: 'primary' | 'secondary' | 'danger';
  requires: Array<'reason' | 'cash'>;
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
  settings: { delayMinutes: number[] };
};

export type BranchSummary = { code: string; name: Record<string, string>; timezone: string; onlineOrdering: boolean };
