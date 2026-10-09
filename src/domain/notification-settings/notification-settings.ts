/**
 * Staff notification recipients per form kind, edited in Admin.
 * Adding a kind (e.g. `order`) = one entry in NOTIFICATION_KINDS + its label.
 */
import {
  parseFormNotifyRecipients,
  resolveFormNotifyRecipients,
  type FormLeadNotifyLog,
} from '../form-intake/form-lead-notify';
import { isValidEmailAddress } from '../../shared/email/email';

export const NOTIFICATION_KINDS = ['reservation-request', 'contact-message'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_KIND_LABELS_VI: Record<NotificationKind, string> = {
  'reservation-request': 'Đặt bàn',
  'contact-message': 'Liên hệ',
};

export const MAX_RECIPIENTS_PER_KIND = 10;

/**
 * A save always writes every kind. A stored row can still lack a kind that was
 * added to NOTIFICATION_KINDS after it was saved; that kind uses FORM_NOTIFY_TO.
 */
export type NotificationSettings = {
  version: 1;
  recipients: Partial<Record<NotificationKind, string[]>>;
};

export class NotificationSettingsError extends Error {
  constructor(readonly vietnameseMessage: string) {
    super(vietnameseMessage);
    this.name = 'NotificationSettingsError';
  }
}

export const isNotificationKind = (value: unknown): value is NotificationKind =>
  NOTIFICATION_KINDS.some((kind) => kind === value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseKindList = (kind: NotificationKind, raw: unknown): string[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
    throw new NotificationSettingsError('Danh sách email không hợp lệ.');
  }
  const seen = new Set<string>();
  for (const entry of raw as string[]) {
    const address = entry.trim().toLowerCase();
    if (!address) continue;
    if (!isValidEmailAddress(address)) {
      throw new NotificationSettingsError(
        `Email không hợp lệ: "${entry.trim()}" (${NOTIFICATION_KIND_LABELS_VI[kind]}).`,
      );
    }
    seen.add(address);
  }
  if (seen.size > MAX_RECIPIENTS_PER_KIND) {
    throw new NotificationSettingsError(
      `Tối đa ${MAX_RECIPIENTS_PER_KIND} email cho mục ${NOTIFICATION_KIND_LABELS_VI[kind]}.`,
    );
  }
  return [...seen];
};

/** Validates an Admin PUT body. Throws NotificationSettingsError with a Vietnamese message. */
export const parseNotificationSettingsInput = (body: unknown): NotificationSettings => {
  if (!isRecord(body) || !isRecord(body.recipients)) {
    throw new NotificationSettingsError('Dữ liệu cài đặt không hợp lệ.');
  }
  const input = body.recipients;
  const recipients = Object.fromEntries(
    NOTIFICATION_KINDS.map((kind) => [kind, parseKindList(kind, input[kind])]),
  ) as Record<NotificationKind, string[]>;
  return { version: 1, recipients };
};

/** Reads a stored value leniently: never throws, drops anything invalid. Null = never saved. */
export const normalizeStoredSettings = (value: unknown): NotificationSettings | null => {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.recipients)) return null;
  const stored = value.recipients;
  const recipients: NotificationSettings['recipients'] = {};
  for (const kind of NOTIFICATION_KINDS) {
    const list = stored[kind];
    if (Array.isArray(list)) {
      recipients[kind] = parseFormNotifyRecipients(
        list.filter((entry) => typeof entry === 'string').join(','),
      );
    }
  }
  return { version: 1, recipients };
};

/**
 * The saved list for the kind wins, even when empty (empty = no email).
 * Never saved, or saved before this kind existed: FORM_NOTIFY_TO, with a warn
 * when it is set but holds no valid address.
 */
export const resolveKindRecipients = (
  stored: NotificationSettings | null,
  kind: NotificationKind,
  env: NodeJS.ProcessEnv = process.env,
  log?: Pick<FormLeadNotifyLog, 'warn'>,
): string[] =>
  stored?.recipients[kind] ?? resolveFormNotifyRecipients(env.FORM_NOTIFY_TO, log);

export const buildTestNotificationEmail = (
  kind: NotificationKind,
): { subject: string; text: string; html: string } => {
  const label = NOTIFICATION_KIND_LABELS_VI[kind];
  const line = `Đây là email thử cho mục "${label}". Nếu bạn nhận được, email báo khách mới của mục này sẽ về hộp thư này.`;
  return {
    subject: `[Salanca] Email thử — ${label}`,
    text: `${line}\n`,
    html: `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}</p>`,
  };
};
