import type { Core } from '@strapi/strapi';

import { writeAdminAuditForCurrentRequest } from '../../domain/audit/admin-audit-request';
import { AuditAction, AuditTargetType } from '../../domain/audit/audit-event.types';
import {
  formatNotifyErrorCode,
  isFormNotifySmtpConfigured,
} from '../../domain/form-intake/form-lead-notify';
import { resolveIntentionalEmailSend } from '../../domain/form-intake/send-form-lead-notify';
import {
  buildTestNotificationEmail,
  isNotificationKind,
  NOTIFICATION_KIND_LABELS_VI,
  NOTIFICATION_KINDS,
  NotificationSettingsError,
  parseNotificationSettingsInput,
  resolveKindRecipients,
  type NotificationKind,
  type NotificationSettings,
} from '../../domain/notification-settings/notification-settings';
import {
  readNotificationSettings,
  writeNotificationSettings,
} from '../../domain/notification-settings/notification-settings.store';
import { NOTIFICATION_TEST_COOLDOWN_MS } from './notification-settings.types';

interface NotificationSettingsContext {
  params?: { kind?: unknown };
  request?: { body?: unknown };
  body: unknown;
  badRequest: (message: string) => void;
  internalServerError: (message: string) => void;
}

const UNEXPECTED = 'Không thể xử lý cài đặt email lúc này. Vui lòng thử lại sau.';

const view = (stored: NotificationSettings | null) => ({
  recipients: Object.fromEntries(
    NOTIFICATION_KINDS.map((kind) => [kind, resolveKindRecipients(stored, kind)]),
  ) as Record<NotificationKind, string[]>,
  saved: stored !== null,
  smtpConfigured: isFormNotifySmtpConfigured(),
});

export const createNotificationSettingsController = (strapi: Core.Strapi) => {
  const lastTestAt = new Map<NotificationKind, number>();

  const fail = (context: NotificationSettingsContext, error: unknown): void => {
    if (error instanceof NotificationSettingsError) {
      context.badRequest(error.vietnameseMessage);
      return;
    }
    strapi.log.error('Notification settings request failed.', {
      code: formatNotifyErrorCode(error),
    });
    context.internalServerError(UNEXPECTED);
  };

  return {
    async find(context: NotificationSettingsContext): Promise<void> {
      try {
        context.body = { data: view(await readNotificationSettings(strapi)) };
      } catch (error) {
        fail(context, error);
      }
    },

    async update(context: NotificationSettingsContext): Promise<void> {
      try {
        const settings = parseNotificationSettingsInput(context.request?.body);
        await writeNotificationSettings(strapi, settings);
        writeAdminAuditForCurrentRequest(strapi, {
          action: AuditAction.NotificationSettingsUpdate,
          eventName: 'notification-settings.update',
          targetLabel: 'Email thông báo',
          targetType: AuditTargetType.Setting,
        });
        context.body = { data: view(settings) };
      } catch (error) {
        fail(context, error);
      }
    },

    async sendTest(context: NotificationSettingsContext): Promise<void> {
      try {
        const kind = context.params?.kind;
        if (!isNotificationKind(kind)) {
          throw new NotificationSettingsError('Loại thông báo không hợp lệ.');
        }
        const send = resolveIntentionalEmailSend(strapi);
        if (!send) {
          throw new NotificationSettingsError(
            'Máy chủ email chưa được cấu hình (EMAIL_SMTP_HOST). Liên hệ kỹ thuật.',
          );
        }
        const recipients = resolveKindRecipients(await readNotificationSettings(strapi), kind);
        if (recipients.length === 0) {
          throw new NotificationSettingsError(
            `Mục ${NOTIFICATION_KIND_LABELS_VI[kind]} chưa có email nào. Lưu danh sách trước khi gửi thử.`,
          );
        }
        const now = Date.now();
        if (now - (lastTestAt.get(kind) ?? -Infinity) < NOTIFICATION_TEST_COOLDOWN_MS) {
          throw new NotificationSettingsError('Vừa gửi thử. Vui lòng đợi 30 giây.');
        }
        lastTestAt.set(kind, now);
        try {
          await send({ to: recipients.join(', '), ...buildTestNotificationEmail(kind) });
        } catch (error) {
          // Nothing went out, so the cooldown must not block a retry.
          lastTestAt.delete(kind);
          const code = formatNotifyErrorCode(error);
          strapi.log.error('notification test email failed', { kind, code });
          throw new NotificationSettingsError(
            `Gửi thử thất bại (${code}). Kiểm tra cấu hình email máy chủ.`,
          );
        }
        strapi.log.info('notification test email sent', {
          kind,
          recipientCount: recipients.length,
        });
        context.body = { data: { sent: true, recipientCount: recipients.length } };
      } catch (error) {
        fail(context, error);
      }
    },
  };
};
