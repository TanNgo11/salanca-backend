import type { PaymentProvider, WebhookProcessingResult } from '../../contracts/payment';
import { OrderingError } from '../../domain/errors';
import type { SepayTransactionClient, SepayTransactionPage } from './client';
import type { SepaySettings } from './config';
import { parseSepaySettings } from './config';
import { parseSepayPayload } from './parse';
import { buildSepayPresentation } from './presentation';
import { verifySepaySignature } from './signature';

const header = (headers: Record<string, string>, name: string): string | undefined => {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

/**
 * Bank-transfer provider (contracts §8, §19.1). Signature checks use the raw body the caller
 * already extracted — this function never re-serializes JSON. Refunds stay pending until a
 * person records the outbound transfer reference (no bank API refund in v1).
 */
export const createSepayPaymentProvider = (deps: {
  settings: () => SepaySettings | null;
  now?: () => Date;
  qr?: 'svg' | 'remote';
  client?: SepayTransactionClient;
}): PaymentProvider & {
  listTransactionPage(input: { cursor?: string }): Promise<SepayTransactionPage>;
} => {
  const listTransactionPage = async (input: { cursor?: string }): Promise<SepayTransactionPage> => {
    if (!deps.client) return { rows: [], lastId: null, fetched: 0 };
    return deps.client.listPage({ sinceId: input.cursor, perPage: 100 });
  };
  return {
  code: 'sepay',
  capabilities: ['online', 'signed-webhook', 'transfer', 'refund'],
  webhookAckMode: 'immediate',

  async getPresentation(input) {
    const settings = deps.settings();
    if (!settings) return {};
    const order = input.order as { code?: string; locationRef?: string };
    return buildSepayPresentation({
      settings,
      locationRef: order.locationRef ?? '',
      orderCode: order.code ?? '',
      amount: input.amount.amount,
      expiresAt: typeof input.metadata?.expiresAt === 'string' ? input.metadata.expiresAt : undefined,
      qr: deps.qr ?? 'remote',
    });
  },

  async initiate() {
    return { status: 'pending' };
  },

  async refund() {
    return { status: 'pending' };
  },

  async parseWebhook(input) {
    const settings = deps.settings();
    if (!settings) {
      throw new OrderingError('CONFIG_INVALID', 'sepay is not configured');
    }
    const verdict = verifySepaySignature({
      secret: settings.webhookSecret,
      timestampHeader: header(input.headers, 'x-sepay-timestamp'),
      signatureHeader: header(input.headers, 'x-sepay-signature'),
      rawBody: input.body,
      now: deps.now?.() ?? new Date(),
    });
    if (!verdict.ok) {
      throw new OrderingError('WEBHOOK_SIGNATURE_INVALID', 'webhook signature was rejected', {
        details: { reason: verdict.reason },
      });
    }
    return parseSepayPayload(input.body);
  },

  webhookResponse({ result }) {
    if (result === 'invalid-signature') return { status: 401, body: { success: false } };
    if (result === 'invalid-payload') return { status: 400, body: { success: false } };
    return { status: 200, body: { success: true } };
  },

  async listTransactions(input) {
    const page = await listTransactionPage({ cursor: input.cursor });
    return page.rows.flatMap((row) => (row.event ? [row.event] : []));
  },

  listTransactionPage,
  };
};

export const sepaySettingsFromConfig = (paymentProviders: unknown): SepaySettings | null => {
  const sepay = (paymentProviders as { sepay?: unknown } | undefined)?.sepay;
  return parseSepaySettings(sepay);
};

export const webhookResultForError = (error: unknown): WebhookProcessingResult | null => {
  if (!(error instanceof OrderingError)) return null;
  if (error.code === 'WEBHOOK_SIGNATURE_INVALID') return 'invalid-signature';
  if (error.code === 'VALIDATION_ERROR' && error.details?.reason === 'invalid-payload') {
    return 'invalid-payload';
  }
  return null;
};
