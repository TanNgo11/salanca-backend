/**
 * Best-effort guest receipt after a public reservation create.
 * Always on when SMTP is configured (EMAIL_SMTP_HOST) and the guest left an email.
 * Never throws; never logs the guest's address.
 */
import type { Core } from '@strapi/strapi';

import { formatNotifyErrorCode } from './form-lead-notify';
import { buildReservationConfirmationEmail } from './reservation-confirmation-email';
import { resolveIntentionalEmailSend } from './send-form-lead-notify';

export type ReservationConfirmationRequest = {
  documentId: string;
  email?: string;
  locale: 'vi' | 'en';
  fullName: string;
  phone: string;
  preferredDate: string;
  preferredTime: string;
  guestCount: number;
};

const GLOBAL_SETTING_UID = 'api::global-setting.global-setting' as const;
const FALLBACK_BRAND = 'Salanca';

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

async function loadRestaurantFacts(strapi: Core.Strapi, locale: 'vi' | 'en') {
  const row = (await strapi.documents(GLOBAL_SETTING_UID).findFirst({
    locale,
    status: 'published',
    fields: ['brandName', 'hotline', 'address'],
  })) as { brandName?: unknown; hotline?: unknown; address?: unknown } | null;

  return {
    brandName: text(row?.brandName) ?? FALLBACK_BRAND,
    hotline: text(row?.hotline),
    address: text(row?.address),
  };
}

export async function sendReservationConfirmation(
  strapi: Core.Strapi,
  request: ReservationConfirmationRequest,
): Promise<void> {
  try {
    if (!request.email) {
      return;
    }
    const send = resolveIntentionalEmailSend(strapi);
    if (!send) {
      return;
    }

    const restaurant = await loadRestaurantFacts(strapi, request.locale);
    const message = buildReservationConfirmationEmail({ ...request, restaurant });
    await send({ to: request.email, ...message });
    strapi.log.info('reservation confirmation sent', { documentId: request.documentId });
  } catch (error: unknown) {
    strapi.log.error('reservation confirmation failed', {
      documentId: request.documentId,
      code: formatNotifyErrorCode(error),
    });
  }
}

/** Fire-and-forget so SMTP latency never delays the public 201. */
export function scheduleReservationConfirmation(
  strapi: Core.Strapi,
  request: ReservationConfirmationRequest,
): void {
  void sendReservationConfirmation(strapi, request);
}
