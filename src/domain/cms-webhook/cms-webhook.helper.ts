import { createHmac, timingSafeEqual } from 'node:crypto';

import { isPlainRecord } from '../../shared/normalization/value';
import {
  CMS_WEBHOOK_ALLOWED_LOCALES,
  CMS_WEBHOOK_ALLOWED_UIDS,
  CMS_WEBHOOK_MAX_BODY_BYTES,
  CmsWebhookEvent,
  type CmsWebhookPayload,
} from './cms-webhook.types';

export enum CmsWebhookValidationErrorCode {
  InvalidLocale = 'CMS_WEBHOOK_INVALID_LOCALE',
  InvalidPayload = 'CMS_WEBHOOK_INVALID_PAYLOAD',
  InvalidSignature = 'CMS_WEBHOOK_INVALID_SIGNATURE',
  Oversized = 'CMS_WEBHOOK_OVERSIZED',
  UnsupportedUid = 'CMS_WEBHOOK_UNSUPPORTED_UID',
}

export class CmsWebhookValidationError extends Error {
  readonly code: CmsWebhookValidationErrorCode;

  constructor(code: CmsWebhookValidationErrorCode, message: string) {
    super(message);
    this.name = 'CmsWebhookValidationError';
    this.code = code;
  }
}

export const signCmsWebhookPayload = (rawBody: string, secret: string): string =>
  createHmac('sha256', secret).update(rawBody).digest('hex');

export const verifyCmsWebhookSignature = (
  rawBody: string,
  secret: string,
  signatureHeader: string | null | undefined,
): void => {
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    throw new CmsWebhookValidationError(
      CmsWebhookValidationErrorCode.InvalidSignature,
      'Missing webhook signature.',
    );
  }

  const expected = signCmsWebhookPayload(rawBody, secret);
  const provided = signatureHeader.replace(/^sha256=/i, '').trim();

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');

  if (
    expectedBuffer.length !== providedBuffer.length
    || !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new CmsWebhookValidationError(
      CmsWebhookValidationErrorCode.InvalidSignature,
      'Invalid webhook signature.',
    );
  }
};

export const parseCmsWebhookPayload = (value: unknown): CmsWebhookPayload => {
  if (!isPlainRecord(value)) {
    throw new CmsWebhookValidationError(
      CmsWebhookValidationErrorCode.InvalidPayload,
      'Webhook payload must be an object.',
    );
  }

  const { uid, locale, documentId, event } = value;

  if (typeof uid !== 'string' || !CMS_WEBHOOK_ALLOWED_UIDS.has(uid)) {
    throw new CmsWebhookValidationError(
      CmsWebhookValidationErrorCode.UnsupportedUid,
      'Webhook UID is not allowlisted.',
    );
  }

  if (typeof locale !== 'string' || !CMS_WEBHOOK_ALLOWED_LOCALES.has(locale)) {
    throw new CmsWebhookValidationError(
      CmsWebhookValidationErrorCode.InvalidLocale,
      'Webhook locale is invalid.',
    );
  }

  if (typeof documentId !== 'string' || documentId.trim().length === 0) {
    throw new CmsWebhookValidationError(
      CmsWebhookValidationErrorCode.InvalidPayload,
      'Webhook documentId is required.',
    );
  }

  if (event !== CmsWebhookEvent.Publish && event !== CmsWebhookEvent.Unpublish) {
    throw new CmsWebhookValidationError(
      CmsWebhookValidationErrorCode.InvalidPayload,
      'Webhook event must be entry.publish or entry.unpublish.',
    );
  }

  return {
    uid: uid as CmsWebhookPayload['uid'],
    locale,
    documentId: documentId.trim(),
    event,
  };
};

export const assertCmsWebhookBodySize = (rawBody: string): void => {
  if (Buffer.byteLength(rawBody, 'utf8') > CMS_WEBHOOK_MAX_BODY_BYTES) {
    throw new CmsWebhookValidationError(
      CmsWebhookValidationErrorCode.Oversized,
      'Webhook payload exceeds the maximum allowed size.',
    );
  }
};

export const buildCmsWebhookPayload = (
  uid: string,
  locale: string,
  documentId: string,
  event: CmsWebhookEvent,
): CmsWebhookPayload =>
  parseCmsWebhookPayload({
    uid,
    locale,
    documentId,
    event,
  });
