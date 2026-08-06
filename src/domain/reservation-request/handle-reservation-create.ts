/**
 * Reservation intake handler, extracted from the controller so the 429
 * envelope, forced `status`, overlap echo, and error mapping are testable with
 * stubs instead of a booted Strapi.
 */

import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { resolveClientIp } from '../form-intake/client-ip';
import { FormValidationError } from '../form-intake/form-validation-error';
import type { FormErrorContext } from '../form-intake/write-application-error';
import { writeRateLimited } from '../form-intake/write-application-error';
import type { InMemoryRateLimit } from '../rate-limit/in-memory-rate-limit';
import { countSlotPeers } from './count-slot-peers';
import { getReservationRateLimit } from './reservation-rate-limit';
import {
  ReservationRequestValidationErrorCode,
  parseReservationRequestInput,
} from './reservation-request.validation';
import { resolveMenuSelection } from './resolve-menu-selection';

const { ApplicationError } = errors;

export const RESERVATION_REQUEST_UID = 'api::reservation-request.reservation-request' as const;

export type ReservationCreateContext = FormErrorContext & {
  request: { body?: { data?: unknown }; ip?: string };
  ip?: string;
};

export type HandleReservationCreateDeps = {
  rateLimit?: InMemoryRateLimit;
};

/**
 * Validate → rate limit → menu resolve → soft-overlap → create.
 *
 * Quota is consumed before menu resolution on purpose: a limiter that runs
 * after the database work does not protect the database. A request that then
 * fails menu validation does cost the caller a slot — the API contract says so.
 */
export const handleReservationCreate = async (
  strapi: Core.Strapi,
  ctx: ReservationCreateContext,
  deps: HandleReservationCreateDeps = {},
): Promise<void> => {
  let parsed;
  try {
    parsed = parseReservationRequestInput(ctx.request.body?.data);
  } catch (error) {
    if (error instanceof FormValidationError) {
      throw new ApplicationError(error.message, { code: error.code });
    }
    throw error;
  }

  // Rate limit only after successful parse so invalid/honeypot traffic does not burn quota.
  const limiter = deps.rateLimit ?? getReservationRateLimit();
  const clientIp = resolveClientIp(ctx);
  const rate = limiter.tryConsume(`reservation-request:${clientIp}`);
  if (!rate.allowed) {
    writeRateLimited(
      ctx,
      'Too many reservation requests. Please try again later.',
      ReservationRequestValidationErrorCode.RateLimited,
      rate.retryAfterMs,
    );
    return;
  }

  const [menuConnect, overlapCount] = await Promise.all([
    resolveMenuSelection(
      strapi,
      parsed.menuPackageIds,
      parsed.menuItemIds,
      parsed.sourceLocale,
    ),
    countSlotPeers(strapi, parsed.preferredDate, parsed.preferredTime),
  ]);

  const document = await strapi.documents(RESERVATION_REQUEST_UID).create({
    data: {
      fullName: parsed.fullName,
      phone: parsed.phone,
      ...(parsed.email ? { email: parsed.email } : {}),
      preferredDate: parsed.preferredDate,
      preferredTime: parsed.preferredTime,
      guestCount: parsed.guestCount,
      ...(parsed.occasion ? { occasion: parsed.occasion } : {}),
      ...(parsed.note ? { note: parsed.note } : {}),
      menuSelectionMode: parsed.menuSelectionMode,
      ...menuConnect,
      sourceLocale: parsed.sourceLocale,
      ...(parsed.sourcePath ? { sourcePath: parsed.sourcePath } : {}),
      status: 'new',
      overlapCount,
    },
    fields: ['documentId', 'status', 'overlapCount'],
  });

  const storedOverlap =
    typeof document.overlapCount === 'number' ? document.overlapCount : overlapCount;

  ctx.status = 201;
  ctx.body = {
    data: {
      documentId: document.documentId,
      status: document.status ?? 'new',
      overlapCount: storedOverlap,
      hasOverlap: storedOverlap > 0,
    },
  };
};
