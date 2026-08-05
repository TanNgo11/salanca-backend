import type { Core } from '@strapi/strapi';
import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { FormValidationError } from '../../../domain/form-intake/form-validation-error';
import { resolveClientIp } from '../../../domain/form-intake/client-ip';
import { countSlotPeers } from '../../../domain/reservation-request/count-slot-peers';
import { getReservationRateLimit } from '../../../domain/reservation-request/reservation-rate-limit';
import {
  ReservationRequestValidationErrorCode,
  parseReservationRequestInput,
} from '../../../domain/reservation-request/reservation-request.validation';
import { resolveMenuSelection } from '../../../domain/reservation-request/resolve-menu-selection';

const { ApplicationError } = errors;

const UID = 'api::reservation-request.reservation-request' as const;

/**
 * Strapi-shaped error body (same envelope as ApplicationError) with custom HTTP status.
 */
const writeApplicationError = (
  ctx: {
    status: number;
    set: (name: string, value: string) => void;
    body: unknown;
  },
  status: number,
  message: string,
  code: string,
  extraDetails: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): void => {
  for (const [name, value] of Object.entries(headers)) {
    ctx.set(name, value);
  }
  ctx.status = status;
  ctx.body = {
    data: null,
    error: {
      status,
      name: 'ApplicationError',
      message,
      details: { code, ...extraDetails },
    },
  };
};

export default factories.createCoreController(UID, ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Public reservation lead intake: validate → rate limit → menu resolve → soft-overlap → create.
   */
  async create(ctx) {
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
    const clientIp = resolveClientIp(ctx);
    const rate = getReservationRateLimit().tryConsume(`reservation-request:${clientIp}`);
    if (!rate.allowed) {
      writeApplicationError(
        ctx,
        429,
        'Too many reservation requests. Please try again later.',
        ReservationRequestValidationErrorCode.RateLimited,
        { retryAfterMs: rate.retryAfterMs },
        { 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000) || 1) },
      );
      return;
    }

    const [menuConnect, overlapCount] = await Promise.all([
      resolveMenuSelection(strapi, parsed.menuPackageIds, parsed.menuItemIds),
      countSlotPeers(strapi, parsed.preferredDate, parsed.preferredTime),
    ]);

    const document = await strapi.documents(UID).create({
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
  },
}));
