/**
 * Reason codes a `skipped` delivery row can carry, with their VI/EN labels. The codes are exported
 * as `SKIP_REASON` so `notification.ts` (and the other senders) reference one source instead of
 * repeating string literals that the screen could then fail to label.
 */
export const SKIP_REASON = {
  emailDisabled: 'email-disabled',
  providerNotConfigured: 'provider-not-configured',
  znsTemplateMissing: 'zns-template-missing',
  dailyLimit: 'daily-limit',
  notAllowlisted: 'not-allowlisted',
} as const;

export const SKIP_REASONS: Record<string, [vi: string, en: string]> = {
  [SKIP_REASON.emailDisabled]: [
    'Email chưa bật (chưa cấu hình SMTP)',
    'Email is off (SMTP not configured)',
  ],
  [SKIP_REASON.providerNotConfigured]: [
    'Kênh chưa được cấu hình',
    'Channel is not configured',
  ],
  [SKIP_REASON.znsTemplateMissing]: [
    'Thiếu mẫu Zalo ZNS cho thông báo này',
    'No Zalo ZNS template set for this message',
  ],
  [SKIP_REASON.dailyLimit]: [
    'Hết hạn mức gửi trong ngày',
    'Daily send limit reached',
  ],
  [SKIP_REASON.notAllowlisted]: [
    'Chế độ thử: người nhận không nằm trong danh sách cho phép',
    'Test mode: recipient is not on the allowlist',
  ],
};

/** VI/EN label for a skip-reason code; an unknown or empty code has no label. */
export const skipReasonLabel = (code: string | null | undefined, locale?: string): string | null => {
  const entry = code ? SKIP_REASONS[code] : undefined;
  if (!entry) return null;
  return locale?.toLowerCase().startsWith('en') ? entry[1] : entry[0];
};
