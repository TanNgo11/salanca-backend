/**
 * Contact intake handler, extracted from the controller so the 429 envelope,
 * forced `status`, and error mapping are testable with stubs instead of a
 * booted Strapi.
 */

import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { resolveClientIp } from '../form-intake/client-ip';
import { FormValidationError } from '../form-intake/form-validation-error';
import type { FormErrorContext } from '../form-intake/write-application-error';
import { writeRateLimited } from '../form-intake/write-application-error';
import type { InMemoryRateLimit } from '../rate-limit/in-memory-rate-limit';
import { getContactRateLimit } from './contact-rate-limit';
import {
  ContactMessageValidationErrorCode,
  parseContactMessageInput,
} from './contact-message.validation';

const { ApplicationError } = errors;

export const CONTACT_MESSAGE_UID = 'api::contact-message.contact-message' as const;

export type ContactCreateContext = FormErrorContext & {
  request: { body?: { data?: unknown }; ip?: string };
  ip?: string;
};

export type HandleContactCreateDeps = {
  rateLimit?: InMemoryRateLimit;
};

/**
 * Validate → rate limit → create. Rate limiting runs after parse so malformed
 * and honeypot traffic does not burn a legitimate visitor's quota.
 */
export const handleContactCreate = async (
  strapi: Core.Strapi,
  ctx: ContactCreateContext,
  deps: HandleContactCreateDeps = {},
): Promise<void> => {
  let data;
  try {
    data = parseContactMessageInput(ctx.request.body?.data);
  } catch (error) {
    if (error instanceof FormValidationError) {
      throw new ApplicationError(error.message, { code: error.code });
    }
    throw error;
  }

  const limiter = deps.rateLimit ?? getContactRateLimit();
  const clientIp = resolveClientIp(ctx);
  const rate = limiter.tryConsume(`contact-message:${clientIp}`);
  if (!rate.allowed) {
    writeRateLimited(
      ctx,
      'Too many contact messages. Please try again later.',
      ContactMessageValidationErrorCode.RateLimited,
      rate.retryAfterMs,
    );
    return;
  }

  const document = await strapi.documents(CONTACT_MESSAGE_UID).create({
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
};
