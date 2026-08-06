/**
 * Staff notification emails for public form leads (contact + reservation).
 *
 * Opt-in: requires EMAIL_SMTP_HOST (email plugin) and FORM_NOTIFY_TO.
 * Delivery failures are absorbed after the lead is stored — never fail the
 * public create response because mail is down (BDS password-reset pattern).
 */

import { isValidEmailAddress } from '../../shared/email/email';

export type ContactLeadNotifyPayload = {
  kind: 'contact-message';
  documentId: string;
  fullName: string;
  email?: string;
  phone?: string;
  topic?: string;
  message: string;
  sourceLocale: string;
  sourcePath?: string;
};

export type ReservationLeadNotifyPayload = {
  kind: 'reservation-request';
  documentId: string;
  fullName: string;
  phone: string;
  email?: string;
  preferredDate: string;
  preferredTime: string;
  guestCount: number;
  occasion?: string;
  note?: string;
  menuSelectionMode: string;
  sourceLocale: string;
  sourcePath?: string;
  overlapCount: number;
};

export type FormLeadNotifyPayload =
  | ContactLeadNotifyPayload
  | ReservationLeadNotifyPayload;

export type FormLeadEmailMessage = {
  subject: string;
  text: string;
  html: string;
};

/** Minimal logger surface used by notify (Strapi log). */
export type FormLeadNotifyLog = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

export type FormLeadEmailSender = (input: {
  to: string[];
  subject: string;
  text: string;
  html: string;
}) => Promise<void>;

type EmailField = {
  label: string;
  value?: string | number;
};

/** Stable error code for logs (never includes recipients or SMTP bodies). */
export function formatNotifyErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return `Error:${String((error as { code?: unknown }).code ?? 'unknown')}`;
  }
  return 'Error:unknown';
}

/**
 * True when SMTP transport was intentionally configured (not Strapi sendmail default).
 */
export function isFormNotifySmtpConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.EMAIL_SMTP_HOST?.trim());
}

/**
 * Parses FORM_NOTIFY_TO (comma/semicolon separated). Invalid entries are dropped.
 */
export function parseFormNotifyRecipients(
  raw: string | undefined | null,
): string[] {
  if (!raw?.trim()) {
    return [];
  }

  const seen = new Set<string>();
  const recipients: string[] = [];

  for (const part of raw.split(/[,;]/)) {
    const address = part.trim().toLowerCase();
    if (!address || seen.has(address)) {
      continue;
    }
    if (!isValidEmailAddress(address)) {
      continue;
    }
    seen.add(address);
    recipients.push(address);
  }

  return recipients;
}

/**
 * Like parseFormNotifyRecipients, but warns when raw env is non-empty and
 * every entry was invalid (silent drop footgun).
 */
export function resolveFormNotifyRecipients(
  raw: string | undefined | null,
  log?: Pick<FormLeadNotifyLog, 'warn'>,
): string[] {
  const recipients = parseFormNotifyRecipients(raw);
  if (raw?.trim() && recipients.length === 0) {
    log?.warn?.('FORM_NOTIFY_TO is set but contains no valid email addresses');
  }
  return recipients;
}

export function resolveFormNotifyRecipientsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  log?: Pick<FormLeadNotifyLog, 'warn'>,
): string[] {
  return resolveFormNotifyRecipients(env.FORM_NOTIFY_TO, log);
}

