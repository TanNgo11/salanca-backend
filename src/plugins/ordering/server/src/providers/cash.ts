import { randomUUID } from 'node:crypto';

import type { PaymentProvider } from '../contracts';

/**
 * Cash at the counter (contracts §19.3). Nothing leaves the system: "Thu tiền và giao" records
 * the capture against a pending cash payment, and a cash refund is settled at once because the
 * money is handed back in person. Staff actor and time are recorded by the payment/refund
 * services, not here.
 */
export const createCashPaymentProvider = (): PaymentProvider => ({
  code: 'cash',
  capabilities: ['manual', 'capture', 'refund'],
  webhookAckMode: 'immediate',
  async getPresentation() {
    return {};
  },
  async initiate() {
    return { status: 'pending', providerReference: `cash-${randomUUID()}` };
  },
  async capture(input) {
    return { status: 'captured', providerReference: input.payment.providerReference };
  },
  async refund() {
    return { status: 'settled', providerReference: `cash-refund-${randomUUID()}` };
  },
  async parseWebhook() {
    return [];
  },
  webhookResponse() {
    return { status: 400, body: { error: 'cash has no webhook' } };
  },
});

/** A provider counts as "online" (usable for prepay / accept-then-pay) when it declares it. */
export const isOnlinePaymentProvider = (provider: PaymentProvider): boolean =>
  provider.capabilities.includes('online');
