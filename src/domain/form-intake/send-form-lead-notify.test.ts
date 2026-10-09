import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendFormLeadNotify } from './send-form-lead-notify';
import { toContactLeadNotifyPayload } from './form-lead-notify';

const payload = toContactLeadNotifyPayload('abc123def456', {
  fullName: 'Jane',
  email: 'guest@example.com',
  message: 'Hello',
  sourceLocale: 'vi',
});

const buildStrapi = (storedValue: unknown, storeGet = vi.fn(async () => storedValue)) => {
  const send = vi.fn(async () => undefined);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    send,
    log,
    storeGet,
    strapi: {
      store: vi.fn(() => ({ get: storeGet, set: vi.fn() })),
      plugin: vi.fn(() => ({
        service: () => ({ send, getProviderSettings: () => ({ provider: 'nodemailer' }) }),
      })),
      log,
    } as never,
  };
};

describe('sendFormLeadNotify recipients', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses FORM_NOTIFY_TO when settings were never saved', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    vi.stubEnv('FORM_NOTIFY_TO', 'ops@salanca.vn');
    const { strapi, send } = buildStrapi(null);
    await sendFormLeadNotify(strapi, payload);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'ops@salanca.vn' }));
  });

  it('uses the saved list for the lead kind', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    vi.stubEnv('FORM_NOTIFY_TO', 'ops@salanca.vn');
    const { strapi, send } = buildStrapi({
      version: 1,
      recipients: {
        'reservation-request': ['booking@salanca.vn'],
        'contact-message': ['hello@salanca.vn', 'owner@salanca.vn'],
      },
    });
    await sendFormLeadNotify(strapi, payload);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'hello@salanca.vn, owner@salanca.vn' }),
    );
  });

  it('sends nothing for a saved empty list', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    vi.stubEnv('FORM_NOTIFY_TO', 'ops@salanca.vn');
    const { strapi, send } = buildStrapi({
      version: 1,
      recipients: { 'reservation-request': ['booking@salanca.vn'], 'contact-message': [] },
    });
    await sendFormLeadNotify(strapi, payload);
    expect(send).not.toHaveBeenCalled();
  });

  it('falls back to FORM_NOTIFY_TO when the settings read fails', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    vi.stubEnv('FORM_NOTIFY_TO', 'ops@salanca.vn');
    const failing = vi.fn(async () => {
      throw Object.assign(new Error('db down'), { code: 'ECONNREFUSED' });
    });
    const { strapi, send, log } = buildStrapi(null, failing);
    await expect(sendFormLeadNotify(strapi, payload)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'ops@salanca.vn' }));
    expect(log.warn).toHaveBeenCalledWith(
      'form lead notify: settings read failed, using FORM_NOTIFY_TO',
      expect.objectContaining({ kind: 'contact-message', code: 'Error:ECONNREFUSED' }),
    );
  });

  it('warns when FORM_NOTIFY_TO has no valid address and nothing was saved', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    vi.stubEnv('FORM_NOTIFY_TO', 'booking@salanca');
    const { strapi, send, log } = buildStrapi(null);
    await sendFormLeadNotify(strapi, payload);
    expect(send).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      'FORM_NOTIFY_TO is set but contains no valid email addresses',
      undefined,
    );
  });

  it('does not touch the store when SMTP is off', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', '');
    const { strapi, storeGet } = buildStrapi(null);
    await sendFormLeadNotify(strapi, payload);
    expect(storeGet).not.toHaveBeenCalled();
  });
});
