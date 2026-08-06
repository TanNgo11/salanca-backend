import type { Core } from '@strapi/strapi';

import type { DocumentMiddlewareContext } from '../document-middleware/types';
import { buildCmsWebhookPayload, signCmsWebhookPayload } from './cms-webhook.helper';
import {
  CMS_WEBHOOK_ALLOWED_LOCALES,
  CMS_WEBHOOK_ALLOWED_UIDS,
  CmsWebhookEvent,
} from './cms-webhook.types';

/**
 * Strapi 5 `documents.publish` accepts `locale: '*'` (every locale), an array,
 * a single string, or nothing at all when the caller relies on the default
 * locale. Anything but the single-string case used to fall through to a
 * hardcoded `vi` or be dropped entirely, so publish-all revalidated nothing.
 *
 * `'*'` and an omitted locale both fan out to the full allowlist; an explicit
 * locale outside it is still warned about and skipped.
 */
export const resolveWebhookLocales = (
  strapi: Core.Strapi,
  uid: string,
  rawLocale: unknown,
): string[] => {
  const allowed = [...CMS_WEBHOOK_ALLOWED_LOCALES];

  if (rawLocale == null || rawLocale === '*') {
    return allowed;
  }

  const requested = Array.isArray(rawLocale) ? rawLocale : [rawLocale];
  const locales: string[] = [];

  for (const entry of requested) {
    if (typeof entry === 'string' && CMS_WEBHOOK_ALLOWED_LOCALES.has(entry)) {
      if (!locales.includes(entry)) {
        locales.push(entry);
      }
      continue;
    }

    strapi.log.warn(
      `CMS webhook skipped: unsupported locale "${String(entry)}" for ${uid}.`,
    );
  }

  return locales;
};

const resolveEvent = (action: string): CmsWebhookEvent | null => {
  if (action === 'publish') {
    return CmsWebhookEvent.Publish;
  }

  if (action === 'unpublish') {
    return CmsWebhookEvent.Unpublish;
  }

  return null;
};

const deliverWebhook = async (
  strapi: Core.Strapi,
  payload: ReturnType<typeof buildCmsWebhookPayload>,
): Promise<void> => {
  const webhookUrl = process.env.CMS_WEBHOOK_URL?.trim();
  const webhookSecret = process.env.CMS_WEBHOOK_SECRET?.trim();

  if (!webhookUrl || !webhookSecret) {
    return;
  }

  const rawBody = JSON.stringify(payload);
  const signature = signCmsWebhookPayload(rawBody, webhookSecret);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cms-signature': `sha256=${signature}`,
      },
      body: rawBody,
    });

    if (!response.ok) {
      strapi.log.warn(
        `CMS webhook delivery failed with status ${response.status} for ${payload.uid}/${payload.locale}.`,
      );
    }
  } catch (error) {
    strapi.log.warn(
      `CMS webhook delivery error for ${payload.uid}/${payload.locale}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
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

  const locales = resolveWebhookLocales(strapi, ctx.uid, ctx.params.locale);
  if (locales.length === 0) {
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

  for (const locale of locales) {
    void deliverWebhook(strapi, buildCmsWebhookPayload(ctx.uid, locale, documentId, event));
  }
};
