import { randomUUID } from 'node:crypto';

import type { PaymentProvider } from '../contracts';

/**
 * Stored-value gift card (O9). The balance itself moves inside `services/order` (redeem at
 * create) and `services/refund` (credit back on refund) — always inside the caller's
 * transaction, never here. A `gift-card` payment therefore lands `captured` the moment it is
 * written, and its refund is `settled` immediately because value returns to the card, not a
 * bank. The provider is never offered as a checkout method (`online` is absent): a card is
 * applied through `payment.giftCardCode` alongside the order's real method.
 */
export const createGiftCardPaymentProvider = (): PaymentProvider => ({
  code: 'gift-card',
  capabilities: ['capture', 'refund'],
  webhookAckMode: 'immediate',
  async getPresentation() {
    return {};
  },
  async initiate() {
    return { status: 'captured', providerReference: `gift-card-${randomUUID()}` };
  },
  async refund() {
    return { status: 'settled', providerReference: `gift-card-refund-${randomUUID()}` };
  },
  async parseWebhook() {
    return [];
  },
  webhookResponse() {
    return { status: 400, body: { error: 'gift-card has no webhook' } };
  },
});
