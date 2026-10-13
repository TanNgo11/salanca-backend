import { randomUUID } from 'node:crypto';

import type { JsonObject } from '../../contracts/common';
import type {
  NormalizedPaymentEvent,
  PaymentProvider,
} from '../../contracts/payment';
import { OrderingError } from '../../domain/errors';
import type { ProviderHttpClient } from '../_http';
import { createProviderHttp, jsonObject } from '../_http';
import { momoBaseUrl, parseMomoSettings, type MomoSettings } from './config';
import {
  MOMO_CREATE_SIGN_FIELDS,
  MOMO_QUERY_SIGN_FIELDS,
  MOMO_REFUND_SIGN_FIELDS,
  momoSign,
  verifyMomoIpnSignature,
} from './signature';

const asObject = (value: unknown): JsonObject => (jsonObject({ status: 0, body: value }) ?? {}) as JsonObject;

const str = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
};

const MOMO_RESULT_OK = '0';
/** MoMo resultCodes for a finished-but-unsuccessful transaction (query/IPN). */
const MOMO_RESULT_FAILED = new Set(['1006', '1004', '9000']);

const providerError = (operation: string, resultCode: string | undefined): OrderingError =>
  new OrderingError('PROVIDER_UNAVAILABLE', `momo ${operation} rejected`, {
    details: { reason: resultCode ? `resultCode:${resultCode}` : 'no-json-response' },
  });

/**
 * MoMo AIO v2 wallet provider (docs/providers/momo.md, contracts §8). Session reference is
 * `<orderCode>-<paymentId>` — MoMo echoes it back as `orderId` on the IPN. `transId` is the
 * idempotency key (`providerTransactionId`). Secrets live in env; nothing provider-side is
 * logged beyond result codes.
 */
