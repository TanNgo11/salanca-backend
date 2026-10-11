import type { NormalizedPaymentEvent } from '../../contracts/payment';
import { OrderingError } from '../../domain/errors';

export type SepayWebhookPayload = {
  id: string;
  gateway?: string;
  transactionDate?: string;
  accountNumber?: string;
  subAccount?: string | null;
  code?: string | null;
  content?: string;
  transferType: 'in' | 'out';
  transferAmount: number;
  referenceCode?: string | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/**
 * One SePay webhook is one transfer. `id` is the idempotency key. Amounts are VND integers;
 * a fractional đồng is rounded to the nearest đồng (SePay sometimes sends "100000.00").
 */
export const parseSepayPayload = (rawBody: string): NormalizedPaymentEvent[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new OrderingError('VALIDATION_ERROR', 'webhook body is not json', {
      details: { reason: 'invalid-payload' },
    });
  }
  const body = asRecord(parsed);
  if (!body) {
    throw new OrderingError('VALIDATION_ERROR', 'webhook body must be an object', {
      details: { reason: 'invalid-payload' },
    });
  }
  const id = body.id;
  const providerTransactionId =
    typeof id === 'number' && Number.isSafeInteger(id)
      ? String(id)
      : typeof id === 'string' && /^\d{1,20}$/.test(id)
        ? id
        : null;
  const transferType = body.transferType === 'in' || body.transferType === 'out' ? body.transferType : null;
  const amountRaw = body.transferAmount;
  const amountNumber = typeof amountRaw === 'number' ? amountRaw : typeof amountRaw === 'string' ? Number(amountRaw) : NaN;
  if (!providerTransactionId || !transferType || !Number.isFinite(amountNumber) || amountNumber < 0) {
    throw new OrderingError('VALIDATION_ERROR', 'webhook payload is missing id, transferType or amount', {
      details: { reason: 'invalid-payload' },
    });
  }
  const amount = Math.round(amountNumber);
  const payload: SepayWebhookPayload = {
    id: providerTransactionId,
    gateway: text(body.gateway),
    transactionDate: text(body.transactionDate),
    accountNumber: text(body.accountNumber),
    subAccount: text(body.subAccount) ?? null,
    code: text(body.code) ?? null,
    content: typeof body.content === 'string' ? body.content : undefined,
    transferType,
    transferAmount: amount,
    referenceCode: text(body.referenceCode) ?? null,
  };
  return [
    {
      providerCode: 'sepay',
      providerTransactionId,
      kind: 'transfer',
      amount: { amount, currency: 'VND' },
      transferType,
      reference: payload.referenceCode ?? undefined,
      metadata: {
        accountNumber: payload.accountNumber,
        subAccount: payload.subAccount,
        content: payload.content,
        code: payload.code,
        gateway: payload.gateway,
        transactionDate: payload.transactionDate,
      },
    },
  ];
};
