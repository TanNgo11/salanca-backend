import type { Core } from '@strapi/strapi';

import type { DocumentMiddlewareContext } from '../document-middleware/types';
import { buildCmsWebhookPayload, signCmsWebhookPayload } from './cms-webhook.helper';
import {
  CMS_WEBHOOK_ALLOWED_LOCALES,
  CMS_WEBHOOK_ALLOWED_UIDS,
  CMS_WEBHOOK_MEDIA_UID,
  CmsWebhookEvent,
} from './cms-webhook.types';

const resolveEvent = (action: string): CmsWebhookEvent | null => {
  if (action === 'publish') {
    return CmsWebhookEvent.Publish;
  }

  if (action === 'unpublish') {
    return CmsWebhookEvent.Unpublish;
  }

  return null;
};

/** Waits before attempts 2, 3 and 4; covers a web restart during deploy. */
export const CMS_WEBHOOK_RETRY_DELAYS_MS = [2_000, 10_000, 30_000] as const;
const CMS_WEBHOOK_TIMEOUT_MS = 10_000;

export interface CmsWebhookDeliveryDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Network errors, timeouts, 429 and 5xx are worth another try; any other 4xx
// (bad signature, bad payload) fails the same way every time.
const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

/**
 * Signed POST to the web's revalidate route. Retries transient failures so a
 * publish made while the web is restarting still reaches it. Never throws.
 */
export const deliverCmsWebhook = async (
  strapi: Core.Strapi,
  payload: ReturnType<typeof buildCmsWebhookPayload>,
  { fetchImpl = fetch, sleep = defaultSleep }: CmsWebhookDeliveryDeps = {},
): Promise<void> => {
  const webhookUrl = process.env.CMS_WEBHOOK_URL?.trim();
  const webhookSecret = process.env.CMS_WEBHOOK_SECRET?.trim();

  if (!webhookUrl || !webhookSecret) {
    return;
  }

  const rawBody = JSON.stringify(payload);
  const signature = signCmsWebhookPayload(rawBody, webhookSecret);
  const target = `${payload.uid}/${payload.locale}`;
  const attempts = CMS_WEBHOOK_RETRY_DELAYS_MS.length + 1;
  let lastFailure = 'unknown error';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cms-signature': `sha256=${signature}`,
        },
        body: rawBody,
        signal: AbortSignal.timeout(CMS_WEBHOOK_TIMEOUT_MS),
      });

      if (response.ok) {
        return;
      }
      if (!isRetryableStatus(response.status)) {
        strapi.log.error(
          `CMS webhook rejected with status ${response.status} for ${target}; not retrying.`,
        );
        return;
      }
      lastFailure = `status ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'unknown error';
    }

    if (attempt < attempts) {
      strapi.log.warn(
        `CMS webhook attempt ${attempt}/${attempts} failed for ${target}: ${lastFailure}. Retrying.`,
      );
      await sleep(CMS_WEBHOOK_RETRY_DELAYS_MS[attempt - 1]);
    }
  }

  strapi.log.error(`CMS webhook gave up after ${attempts} attempts for ${target}: ${lastFailure}.`);
};

/**
 * After-handler: signed publish/unpublish webhooks for Next.js revalidation.
 * No-op when CMS_WEBHOOK_URL or CMS_WEBHOOK_SECRET is unset.
 * Delivery is fire-and-forget so editor publish latency is not bound to HTTP.
 */
export const emitCmsWebhook = async (
  strapi: Core.Strapi,
  ctx: DocumentMiddlewareContext,
  result: unknown,
): Promise<void> => {
  const event = resolveEvent(ctx.action);

  if (!event || !CMS_WEBHOOK_ALLOWED_UIDS.has(ctx.uid)) {
    return;
  }

  const locale = ctx.params.locale ?? 'vi';
  if (!CMS_WEBHOOK_ALLOWED_LOCALES.has(locale)) {
    strapi.log.warn(
      `CMS webhook skipped: unsupported locale "${locale}" for ${ctx.uid}.`,
    );
    return;
  }

  const documentId =
    (result && typeof result === 'object' && 'documentId' in result
      ? String((result as { documentId?: string }).documentId ?? '')
      : '')
    || ctx.params.documentId
    || '';

  if (!documentId) {
    strapi.log.warn(
      `CMS webhook skipped: missing documentId for ${ctx.uid}/${ctx.action}.`,
    );
    return;
  }

  const payload = buildCmsWebhookPayload(ctx.uid, locale, documentId, event);
  void deliverCmsWebhook(strapi, payload);
};

/**
 * After a media file is stored under a fresh hash (see
 * src/extensions/upload/fresh-hash-replace.ts) the web must drop pages that
 * still embed the old URL. Media is not localized; the web revalidates both
 * locales for this event.
 */
export const emitMediaReplacedWebhook = (strapi: Core.Strapi, fileId: number | string): void => {
  const payload = buildCmsWebhookPayload(
    CMS_WEBHOOK_MEDIA_UID,
    'vi',
    String(fileId),
    CmsWebhookEvent.MediaReplace,
  );
  void deliverCmsWebhook(strapi, payload);
};
