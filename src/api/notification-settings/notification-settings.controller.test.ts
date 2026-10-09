import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../domain/audit/admin-audit-request', () => ({
  writeAdminAuditForCurrentRequest: vi.fn(),
}));

import { writeAdminAuditForCurrentRequest } from '../../domain/audit/admin-audit-request';
import { createNotificationSettingsController } from './notification-settings.controller';

const buildContext = (input: { params?: Record<string, unknown>; body?: unknown } = {}) => ({
  params: input.params ?? {},
  request: { body: input.body },
  body: undefined as unknown,
  badRequest: vi.fn(),
  internalServerError: vi.fn(),
});

const buildStrapi = (storedValue: unknown = null) => {
  let value = storedValue;
  const send = vi.fn(async () => undefined);
  const set = vi.fn(async ({ value: next }: { value: unknown }) => {
    value = next;
  });
  return {
    send,
    set,
    strapi: {
      store: vi.fn(() => ({ get: vi.fn(async () => value), set })),
      plugin: vi.fn(() => ({
        service: () => ({ send, getProviderSettings: () => ({ provider: 'nodemailer' }) }),
      })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as never,
  };
};

const savedValue = {
  version: 1,
  recipients: { 'reservation-request': ['booking@salanca.vn'], 'contact-message': [] },
};

describe('notification settings controller', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.mocked(writeAdminAuditForCurrentRequest).mockClear();
  });

  it('shows the env fallback before the first save', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    vi.stubEnv('FORM_NOTIFY_TO', 'ops@salanca.vn');
    const context = buildContext();
    await createNotificationSettingsController(buildStrapi().strapi).find(context as never);
    expect(context.body).toEqual({
      data: {
        recipients: { 'reservation-request': ['ops@salanca.vn'], 'contact-message': ['ops@salanca.vn'] },
        saved: false,
        smtpConfigured: true,
      },
    });
  });

  it('saves a valid body and writes one audit row', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', '');
    const { strapi, set } = buildStrapi();
    const context = buildContext({
      body: { recipients: { 'reservation-request': ['Booking@Salanca.vn'], 'contact-message': [] } },
    });
    await createNotificationSettingsController(strapi).update(context as never);
    expect(set).toHaveBeenCalledWith({ value: savedValue });
    expect(context.body).toEqual({
      data: { recipients: savedValue.recipients, saved: true, smtpConfigured: false },
    });
    expect(writeAdminAuditForCurrentRequest).toHaveBeenCalledTimes(1);
    expect(writeAdminAuditForCurrentRequest).toHaveBeenCalledWith(
      strapi,
      expect.objectContaining({
        action: 'notification_settings_update',
        targetType: 'setting',
        targetLabel: 'Email thông báo',
      }),
    );
  });

  it('rejects an invalid address without saving', async () => {
    const { strapi, set } = buildStrapi();
    const context = buildContext({
      body: { recipients: { 'reservation-request': ['nope'], 'contact-message': [] } },
    });
    await createNotificationSettingsController(strapi).update(context as never);
    expect(context.badRequest).toHaveBeenCalledWith('Email không hợp lệ: "nope" (Đặt bàn).');
    expect(set).not.toHaveBeenCalled();
    expect(writeAdminAuditForCurrentRequest).not.toHaveBeenCalled();
  });

  it('sends a test email to the saved list', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    const { strapi, send } = buildStrapi(savedValue);
    const context = buildContext({ params: { kind: 'reservation-request' } });
    await createNotificationSettingsController(strapi).sendTest(context as never);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'booking@salanca.vn', subject: '[Salanca] Email thử — Đặt bàn' }),
    );
    expect(context.body).toEqual({ data: { sent: true, recipientCount: 1 } });
  });

  it('refuses a test for an empty list, an unknown kind or SMTP off', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    const controller = createNotificationSettingsController(buildStrapi(savedValue).strapi);

    const empty = buildContext({ params: { kind: 'contact-message' } });
    await controller.sendTest(empty as never);
    expect(empty.badRequest).toHaveBeenCalledWith(
      'Mục Liên hệ chưa có email nào. Lưu danh sách trước khi gửi thử.',
    );

    const unknown = buildContext({ params: { kind: 'order' } });
    await controller.sendTest(unknown as never);
    expect(unknown.badRequest).toHaveBeenCalledWith('Loại thông báo không hợp lệ.');

    vi.stubEnv('EMAIL_SMTP_HOST', '');
    const off = buildContext({ params: { kind: 'reservation-request' } });
    await controller.sendTest(off as never);
    expect(off.badRequest).toHaveBeenCalledWith(
      'Máy chủ email chưa được cấu hình (EMAIL_SMTP_HOST). Liên hệ kỹ thuật.',
    );
  });

  it('enforces the 30 s cooldown per kind', async () => {
    vi.useFakeTimers();
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    const { strapi, send } = buildStrapi(savedValue);
    const controller = createNotificationSettingsController(strapi);

    await controller.sendTest(buildContext({ params: { kind: 'reservation-request' } }) as never);
    const second = buildContext({ params: { kind: 'reservation-request' } });
    await controller.sendTest(second as never);
    expect(second.badRequest).toHaveBeenCalledWith('Vừa gửi thử. Vui lòng đợi 30 giây.');

    vi.advanceTimersByTime(30_000);
    await controller.sendTest(buildContext({ params: { kind: 'reservation-request' } }) as never);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reports an SMTP failure without leaking addresses', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    const { strapi, send } = buildStrapi(savedValue);
    send.mockRejectedValueOnce(Object.assign(new Error('535 auth'), { code: 'EAUTH' }));
    const context = buildContext({ params: { kind: 'reservation-request' } });
    await createNotificationSettingsController(strapi).sendTest(context as never);
    expect(context.badRequest).toHaveBeenCalledWith(
      'Gửi thử thất bại (Error:EAUTH). Kiểm tra cấu hình email máy chủ.',
    );
  });

  it('lets the admin retry right after a failed send', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    const { strapi, send } = buildStrapi(savedValue);
    send.mockRejectedValueOnce(Object.assign(new Error('535 auth'), { code: 'EAUTH' }));
    const controller = createNotificationSettingsController(strapi);

    await controller.sendTest(buildContext({ params: { kind: 'reservation-request' } }) as never);
    const retry = buildContext({ params: { kind: 'reservation-request' } });
    await controller.sendTest(retry as never);

    expect(retry.badRequest).not.toHaveBeenCalled();
    expect(retry.body).toEqual({ data: { sent: true, recipientCount: 1 } });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