/** Strip CR/LF/NUL and collapse whitespace for safe email subject fragments. */
export function sanitizeSubjectFragment(value: string): string {
  return value
    .replace(/[\r\n\0]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const renderLeadEmail = (input: {
  subject: string;
  title: string;
  kindLabel: string;
  fields: EmailField[];
  bodyLabel?: string;
  body?: string;
}): FormLeadEmailMessage => {
  const textLines = [
    `${input.title} (${input.kindLabel})`,
    ...input.fields
      .filter((field) => field.value !== undefined && field.value !== '')
      .map((field) => `${field.label}: ${field.value}`),
  ];
  if (input.body) {
    textLines.push('', `${input.bodyLabel ?? 'Nội dung'}:`, input.body);
  }

  const rows = input.fields
    .filter((field) => field.value !== undefined && field.value !== '')
    .map(
      (field) =>
        `<tr><th align="left">${escapeHtml(field.label)}</th>` +
        `<td>${escapeHtml(String(field.value))}</td></tr>`,
    )
    .join('');

  const bodyHtml = input.body
    ? `<p><strong>${escapeHtml(input.bodyLabel ?? 'Nội dung')}</strong></p>` +
      `<pre style="white-space:pre-wrap">${escapeHtml(input.body)}</pre>`
    : '';

  return {
    subject: input.subject,
    text: `${textLines.join('\n')}\n`,
    html:
      `<p><strong>${escapeHtml(input.title)}</strong> ` +
      `(<code>${escapeHtml(input.kindLabel)}</code>)</p>` +
      `<table>${rows}</table>${bodyHtml}`,
  };
};

export function toContactLeadNotifyPayload(
  documentId: string,
  data: {
    fullName: string;
    email?: string;
    phone?: string;
    topic?: string;
    message: string;
    sourceLocale: string;
    sourcePath?: string;
  },
): ContactLeadNotifyPayload {
  return {
    kind: 'contact-message',
    documentId,
    fullName: data.fullName,
    ...(data.email ? { email: data.email } : {}),
    ...(data.phone ? { phone: data.phone } : {}),
    ...(data.topic ? { topic: data.topic } : {}),
    message: data.message,
    sourceLocale: data.sourceLocale,
    ...(data.sourcePath ? { sourcePath: data.sourcePath } : {}),
  };
}

export function toReservationLeadNotifyPayload(
  documentId: string,
  data: {
    fullName: string;
    phone: string;
    email?: string;
    preferredDate: string;
    preferredTime: string;
    guestCount: number;
    occasion?: string;
    note?: string;
    menuSelectionMode: string;
    sourceLocale: string;
    sourcePath?: string;
    overlapCount: number;
  },
): ReservationLeadNotifyPayload {
  return {
    kind: 'reservation-request',
    documentId,
    fullName: data.fullName,
    phone: data.phone,
    ...(data.email ? { email: data.email } : {}),
    preferredDate: data.preferredDate,
    preferredTime: data.preferredTime,
    guestCount: data.guestCount,
    ...(data.occasion ? { occasion: data.occasion } : {}),
    ...(data.note ? { note: data.note } : {}),
    menuSelectionMode: data.menuSelectionMode,
    sourceLocale: data.sourceLocale,
    ...(data.sourcePath ? { sourcePath: data.sourcePath } : {}),
    overlapCount: data.overlapCount,
  };
}

export function buildContactLeadEmail(
  payload: ContactLeadNotifyPayload,
): FormLeadEmailMessage {
  const name = sanitizeSubjectFragment(payload.fullName) || 'guest';
  return renderLeadEmail({
    subject: `[Salanca] Liên hệ mới — ${name}`,
    title: 'Lead liên hệ mới',
    kindLabel: 'contact-message',
    fields: [
      { label: 'documentId', value: payload.documentId },
      { label: 'Họ tên', value: payload.fullName },
      { label: 'Email', value: payload.email },
      { label: 'Điện thoại', value: payload.phone },
      { label: 'Chủ đề', value: payload.topic },
      { label: 'Locale', value: payload.sourceLocale },
      { label: 'Path', value: payload.sourcePath },
    ],
    bodyLabel: 'Nội dung',
    body: payload.message,
  });
}

export function buildReservationLeadEmail(
  payload: ReservationLeadNotifyPayload,
): FormLeadEmailMessage {
  const name = sanitizeSubjectFragment(payload.fullName) || 'guest';
  const overlapNote =
    payload.overlapCount > 0
      ? sanitizeSubjectFragment(` (cảnh báo overlap: ${payload.overlapCount})`)
      : '';

  return renderLeadEmail({
    subject: `[Salanca] Đặt bàn mới — ${name}${overlapNote}`,
    title: 'Lead đặt bàn mới',
    kindLabel: 'reservation-request',
    fields: [
      { label: 'documentId', value: payload.documentId },
      { label: 'Họ tên', value: payload.fullName },
      { label: 'Điện thoại', value: payload.phone },
      { label: 'Email', value: payload.email },
      { label: 'Ngày', value: payload.preferredDate },
      { label: 'Giờ', value: payload.preferredTime },
      { label: 'Số khách', value: payload.guestCount },
      { label: 'Dịp', value: payload.occasion },
      { label: 'Menu mode', value: payload.menuSelectionMode },
      { label: 'Overlap count', value: payload.overlapCount },
      { label: 'Locale', value: payload.sourceLocale },
      { label: 'Path', value: payload.sourcePath },
    ],
    bodyLabel: 'Ghi chú',
    body: payload.note,
  });
}

export function buildFormLeadEmail(
  payload: FormLeadNotifyPayload,
): FormLeadEmailMessage {
  return payload.kind === 'contact-message'
    ? buildContactLeadEmail(payload)
    : buildReservationLeadEmail(payload);
}

/**
 * Sends staff notify if recipients exist. Never throws to callers.
 */
export async function notifyFormLead(options: {
  payload: FormLeadNotifyPayload;
  recipients: string[];
  send: FormLeadEmailSender;
  log: FormLeadNotifyLog;
}): Promise<{ sent: boolean }> {
  if (options.recipients.length === 0) {
    return { sent: false };
  }

  const message = buildFormLeadEmail(options.payload);

  try {
    await options.send({
      to: options.recipients,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    options.log.info('form lead notify sent', {
      kind: options.payload.kind,
      documentId: options.payload.documentId,
      recipientCount: options.recipients.length,
    });
    return { sent: true };
  } catch (error) {
    // Do not log recipient addresses or SMTP response bodies (may echo emails).
    options.log.error('form lead notify failed', {
      kind: options.payload.kind,
      documentId: options.payload.documentId,
      code: formatNotifyErrorCode(error),
    });
    return { sent: false };
  }
}
