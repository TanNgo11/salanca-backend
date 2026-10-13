import { randomUUID } from 'node:crypto';

import type { JsonObject } from '../../contracts/common';
import type {
  NormalizedPaymentEvent,
  PaymentProvider,
  WebhookProcessingResult,
} from '../../contracts/payment';
import { OrderingError } from '../../domain/errors';
import type { ProviderHttpClient } from '../_http';
import { createProviderHttp, jsonObject } from '../_http';
import { parseVnpaySettings, vnpayBaseUrl, type VnpaySettings } from './config';
import {
  vnpayChecksum,
  vnpayDate,
  vnpayDateToDate,
  vnpayPipeChecksum,
  VNPAY_QUERY_PIPE_FIELDS,
  VNPAY_REFUND_PIPE_FIELDS,
  verifyVnpayParams,
} from './signature';

const VNPAY_VERSION = '2.1.0';
const str = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

/** VNPay orderInfo must be plain text without diacritics — strip accents, keep ASCII. */
const vnpayOrderInfo = (orderCode: string): string =>
  `Thanh toan don hang ${orderCode}`
    .normalize('NFD')
    .replace(/[̀-ͯđĐ]/g, (ch) => (ch === 'đ' ? 'd' : ch === 'Đ' ? 'D' : ''))
    .replace(/[^ -~]/g, '')
    .slice(0, 255);

const providerError = (operation: string, reason: string | undefined): OrderingError =>
  new OrderingError('PROVIDER_UNAVAILABLE', `vnpay ${operation} rejected`, {
    details: { reason: reason ?? 'no-json-response' },
  });

/** IPN `{RspCode, Message}` per result — the codes VNPay itself documents. */
const IPN_RESPONSES: Record<WebhookProcessingResult, { RspCode: string; Message: string }> = {
  accepted: { RspCode: '00', Message: 'Confirm Success' },
  duplicate: { RspCode: '02', Message: 'Order already confirmed' },
  'order-not-found': { RspCode: '01', Message: 'Order not found' },
  'amount-mismatch': { RspCode: '04', Message: 'Invalid amount' },
  'invalid-signature': { RspCode: '97', Message: 'Invalid Checksum' },
  'invalid-payload': { RspCode: '99', Message: 'Unknown error' },
  'ignored-money-out': { RspCode: '00', Message: 'Confirm Success' },
  failed: { RspCode: '99', Message: 'Unknown error' },
};

/**
 * VNPay PAY v2.1.0 (docs/providers/vnpay.md). Hosted checkout: `initiate` signs and returns
 * the pay URL (no HTTP call); the IPN arrives as GET with signed `vnp_*` params and answers
 * `{RspCode, Message}` after matching (ackMode `after-processing`). `vnp_TxnRef` is the
 * session's providerReference `<orderCode>-<paymentId>`; `vnp_TransactionNo` is the
 * providerTransactionId. Return URL params never move money.
 */
