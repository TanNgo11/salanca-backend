import type { Core } from '@strapi/strapi';
import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { getContactRateLimit } from '../../../domain/contact-message/contact-rate-limit';
import {
  ContactMessageValidationErrorCode,
  parseContactMessageInput,
} from '../../../domain/contact-message/contact-message.validation';
import { resolveClientIp } from '../../../domain/form-intake/client-ip';
import { toContactLeadNotifyPayload } from '../../../domain/form-intake/form-lead-notify';
import { FormValidationError } from '../../../domain/form-intake/form-validation-error';
import { scheduleFormLeadNotify } from '../../../domain/form-intake/send-form-lead-notify';
import { assertEnvTurnstile } from '../../../domain/form-intake/turnstile';
import { writeApplicationError } from '../../../domain/form-intake/write-application-error';

const { ApplicationError } = errors;

const UID = 'api::contact-message.contact-message' as const;

export default factories.createCoreController(UID, ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Public contact form intake: validate, optional Turnstile, rate limit, force status new, return minimal payload.
   */
  async create(ctx) {
    const rawData = ctx.request.body?.data;
    const clientIp = resolveClientIp(ctx);
    let data;
    try {
      data = parseContactMessageInput(rawData);
      await assertEnvTurnstile({
        rawData,
        remoteip: clientIp,
        errorCode: ContactMessageValidationErrorCode.Turnstile,
      });
    } catch (error) {
      if (error instanceof FormValidationError) {
        throw new ApplicationError(error.message, { code: error.code });
      }
      throw error;
    }

    // Rate limit only after parse + Turnstile so invalid/bot traffic does not burn quota.
    const rate = getContactRateLimit().tryConsume(`contact-message:${clientIp}`);
    if (!rate.allowed) {
      writeApplicationError(
        ctx,
        429,
        'Too many contact messages. Please try again later.',
        ContactMessageValidationErrorCode.RateLimited,
        { retryAfterMs: rate.retryAfterMs },
        { 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000) || 1) },
      );
      return;
    }

    const document = await strapi.documents(UID).create({
      data,
      fields: ['documentId', 'status'],
    });

    ctx.status = 201;
    ctx.body = {
      data: {
        documentId: document.documentId,
        status: document.status ?? 'new',
      },
    };

    // Off critical path: SMTP must not delay the public 201.
    scheduleFormLeadNotify(
      strapi,
      toContactLeadNotifyPayload(document.documentId, data),
    );
  },
}));
