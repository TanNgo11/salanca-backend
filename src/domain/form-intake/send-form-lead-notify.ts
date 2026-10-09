/**
 * Strapi-bound adapter: intentional SMTP + per-kind recipients
 * (Admin-saved settings, FORM_NOTIFY_TO fallback).
 * Controllers schedule this after a successful lead create (off the response path).
 */

import type { Core } from '@strapi/strapi';

import {
  formatNotifyErrorCode,
  isFormNotifySmtpConfigured,
  notifyFormLead,
  type FormLeadNotifyPayload,
} from './form-lead-notify';
import { resolveKindRecipients } from '../notification-settings/notification-settings';
import { readNotificationSettings } from '../notification-settings/notification-settings.store';

/** Nodemailer/Resend send options used by form lead notify. */
export type FormLeadPluginSendOptions = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

type FormLeadEmailPluginService = {
  send: (options: FormLeadPluginSendOptions) => Promise<unknown>;
  getProviderSettings?: () => { provider?: string };
};

/**
 * Resolve the email plugin send function only when SMTP was intentionally
 * configured (EMAIL_SMTP_HOST). Avoids Strapi's default sendmail provider.
 */
export function resolveIntentionalEmailSend(
  strapi: Core.Strapi,
): ((options: FormLeadPluginSendOptions) => Promise<unknown>) | null {
  if (!isFormNotifySmtpConfigured()) {
    return null;
  }

  try {
    const service = strapi.plugin('email')?.service('email') as
      | FormLeadEmailPluginService
      | undefined;
    if (!service || typeof service.send !== 'function') {
      return null;
    }

    const provider = service.getProviderSettings?.()?.provider;
    if (provider && provider !== 'nodemailer') {
      strapi.log.warn('form lead notify skipped: email provider is not nodemailer', {
        provider,
      });
      return null;
    }

    return service.send.bind(service);
  } catch {
    return null;
  }
}

/**
 * Best-effort staff email after public form create.
 * Recipients: the Admin-saved list for the lead's kind, or FORM_NOTIFY_TO when
 * the screen was never saved, predates this kind, or cannot be read.
 * No-ops without EMAIL_SMTP_HOST.
 * Never throws.
 */
export async function sendFormLeadNotify(
  strapi: Core.Strapi,
  payload: FormLeadNotifyPayload,
): Promise<void> {
  try {
    const log = {
      info: (message: string, meta?: Record<string, unknown>) =>
        strapi.log.info(message, meta),
      warn: (message: string, meta?: Record<string, unknown>) =>
        strapi.log.warn(message, meta),
      error: (message: string, meta?: Record<string, unknown>) =>
        strapi.log.error(message, meta),
    };

    if (!isFormNotifySmtpConfigured()) {
      if (process.env.FORM_NOTIFY_TO?.trim()) {
        strapi.log.warn(
          'form lead notify skipped: FORM_NOTIFY_TO set but EMAIL_SMTP_HOST unset',
          { kind: payload.kind, documentId: payload.documentId },
        );
      }
      return;
    }

    // A failed settings read must not cost the staff email: fall back to env.
    let stored: Awaited<ReturnType<typeof readNotificationSettings>> = null;
    try {
      stored = await readNotificationSettings(strapi);
    } catch (error: unknown) {
      strapi.log.warn('form lead notify: settings read failed, using FORM_NOTIFY_TO', {
        kind: payload.kind,
        documentId: payload.documentId,
        code: formatNotifyErrorCode(error),
      });
    }
    const recipients = resolveKindRecipients(stored, payload.kind, process.env, log);
    if (recipients.length === 0) {
      return;
    }

    const sendEmail = resolveIntentionalEmailSend(strapi);
    if (!sendEmail) {
      strapi.log.error('form lead notify skipped: email plugin unavailable', {
        kind: payload.kind,
        documentId: payload.documentId,
      });
      return;
    }

    await notifyFormLead({
      payload,
      recipients,
      log,
      send: async ({ to, subject, text, html }) => {
        await sendEmail({
          to: to.join(', '),
          subject,
          text,
          html,
        });
      },
    });
  } catch (error: unknown) {
    strapi.log.error('form lead notify unexpected failure', {
      kind: payload.kind,
      documentId: payload.documentId,
      code: formatNotifyErrorCode(error),
    });
  }
}

/**
 * Fire-and-forget wrapper so SMTP latency never blocks the public HTTP response.
 * sendFormLeadNotify never throws; this catch is belt-and-suspenders only.
 */
export function scheduleFormLeadNotify(
  strapi: Core.Strapi,
  payload: FormLeadNotifyPayload,
): void {
  void sendFormLeadNotify(strapi, payload).catch((error: unknown) => {
    strapi.log.error('form lead notify schedule failed', {
      kind: payload.kind,
      documentId: payload.documentId,
      code: formatNotifyErrorCode(error),
    });
  });
}
