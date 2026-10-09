import { describe, expect, it, vi } from 'vitest';

import {
  buildTestNotificationEmail,
  isNotificationKind,
  MAX_RECIPIENTS_PER_KIND,
  NOTIFICATION_KINDS,
  NotificationSettingsError,
  normalizeStoredSettings,
  parseNotificationSettingsInput,
  resolveKindRecipients,
} from './notification-settings';

const saved = (reservation: string[], contact: string[]) => ({
  version: 1 as const,
  recipients: { 'reservation-request': reservation, 'contact-message': contact },
});

describe('notification kinds', () => {
  it('lists reservation and contact', () => {
    expect(NOTIFICATION_KINDS).toEqual(['reservation-request', 'contact-message']);
    expect(isNotificationKind('contact-message')).toBe(true);
    expect(isNotificationKind('order')).toBe(false);
  });
});

describe('parseNotificationSettingsInput', () => {
  it('lowercases, trims and dedupes each list', () => {
    const result = parseNotificationSettingsInput({
      recipients: {
        'reservation-request': [' Booking@Salanca.vn ', 'booking@salanca.vn', 'chef@salanca.vn'],
        'contact-message': [],
      },
    });
    expect(result).toEqual(saved(['booking@salanca.vn', 'chef@salanca.vn'], []));
  });

  it('treats a missing kind as an empty list', () => {
    expect(parseNotificationSettingsInput({ recipients: {} })).toEqual(saved([], []));
  });

  it('rejects an invalid address and names it', () => {
    expect(() =>
      parseNotificationSettingsInput({
        recipients: { 'reservation-request': ['booking@salanca'], 'contact-message': [] },
      }),
    ).toThrowError(
      expect.objectContaining({
        vietnameseMessage: 'Email không hợp lệ: "booking@salanca" (Đặt bàn).',
      }),
    );
  });

  it('rejects more than the maximum recipients', () => {
    const many = Array.from({ length: MAX_RECIPIENTS_PER_KIND + 1 }, (_, i) => `s${i}@salanca.vn`);
    expect(() =>
      parseNotificationSettingsInput({
        recipients: { 'reservation-request': [], 'contact-message': many },
      }),
    ).toThrowError(
      expect.objectContaining({ vietnameseMessage: 'Tối đa 10 email cho mục Liên hệ.' }),
    );
  });

  it('rejects a non-object body and non-string entries', () => {
    expect(() => parseNotificationSettingsInput(null)).toThrow(NotificationSettingsError);
    expect(() =>
      parseNotificationSettingsInput({ recipients: { 'reservation-request': [42] } }),
    ).toThrow(NotificationSettingsError);
  });
});

describe('normalizeStoredSettings', () => {
  it('returns null when nothing was saved', () => {
    expect(normalizeStoredSettings(null)).toBeNull();
    expect(normalizeStoredSettings(undefined)).toBeNull();
    expect(normalizeStoredSettings({ version: 2 })).toBeNull();
  });

  it('keeps valid addresses and drops garbage from a hand-edited row', () => {
    expect(
      normalizeStoredSettings({
        version: 1,
        recipients: { 'reservation-request': ['a@salanca.vn', 'bad'], 'contact-message': [] },
      }),
    ).toEqual(saved(['a@salanca.vn'], []));
  });

  it('leaves a kind out when the saved row has no list for it', () => {
    expect(
      normalizeStoredSettings({
        version: 1,
        recipients: { 'reservation-request': ['a@salanca.vn'], 'contact-message': 'x' },
      }),
    ).toEqual({ version: 1, recipients: { 'reservation-request': ['a@salanca.vn'] } });
  });
});

describe('resolveKindRecipients', () => {
  const env = { FORM_NOTIFY_TO: 'ops@salanca.vn, owner@salanca.vn' } as NodeJS.ProcessEnv;

  it('falls back to FORM_NOTIFY_TO when nothing was saved', () => {
    expect(resolveKindRecipients(null, 'contact-message', env)).toEqual([
      'ops@salanca.vn',
      'owner@salanca.vn',
    ]);
  });

  it('uses the saved list for that kind once saved', () => {
    const stored = saved(['booking@salanca.vn'], ['hello@salanca.vn']);
    expect(resolveKindRecipients(stored, 'reservation-request', env)).toEqual([
      'booking@salanca.vn',
    ]);
    expect(resolveKindRecipients(stored, 'contact-message', env)).toEqual(['hello@salanca.vn']);
  });

  it('falls back to FORM_NOTIFY_TO for a kind added after the last save', () => {
    const stored = { version: 1 as const, recipients: { 'reservation-request': ['b@salanca.vn'] } };
    expect(resolveKindRecipients(stored, 'contact-message', env)).toEqual([
      'ops@salanca.vn',
      'owner@salanca.vn',
    ]);
  });

  it('warns when FORM_NOTIFY_TO is set but has no valid address', () => {
    const warn = vi.fn();
    expect(
      resolveKindRecipients(null, 'contact-message', { FORM_NOTIFY_TO: 'booking@salanca' }, { warn }),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledWith('FORM_NOTIFY_TO is set but contains no valid email addresses');
  });

  it('sends nothing for a saved empty list, even with FORM_NOTIFY_TO set', () => {
    expect(resolveKindRecipients(saved([], ['x@salanca.vn']), 'reservation-request', env)).toEqual(
      [],
    );
  });
});

describe('buildTestNotificationEmail', () => {
  it('names the kind in subject and body', () => {
    const message = buildTestNotificationEmail('reservation-request');
    expect(message.subject).toBe('[Salanca] Email thử — Đặt bàn');
    expect(message.text).toContain('Đặt bàn');
    expect(message.html).toContain('Đặt bàn');
  });
});
