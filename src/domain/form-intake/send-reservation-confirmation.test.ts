import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendReservationConfirmation } from './send-reservation-confirmation';

const input = {
  documentId: 'abc123def456',
  email: 'guest@example.com',
  locale: 'en' as const,
  fullName: 'Jane',
  phone: '0901',
  preferredDate: '2030-06-15',
  preferredTime: '19:00',
  guestCount: 2,
};

const buildStrapi = (send = vi.fn(async () => undefined)) => {
  const findFirst = vi.fn(async () => ({
    brandName: 'Salanca Brazil',
    hotline: '0989 561 159',
    address: '49 Phan Boi Chau',
  }));
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    send,
    findFirst,
    log,
    strapi: {
      documents: vi.fn(() => ({ findFirst })),
      plugin: vi.fn(() => ({
        service: () => ({ send, getProviderSettings: () => ({ provider: 'nodemailer' }) }),
      })),
      log,
    } as never,
  };
};

describe('sendReservationConfirmation', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('does nothing when the guest left no email', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    const { strapi, send } = buildStrapi();
    await sendReservationConfirmation(strapi, { ...input, email: undefined });
    expect(send).not.toHaveBeenCalled();
  });

  it('does nothing when SMTP is not configured', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', '');
    const { strapi, send } = buildStrapi();
    await sendReservationConfirmation(strapi, input);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the English receipt with contact facts from the EN global setting', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    const { strapi, send, findFirst } = buildStrapi();
    await sendReservationConfirmation(strapi, input);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'en', status: 'published' }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'guest@example.com',
        subject: 'Salanca Brazil received your reservation request',
      }),
    );
  });

  it('logs a code and swallows SMTP failures', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    const failing = vi.fn(async () => {
      throw Object.assign(new Error('boom'), { code: 'ECONNRESET' });
    });
    const { strapi, log } = buildStrapi(failing);
    await expect(sendReservationConfirmation(strapi, input)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith('reservation confirmation failed', {
      documentId: 'abc123def456',
      code: 'Error:ECONNRESET',
    });
  });
});
