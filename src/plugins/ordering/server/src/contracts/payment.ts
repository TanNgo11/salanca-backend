import type { JsonObject } from './common';
import type { Currency, Money } from '../domain/money';
import type { Order } from './entities';
import type { RefundLine } from './entities';

/** Payment ledger entities and the payment provider contract (contracts doc §8). */
export type Payment = {
  order: Order;
  providerCode: string;
  requestedAmount: number;
  capturedAmount: number;
  refundedAmount: number;
  currency: Currency;
  status: 'pending' | 'authorized' | 'captured' | 'failed' | 'cancelled';
  providerReference?: string;
  /** O13 wallet session row (`payment.session`) — initiatedAt, provider txn ids for refunds. */
  session?: JsonObject;
};

export type PaymentEvent = {
  providerCode: string;
  providerTransactionId: string;
  payment?: Payment;
  transferType?: 'in' | 'out';
  amount: number;
  currency: Currency;
  kind: string;
  rawPayload: JsonObject;
  receivedAt: string;
  reviewStatus: 'auto-matched' | 'needs-review' | 'matched-manually' | 'refund-due' | 'ignored';
  reviewReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
};

export type Refund = {
  payment: Payment;
  amount: number;
  currency: Currency;
  reason: string;
  status: string;
  lines: RefundLine[];
};

export type RawWebhook = {
  headers: Record<string, string>;
  body: string;
  /** O13: parsed query params for GET IPNs (VNPay signs the param set, there is no body). */
  params?: Record<string, unknown>;
  receivedAt: string;
};

export type NormalizedPaymentEvent = {
  providerCode: string;
  providerTransactionId: string;
  kind: string;
  amount: Money;
  transferType?: 'in' | 'out';
  reference?: string;
  metadata?: JsonObject;
};

/**
 * A status query must distinguish "still waiting" from a definitive provider answer. `null`
 * used to mean both pending and not-found, which let the reconciliation job turn transport
 * failures into a business decision for old sessions.
 */
export type PaymentQueryResult =
  | { outcome: 'event'; event: NormalizedPaymentEvent }
  | { outcome: 'pending' }
  | { outcome: 'terminal-not-found' };

export type WebhookAckMode = 'after-processing' | 'immediate';
export type WebhookProcessingResult =
  | 'accepted'
  | 'duplicate'
  | 'order-not-found'
  | 'amount-mismatch'
  | 'invalid-signature'
  | 'invalid-payload'
  | 'ignored-money-out'
  | 'failed';

export type PaymentInitiation = {
  order: Order;
  amount: Money;
  returnUrl?: string;
  metadata?: JsonObject;
};

export type PaymentInitiationResult = {
  status: Payment['status'];
  providerReference?: string;
  redirectUrl?: string;
  /**
   * O13 wallet sessions: provider-side display data (deeplink, qrCodeUrl, requestId) stored on
   * `payment.session`. Never put secrets or customer PII here — Admin may render it.
   */
  session?: JsonObject;
};

export type PaymentAction = { payment: Payment; amount?: Money; providerReference?: string };
export type PaymentActionResult = { status: string; providerReference?: string };
export type RefundRequest = {
  payment: Payment;
  amount: Money;
  reason: string;
  idempotencyKey: string;
};

export interface PaymentProvider {
  code: string;
  capabilities: string[];
  webhookAckMode: WebhookAckMode;
  getPresentation(input: PaymentInitiation): Promise<{
    qr?: string;
    bankAccount?: JsonObject;
    memo?: string;
    expiresAt?: string;
    /** O13 wallets: the stored session's pay URL, replayed for the payment page. */
    redirectUrl?: string;
  }>;
  initiate(input: PaymentInitiation): Promise<PaymentInitiationResult>;
  authorize?(input: PaymentAction): Promise<PaymentActionResult>;
  capture?(input: PaymentAction): Promise<PaymentActionResult>;
  cancel?(input: PaymentAction): Promise<PaymentActionResult>;
  refund?(input: RefundRequest): Promise<PaymentActionResult>;
  parseWebhook(input: RawWebhook): Promise<NormalizedPaymentEvent[]>;
  webhookResponse(input: { raw: RawWebhook; result: WebhookProcessingResult }): {
    status: 200 | 201 | 202 | 204 | 400 | 401 | 500;
    headers?: Record<string, string>;
    body?: JsonObject;
  };
  /**
   * Status query by session reference. `context.session` carries the stored wallet session
   * (initiatedAt, transactionNo) — VNPay querydr signs the original transaction's create date.
   */
  queryTransaction?(
    reference: string,
    context?: { session?: JsonObject },
  ): Promise<PaymentQueryResult>;
  listTransactions?(input: {
    from: string;
    to: string;
    cursor?: string;
  }): Promise<NormalizedPaymentEvent[]>;
}