export const createVnpayPaymentProvider = (deps: {
  settings: () => VnpaySettings | null;
  publicApiUrl: () => string;
  /** Injectable for tests. */
  client?: ProviderHttpClient;
  /** Injectable clock for deterministic signing tests. */
  now?: () => Date;
}): PaymentProvider => {
  const requireSettings = (): VnpaySettings => {
    const settings = deps.settings();
    if (!settings) throw new OrderingError('CONFIG_INVALID', 'vnpay is not configured');
    return settings;
  };
  const client = (settings: VnpaySettings): ProviderHttpClient =>
    deps.client ?? createProviderHttp({ baseUrl: vnpayBaseUrl(settings) });
  const now = () => deps.now?.() ?? new Date();
  const base = (): string => {
    const url = deps.publicApiUrl().replace(/\/+$/, '');
    if (url === '') {
      throw new OrderingError(
        'CONFIG_INVALID',
        'ORDERING_PUBLIC_API_URL is required for vnpay sessions',
      );
    }
    return url;
  };

  const apiPost = (settings: VnpaySettings, body: Record<string, string>) =>
    client(settings).postJson('/merchant_webapi/api/transaction', body);

  return {
    code: 'vnpay',
    capabilities: ['online', 'signed-webhook', 'wallet', 'refund'],
    webhookAckMode: 'after-processing',

    async getPresentation(input) {
      const session =
        input.metadata?.session !== null &&
        typeof input.metadata?.session === 'object' &&
        !Array.isArray(input.metadata.session)
          ? (input.metadata.session as JsonObject)
          : {};
      const redirectUrl = str(session.payUrl) || str(session.redirectUrl);
      return redirectUrl === '' ? {} : { redirectUrl };
    },

    async initiate(input) {
      const settings = requireSettings();
      const reference =
        typeof input.metadata?.reference === 'string' && input.metadata.reference !== ''
          ? input.metadata.reference
          : `vnpay-${randomUUID()}`;
      const created = now();
      const createDate = vnpayDate(created);
      const expireDate = vnpayDate(new Date(created.getTime() + 15 * 60_000));
      const returnUrl =
        input.returnUrl && input.returnUrl.startsWith('https://')
          ? input.returnUrl
          : `${base()}/api/v1/ordering/payments/return/vnpay`;
      const params: Record<string, string> = {
        vnp_Version: VNPAY_VERSION,
        vnp_Command: 'pay',
        vnp_TmnCode: settings.tmnCode,
        vnp_Amount: String(input.amount.amount * 100),
        vnp_CurrCode: 'VND',
        vnp_TxnRef: reference,
        vnp_OrderInfo: vnpayOrderInfo(input.order.code ?? ''),
        vnp_OrderType: settings.orderType,
        vnp_Locale: settings.locale,
        vnp_ReturnUrl: returnUrl,
        vnp_IpnUrl: `${base()}/api/v1/ordering/webhooks/vnpay`,
        vnp_IpAddr: str(input.metadata?.ipAddr) || '127.0.0.1',
        vnp_CreateDate: createDate,
        vnp_ExpireDate: expireDate,
      };
      const secureHash = vnpayChecksum(settings.hashSecret, params);
      const query = Object.keys(params)
        .sort()
        .map((key) => `${key}=${encodeURIComponent(params[key])}`)
        .join('&');
      const payUrl = `${vnpayBaseUrl(settings)}/paymentv2/vpcpay.html?${query}&vnp_SecureHash=${secureHash}`;
      return {
        status: 'pending',
        providerReference: reference,
        redirectUrl: payUrl,
        session: { payUrl, vnpCreateDate: createDate },
      };
    },

    async parseWebhook(input) {
      const settings = requireSettings();
      const params = input.params;
      if (!params || Object.keys(params).length === 0) {
        throw new OrderingError('VALIDATION_ERROR', 'vnpay ipn needs the query param set', {
          details: { reason: 'invalid-payload' },
        });
      }
      const verdict = verifyVnpayParams({ params, secret: settings.hashSecret });
      if (!verdict.ok) {
        throw new OrderingError('WEBHOOK_SIGNATURE_INVALID', 'vnpay ipn checksum rejected', {
          details: { reason: verdict.reason },
        });
      }
      const p = verdict.params;
      const txnRef = p.vnp_TxnRef?.trim() ?? '';
      const amount = Number(p.vnp_Amount);
      if (txnRef === '' || !Number.isSafeInteger(amount) || amount < 0) {
        throw new OrderingError('VALIDATION_ERROR', 'invalid vnpay ipn payload', {
          details: { reason: 'invalid-payload' },
        });
      }
      const ok = p.vnp_ResponseCode === '00' && p.vnp_TransactionStatus === '00';
      const transactionNo = p.vnp_TransactionNo?.trim() ?? '';
      return [
        {
          providerCode: 'vnpay',
          providerTransactionId:
            transactionNo !== '' ? transactionNo : `vnpay-failed-${txnRef}`,
          kind: ok ? 'capture' : 'failed',
          amount: { amount: amount / 100, currency: 'VND' },
          transferType: 'in',
          reference: txnRef,
          metadata: {
            responseCode: p.vnp_ResponseCode,
            transactionStatus: p.vnp_TransactionStatus,
            payDate: p.vnp_PayDate,
            bankCode: p.vnp_BankCode,
          },
        },
      ];
    },

    webhookResponse({ result }) {
      return { status: 200, body: { ...IPN_RESPONSES[result] } };
    },

    async queryTransaction(reference, context) {
      const settings = requireSettings();
      const session = context?.session ?? {};
      const transactionDate = str(session.vnpCreateDate);
      if (!vnpayDateToDate(transactionDate)) {
        throw new OrderingError(
          'VALIDATION_ERROR',
          'vnpay querydr needs the session create date',
          { details: { reason: 'missing-vnpCreateDate' } },
        );
      }
      const fields: Record<string, string> = {
        vnp_RequestId: randomUUID(),
        vnp_Version: VNPAY_VERSION,
        vnp_Command: 'querydr',
        vnp_TmnCode: settings.tmnCode,
        vnp_TxnRef: reference,
        vnp_TransactionDate: transactionDate,
        vnp_CreateDate: vnpayDate(now()),
        vnp_IpAddr: '127.0.0.1',
        vnp_OrderInfo: `Query ${reference}`,
      };
      const response = await apiPost(settings, {
        ...fields,
        vnp_SecureHash: vnpayPipeChecksum(settings.hashSecret, fields, VNPAY_QUERY_PIPE_FIELDS),
      });
      const body = jsonObject(response);
      const responseCode = str(body?.vnp_ResponseCode);
      if (response.status !== 200 || responseCode !== '00') {
        throw providerError('querydr', `response:${responseCode || response.status}`);
      }
      const status = str(body?.vnp_TransactionStatus);
      const amount = Number(str(body?.vnp_Amount));
      const transactionNo = str(body?.vnp_TransactionNo);
      const event = (kind: 'capture' | 'failed'): NormalizedPaymentEvent => ({
        providerCode: 'vnpay',
        providerTransactionId:
          transactionNo !== '' ? transactionNo : `vnpay-${kind}-${reference}`,
        kind,
        amount: { amount: Number.isSafeInteger(amount) ? amount / 100 : -1, currency: 'VND' },
        transferType: 'in',
        reference,
        metadata: {
          transactionStatus: status,
          responseCode,
          payDate: str(body?.vnp_PayDate),
        },
      });
      if (status === '00') return event('capture');
      // 01 pending / 02 processing at VNPay → nothing to apply yet.
      if (status === '01' || status === '02' || status === '') return null;
      return event('failed');
    },

    async refund(input) {
      const settings = requireSettings();
      const reference = input.payment.providerReference ?? '';
      if (reference === '') {
        throw new OrderingError('VALIDATION_ERROR', 'vnpay refund needs a payment reference');
      }
      const session = input.payment.session ?? {};
      const transactionNo = str(session.transactionNo);
      const transactionDate = str(session.vnpCreateDate);
      if (transactionNo === '' || !vnpayDateToDate(transactionDate)) {
        throw new OrderingError(
          'VALIDATION_ERROR',
          'vnpay refund needs the captured transaction (session.transactionNo/vnpCreateDate)',
          { details: { reason: 'missing-transaction' } },
        );
      }
      const captured = input.payment.capturedAmount;
      // 02 = full refund, 03 = partial (docs/providers/vnpay.md).
      const transactionType = input.amount.amount === captured ? '02' : '03';
      const fields: Record<string, string> = {
        vnp_RequestId: input.idempotencyKey,
        vnp_Version: VNPAY_VERSION,
        vnp_Command: 'refund',
        vnp_TmnCode: settings.tmnCode,
        vnp_TransactionType: transactionType,
        vnp_TxnRef: reference,
        vnp_Amount: String(input.amount.amount * 100),
        vnp_TransactionNo: transactionNo,
        vnp_TransactionDate: transactionDate,
        vnp_CreateBy: settings.createBy,
        vnp_CreateDate: vnpayDate(now()),
        vnp_IpAddr: '127.0.0.1',
        vnp_OrderInfo: input.reason.slice(0, 255),
      };
      const response = await apiPost(settings, {
        ...fields,
        vnp_SecureHash: vnpayPipeChecksum(settings.hashSecret, fields, VNPAY_REFUND_PIPE_FIELDS),
      });
      const body = jsonObject(response);
      const responseCode = str(body?.vnp_ResponseCode);
      // 94 = same request already received inside 5 minutes — the refund exists at VNPay.
      if (response.status === 200 && (responseCode === '00' || responseCode === '94')) {
        return { status: 'settled', providerReference: str(body?.vnp_TransactionNo) || transactionNo };
      }
      throw providerError('refund', `response:${responseCode || response.status}`);
    },
  };
};

export const vnpaySettingsFromConfig = (paymentProviders: unknown): VnpaySettings | null => {
  const vnpay = (paymentProviders as { vnpay?: unknown } | undefined)?.vnpay;
  return parseVnpaySettings(vnpay);
};