export const createMomoPaymentProvider = (deps: {
  settings: () => MomoSettings | null;
  /** Absolute base of this server — builds ipnUrl/redirectUrl. */
  publicApiUrl: () => string;
  /** Injectable for tests; default builds a bounded client per call from the env base URL. */
  client?: ProviderHttpClient;
}): PaymentProvider => {
  const requireSettings = (): MomoSettings => {
    const settings = deps.settings();
    if (!settings) throw new OrderingError('CONFIG_INVALID', 'momo is not configured');
    return settings;
  };
  const client = (settings: MomoSettings): ProviderHttpClient =>
    deps.client ?? createProviderHttp({ baseUrl: momoBaseUrl(settings) });
  const base = (): string => {
    const url = deps.publicApiUrl().replace(/\/+$/, '');
    if (url === '') {
      throw new OrderingError(
        'CONFIG_INVALID',
        'ORDERING_PUBLIC_API_URL is required for momo sessions',
      );
    }
    return url;
  };

  /** Resolves MoMo's `transId` for a captured payment — the refund API needs it. */
  const queryRaw = async (
    settings: MomoSettings,
    reference: string,
  ): Promise<Record<string, unknown>> => {
    const requestId = randomUUID();
    const fields = {
      accessKey: settings.accessKey,
      orderId: reference,
      partnerCode: settings.partnerCode,
      requestId,
    };
    const response = await client(settings).postJson('/v2/gateway/api/query', {
      partnerCode: settings.partnerCode,
      accessKey: settings.accessKey,
      requestId,
      orderId: reference,
      lang: 'vi',
      signature: momoSign(settings.secretKey, fields, MOMO_QUERY_SIGN_FIELDS),
    });
    return jsonObject(response) ?? {};
  };

  const eventFromPayload = (
    payload: Record<string, string>,
    kind: 'capture' | 'failed',
  ): NormalizedPaymentEvent => ({
    providerCode: 'momo',
    providerTransactionId: payload.transId,
    kind,
    amount: { amount: num(payload.amount), currency: 'VND' },
    transferType: 'in',
    reference: payload.orderId,
    metadata: {
      resultCode: payload.resultCode,
      requestId: payload.requestId,
      payType: payload.payType,
    },
  });

  return {
    code: 'momo',
    capabilities: ['online', 'signed-webhook', 'wallet', 'refund'],
    // MoMo expects 204 for every well-formed IPN, including duplicates and failures.
    webhookAckMode: 'immediate',

    async getPresentation(input) {
      // The session payload (payUrl/deeplink/qrCodeUrl) is stored on `payment.session` when
      // staff or the customer starts a wallet payment — presentation alone creates nothing.
      const session = asObject(input.metadata?.session);
      const redirectUrl = str(session.payUrl) || str(session.redirectUrl);
      return redirectUrl === '' ? {} : { redirectUrl };
    },

    async initiate(input) {
      const settings = requireSettings();
      const reference =
        typeof input.metadata?.reference === 'string' && input.metadata.reference !== ''
          ? input.metadata.reference
          : `momo-${randomUUID()}`;
      const requestId = randomUUID();
      const redirectUrl =
        input.returnUrl && input.returnUrl.startsWith('https://')
          ? input.returnUrl
          : `${base()}/api/v1/ordering/payments/return/momo`;
      const ipnUrl = `${base()}/api/v1/ordering/webhooks/momo`;
      // Order code is the only customer-facing hint MoMo needs; no PII in orderInfo.
      const orderInfo = `Thanh toan don hang ${input.order.code ?? ''}`.slice(0, 200);
      const fields = {
        accessKey: settings.accessKey,
        amount: input.amount.amount,
        extraData: '',
        ipnUrl,
        orderId: reference,
        orderInfo,
        partnerCode: settings.partnerCode,
        redirectUrl,
        requestId,
        requestType: settings.requestType,
      };
      const response = await client(settings).postJson('/v2/gateway/api/create', {
        partnerCode: settings.partnerCode,
        accessKey: settings.accessKey,
        requestId,
        amount: String(input.amount.amount),
        orderId: reference,
        orderInfo,
        redirectUrl,
        ipnUrl,
        extraData: '',
        requestType: settings.requestType,
        lang: 'vi',
        signature: momoSign(settings.secretKey, fields, MOMO_CREATE_SIGN_FIELDS),
      });
      const body = jsonObject(response);
      const resultCode = str(body?.resultCode);
      if (response.status !== 200 || resultCode !== MOMO_RESULT_OK) {
        throw providerError('create', resultCode || String(response.status));
      }
      const payUrl = str(body?.payUrl);
      if (payUrl === '') throw providerError('create', 'no-pay-url');
      return {
        status: 'pending',
        providerReference: reference,
        redirectUrl: payUrl,
        session: {
          payUrl,
          deeplink: str(body?.deeplink) || undefined,
          qrCodeUrl: str(body?.qrCodeUrl) || undefined,
          requestId,
        },
      };
    },

    async parseWebhook(input) {
      const settings = requireSettings();
      let payload: unknown;
      try {
        payload = JSON.parse(input.body);
      } catch {
        throw new OrderingError('VALIDATION_ERROR', 'invalid momo ipn payload', {
          details: { reason: 'invalid-payload' },
        });
      }
      const verdict = verifyMomoIpnSignature({
        payload: asObject(payload),
        accessKey: settings.accessKey,
        partnerCode: settings.partnerCode,
        secretKey: settings.secretKey,
      });
      if (!verdict.ok) {
        throw new OrderingError('WEBHOOK_SIGNATURE_INVALID', 'momo ipn signature rejected', {
          details: { reason: verdict.reason },
        });
      }
      const event = verdict.payload;
      if (event.transId === '' || event.orderId === '' || num(event.amount) < 0) {
        throw new OrderingError('VALIDATION_ERROR', 'invalid momo ipn payload', {
          details: { reason: 'invalid-payload' },
        });
      }
      const ok = event.resultCode === MOMO_RESULT_OK;
      // A pending transaction (rare on IPN) is ignored — the status job catches up via query.
      if (!ok && !MOMO_RESULT_FAILED.has(event.resultCode)) return [];
      return [eventFromPayload(event, ok ? 'capture' : 'failed')];
    },

    webhookResponse({ result }) {
      if (result === 'invalid-signature') return { status: 401 };
      if (result === 'invalid-payload') return { status: 400 };
      return { status: 204 };
    },

    async queryTransaction(reference) {
      const settings = requireSettings();
      const body = await queryRaw(settings, reference);
      const resultCode = str(body.resultCode);
      if (resultCode === MOMO_RESULT_OK) {
        const transId = str(body.transId);
        if (transId === '') throw providerError('query', 'no-trans-id');
        return eventFromPayload(
          {
            transId,
            orderId: reference,
            amount: str(body.amount),
            resultCode,
            requestId: str(body.requestId),
            payType: str(body.payType),
          },
          'capture',
        );
      }
      if (MOMO_RESULT_FAILED.has(resultCode)) {
        // Failed at MoMo — still a real terminal event for the pending payment.
        return eventFromPayload(
          {
            transId: `momo-failed-${reference}`,
            orderId: reference,
            amount: str(body.amount),
            resultCode,
            requestId: str(body.requestId),
            payType: '',
          },
          'failed',
        );
      }
      // resultCode 1000 and friends: still processing at MoMo — nothing to apply yet.
      return null;
    },

    async refund(input) {
      const settings = requireSettings();
      const reference = input.payment.providerReference ?? '';
      if (reference === '') {
        throw new OrderingError('VALIDATION_ERROR', 'momo refund needs a payment reference');
      }
      const queried = await queryRaw(settings, reference);
      const transId = str(queried.transId);
      if (transId === '') throw providerError('refund', 'no-trans-id');
      const requestId = input.idempotencyKey;
      const description = input.reason.slice(0, 200);
      const fields = {
        accessKey: settings.accessKey,
        amount: input.amount.amount,
        description,
        orderId: reference,
        partnerCode: settings.partnerCode,
        requestId,
        transId,
      };
      const response = await client(settings).postJson('/v2/gateway/api/refund', {
        partnerCode: settings.partnerCode,
        accessKey: settings.accessKey,
        requestId,
        orderId: reference,
        transId,
        amount: input.amount.amount,
        description,
        lang: 'vi',
        signature: momoSign(settings.secretKey, fields, MOMO_REFUND_SIGN_FIELDS),
      });
      const body = jsonObject(response);
      const resultCode = str(body?.resultCode);
      if (response.status === 200 && resultCode === MOMO_RESULT_OK) {
        return { status: 'settled', providerReference: str(body?.transId) || requestId };
      }
      throw providerError('refund', resultCode || String(response.status));
    },
  };
};

export const momoSettingsFromConfig = (paymentProviders: unknown): MomoSettings | null => {
  const momo = (paymentProviders as { momo?: unknown } | undefined)?.momo;
  return parseMomoSettings(momo);
};
