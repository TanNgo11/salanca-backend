import type { Core } from '@strapi/strapi';

import type { WebhookProcessingResult } from '../contracts/payment';
import { OrderingError } from '../domain/errors';
import { readUnparsedBody } from '../domain/raw-body';
import { webhookResultForError } from '../providers/sepay/provider';
import type { ServiceContext } from './context';
import { nowOf } from './context';
import type paymentFactory from './payment';
import type { OrderingRegistry } from './registry';

type PaymentService = ReturnType<typeof paymentFactory>;

const asObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Public webhook entry (contracts §8). The signature is checked on `rawBody` — never on a
 * re-serialized JSON value. `immediate` providers (SePay) ACK `{"success": true}` after the
 * raw event is durable, including duplicates and money that does not match an order. A bad
 * signature is the only rejection. Business matching is applied by the payment-ingest service
 * once the event row exists.
 */
const webhook = ({ strapi }: { strapi: Core.Strapi }) => {
  const registry = () => strapi.plugin('ordering').service('registry') as OrderingRegistry;
  const payments = () => strapi.plugin('ordering').service('payment') as PaymentService;

  return {
    async receive(
      input: {
        providerCode: string;
        body: unknown;
        headers: Record<string, string>;
      },
      ctx: ServiceContext,
    ): Promise<{ status: number; body?: Record<string, unknown> }> {
      const provider = registry().paymentProvider(input.providerCode);
      const receivedAt = nowOf(ctx).toISOString();
      const rawBody = readUnparsedBody(input.body);
      const raw = { headers: input.headers, body: rawBody ?? '', receivedAt };

      if (provider.capabilities.includes('signed-webhook') && rawBody === null) {
        strapi.log.warn(`[ordering] webhook ${input.providerCode} rejected: raw body unavailable`);
        throw new OrderingError(
          'RAW_BODY_UNAVAILABLE',
          'the original request body is not available; signature checks are refused',
        );
      }

      let result: WebhookProcessingResult = 'accepted';
      try {
        const events = await provider.parseWebhook(raw);
        for (const event of events) {
          const saved = await payments().recordPaymentEvent(
            {
              providerCode: event.providerCode,
              providerTransactionId: event.providerTransactionId,
              kind: event.kind,
              amount: event.amount.amount,
              currency: event.amount.currency,
              transferType: event.transferType,
              rawPayload: asObject(rawBody ? JSON.parse(rawBody) : {}),
              reviewStatus: event.transferType === 'out' ? 'ignored' : 'needs-review',
              reviewReason: event.transferType === 'out' ? null : 'no-code',
              receivedAt: nowOf(ctx),
            },
            ctx,
          );
          if (event.transferType === 'out') {
            result = saved.duplicate ? 'duplicate' : 'ignored-money-out';
          } else if (saved.duplicate) {
            result = 'duplicate';
          }
        }
      } catch (error) {
        const mapped = webhookResultForError(error);
        if (!mapped) throw error;
        if (mapped === 'invalid-signature') {
          const reason =
            error instanceof OrderingError && typeof error.details?.reason === 'string'
              ? error.details.reason
              : 'rejected';
          strapi.log.warn(`[ordering] webhook ${input.providerCode} signature rejected (${reason})`);
        }
        return provider.webhookResponse({ raw, result: mapped });
      }

      if (provider.webhookAckMode === 'immediate') {
        // SePay retries anything other than success. The event is already stored.
        return provider.webhookResponse({ raw, result: 'accepted' });
      }
      return provider.webhookResponse({ raw, result });
    },
  };
};

export default webhook;
