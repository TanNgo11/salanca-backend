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
  queryTransaction?(reference: string): Promise<NormalizedPaymentEvent | null>;
  listTransactions?(input: {
    from: string;
    to: string;
    cursor?: string;
  }): Promise<NormalizedPaymentEvent[]>;
}
