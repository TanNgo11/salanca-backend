import { randomUUID } from 'node:crypto';

import type { PaymentProvider } from '../contracts';

/** Deterministic provider for integration tests; only registered under `testing.builtins`. */
export const createTestPaymentProvider = (): PaymentProvider => ({
  code: 'test',
  capabilities: ['capture', 'refund'],
  webhookAckMode: 'immediate',
  async getPresentation() {
    return { memo: 'TEST' };
  },
  async initiate() {
    return { status: 'pending', providerReference: `test-${randomUUID()}` };
  },
  async capture(input) {
    return { status: 'captured', providerReference: input.payment.providerReference };
  },
  async refund() {
    return { status: 'settled', providerReference: `test-refund-${randomUUID()}` };
  },
  async parseWebhook() {
    return [];
  },
  webhookResponse() {
    return { status: 200, body: { success: true } };
  },
});
