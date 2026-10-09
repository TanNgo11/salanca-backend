import { describe, expect, it } from 'vitest';

import {
  addRecipients,
  canSaveSettings,
  hasOverLimitFallback,
  initialDrafts,
  mergePendingRecipients,
  notificationTestPath,
  sameRecipients,
  splitRecipientInput,
} from './notification-settings.helper';

describe('notification settings helper', () => {
  it('splits typed or pasted text on spaces, new lines, commas and semicolons', () => {
    expect(splitRecipientInput(' a@salanca.vn,\n\nb@salanca.vn ; c@salanca.vn d@salanca.vn')).toEqual([
      'a@salanca.vn',
      'b@salanca.vn',
      'c@salanca.vn',
      'd@salanca.vn',
    ]);
  });

  it('adds valid addresses as lowercase chips and skips duplicates', () => {
    expect(addRecipients(['a@salanca.vn'], 'B@Salanca.vn, a@salanca.vn')).toEqual({
      list: ['a@salanca.vn', 'b@salanca.vn'],
      invalid: [],
    });
  });

  it('keeps invalid entries out of the list and returns them as typed', () => {
    expect(addRecipients([], 'ok@salanca.vn abc x@y')).toEqual({
      list: ['ok@salanca.vn'],
      invalid: ['abc', 'x@y'],
    });
  });

  it('compares lists in order', () => {
    expect(sameRecipients(['a@x.vn'], ['a@x.vn'])).toBe(true);
    expect(sameRecipients(['a@x.vn', 'b@x.vn'], ['b@x.vn', 'a@x.vn'])).toBe(false);
  });

  it('builds the test path per kind', () => {
    expect(notificationTestPath('contact-message')).toBe(
      '/notification-settings/test/contact-message',
    );
  });
});

const view = (saved: boolean, reservation: string[], contact: string[]) => ({
  saved,
  smtpConfigured: true,
  recipients: { 'reservation-request': reservation, 'contact-message': contact },
});
const many = (count: number) => Array.from({ length: count }, (_, i) => `s${i}@salanca.vn`);

describe('notification settings save rules', () => {
  it('trims an env fallback longer than the maximum and flags it', () => {
    const fallback = view(false, many(12), ['a@salanca.vn']);
    expect(initialDrafts(fallback)['reservation-request']).toEqual(many(10));
    expect(hasOverLimitFallback(fallback)).toBe(true);
    expect(hasOverLimitFallback(view(true, many(3), []))).toBe(false);
  });

  it('allows saving the env fallback as is', () => {
    const fallback = view(false, ['a@salanca.vn'], []);
    expect(canSaveSettings(fallback, initialDrafts(fallback), {})).toBe(true);
  });

  it('allows saving once saved only when a list or the typed text changed', () => {
    const saved = view(true, ['a@salanca.vn'], []);
    const drafts = initialDrafts(saved);
    expect(canSaveSettings(saved, drafts, {})).toBe(false);
    expect(canSaveSettings(saved, drafts, { 'contact-message': 'b@salanca.vn' })).toBe(true);
    expect(canSaveSettings(saved, drafts, { 'contact-message': '  ' })).toBe(false);
    expect(
      canSaveSettings(saved, { ...drafts, 'contact-message': ['b@salanca.vn'] }, {}),
    ).toBe(true);
    expect(canSaveSettings(null, drafts, {})).toBe(false);
  });

  it('turns typed text into chips before saving and reports bad entries per kind', () => {
    expect(
      mergePendingRecipients(
        { 'reservation-request': ['a@salanca.vn'], 'contact-message': [] },
        { 'reservation-request': 'b@salanca.vn', 'contact-message': 'oops' },
      ),
    ).toEqual({
      lists: { 'reservation-request': ['a@salanca.vn', 'b@salanca.vn'], 'contact-message': [] },
      invalid: { 'contact-message': ['oops'] },
    });
  });
});
