import type { Core } from '@strapi/strapi';

import type { CarrierWebhookResult } from '../contracts/fulfillment';
import type { WebhookProcessingResult } from '../contracts/payment';
import { OrderingError } from '../domain/errors';
import { readUnparsedBody } from '../domain/raw-body';
import type alertFactory from './alert';
import type carrierAssignmentFactory from './carrier-assignment';
import type { ServiceContext } from './context';
import { nowOf } from './context';
import type paymentMatchingFactory from './payment-matching';
import type { OrderingRegistry } from './registry';

type MatchingService = ReturnType<typeof paymentMatchingFactory>;
type CarrierAssignmentService = ReturnType<typeof carrierAssignmentFactory>;

const asObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Maps a provider parse error to a processing result (provider-agnostic — O13 wallets share
 * the SePay semantics: signature failures reject, payload shape errors map to 400).
 */
export const webhookResultForError = (error: unknown): WebhookProcessingResult | null => {
  if (!(error instanceof OrderingError)) return null;
  if (error.code === 'WEBHOOK_SIGNATURE_INVALID') return 'invalid-signature';
  if (error.code === 'VALIDATION_ERROR' && error.details?.reason === 'invalid-payload') {
    return 'invalid-payload';
  }
  return null;
};

/**
 * Public webhook entry (contracts §8). The signature is checked on `rawBody` — never on a
 * re-serialized JSON value. `immediate` providers (SePay) ACK `{"success": true}` after the
 * raw event is durable, including duplicates and money that does not match an order. A bad
 * signature is the only rejection. Business matching is applied by the payment-ingest service
 * once the event row exists.
 */
const webhook = ({ strapi }: { strapi: Core.Strapi }) => {
  const registry = () => strapi.plugin('ordering').service('registry') as OrderingRegistry;
  const matching = () => strapi.plugin('ordering').service('payment-matching') as MatchingService;
  const alerts = () => strapi.plugin('ordering').service('alert') as ReturnType<typeof alertFactory>;
  const carriers = () =>
    strapi.plugin('ordering').service('carrier-assignment') as CarrierAssignmentService;

  /**
   * O13 carrier pushes (Ahamove `apikey` token, POST body): parse → normalize → let
   * carrier-assignment move the delivery leg. Unknown refs/statuses ACK 200 so the carrier
   * stops retrying; a rejected token answers 401.
   */
  const receiveCarrier = async (
    provider: NonNullable<ReturnType<OrderingRegistry['fulfillmentProvider']>>,
    input: {
      providerCode: string;
      body: unknown;
      headers: Record<string, string>;
      params?: Record<string, unknown>;
    },
    ctx: ServiceContext,
  ): Promise<{ status: number; body?: Record<string, unknown> }> => {
    const respond = provider.carrierWebhookResponse?.bind(provider);
    if (!provider.parseCarrierWebhook || !respond) {
      return { status: 404 };
    }
    const receivedAt = nowOf(ctx).toISOString();
    const rawBody = readUnparsedBody(input.body);
    const raw = { headers: input.headers, body: rawBody ?? '', params: input.params, receivedAt };
    let result: CarrierWebhookResult = 'accepted';
    try {
      const events = await provider.parseCarrierWebhook(raw);
      for (const event of events) {
        await carriers().applyCarrierStatus(input.providerCode, event, ctx);
      }
    } catch (error) {
      const mapped = webhookResultForError(error);
      if (!mapped) {
        await alerts().noteWebhookFailure(input.providerCode, ctx);
        throw error;
      }
      await alerts().noteWebhookFailure(input.providerCode, ctx);
      if (mapped === 'invalid-signature') {
        strapi.log.warn(`[ordering] carrier webhook ${input.providerCode} rejected`);
      }
      result = mapped === 'invalid-signature' ? 'invalid-signature' : 'invalid-payload';
    }
    if (result === 'accepted') await alerts().noteWebhookSuccess(input.providerCode, ctx);
    return respond({ result });
  };

  return {
    async receive(
      input: {
        providerCode: string;
        body: unknown;
        headers: Record<string, string>;
        params?: Record<string, unknown>;
      },
      ctx: ServiceContext,
    ): Promise<{ status: number; body?: Record<string, unknown> }> {
      // A fulfillment provider code (ahamove) takes the carrier path — never payment matching.
      if (registry().hasFulfillmentProvider(input.providerCode)) {
        const fulfillment = registry().fulfillmentProvider(input.providerCode);
        if (fulfillment.parseCarrierWebhook) {
          return receiveCarrier(fulfillment, input, ctx);
        }
      }
      const provider = registry().paymentProvider(input.providerCode);
      const receivedAt = nowOf(ctx).toISOString();
      const rawBody = readUnparsedBody(input.body);
      const raw = { headers: input.headers, body: rawBody ?? '', params: input.params, receivedAt };

      if (provider.capabilities.includes('signed-webhook') && rawBody === null && !input.params) {
        strapi.log.warn(`[ordering] webhook ${input.providerCode} rejected: raw body unavailable`);
        await alerts().noteWebhookFailure(input.providerCode, ctx);
        throw new OrderingError(
          'RAW_BODY_UNAVAILABLE',
          'the original request body is not available; signature checks are refused',
        );
      }

      let result: WebhookProcessingResult = 'accepted';
      try {
        const events = await provider.parseWebhook(raw);
        const rawPayload = asObject(rawBody ? JSON.parse(rawBody) : (input.params ?? {}));
        for (const event of events) {
          const saved = await matching().ingest({ event, rawPayload }, ctx);
          if (saved.duplicate) {
            result = 'duplicate';
          } else if (saved.decision.outcome === 'ignored') {
            result = 'ignored-money-out';
          } else if (saved.decision.outcome === 'needs-review') {
            // after-processing providers (VNPay) answer the IPN with this outcome's code.
            const reason = saved.decision.reviewReason;
            result =
              reason === 'underpaid' || reason === 'overpaid'
                ? 'amount-mismatch'
                : reason === 'already-paid'
                  ? 'duplicate'
                  : reason === 'order-not-found' || reason === 'no-code'
                    ? 'order-not-found'
                    : reason === 'provider-uncertain'
                      ? 'accepted' // stored for staff review; a retry would add nothing
                      : 'failed';
          }
        }
      } catch (error) {
        const mapped = webhookResultForError(error);
        if (!mapped) {
          await alerts().noteWebhookFailure(input.providerCode, ctx);
          throw error;
        }
        await alerts().noteWebhookFailure(input.providerCode, ctx);
        if (mapped === 'invalid-signature') {
          const reason =
            error instanceof OrderingError && typeof error.details?.reason === 'string'
              ? error.details.reason
              : 'rejected';
          strapi.log.warn(`[ordering] webhook ${input.providerCode} signature rejected (${reason})`);
        }
        return provider.webhookResponse({ raw, result: mapped });
      }

      await alerts().noteWebhookSuccess(input.providerCode, ctx);
      if (provider.webhookAckMode === 'immediate') {
        // SePay retries anything other than success. The event is already stored.
        return provider.webhookResponse({ raw, result: 'accepted' });
      }
      return provider.webhookResponse({ raw, result });
    },
  };
};

export default webhook;
