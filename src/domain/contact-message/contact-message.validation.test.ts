import { describe, expect, it } from 'vitest';

import {
  CONTACT_MESSAGE_LIMITS,
  ContactMessageValidationError,
  ContactMessageValidationErrorCode,
  parseContactMessageInput,
} from './contact-message.validation';

const base = {
  fullName: 'Nguyen Van A',
  message: 'Muon dat tiec 30 khach.',
  sourceLocale: 'vi',
} as const;

describe('parseContactMessageInput', () => {
  it('accepts email-only payload and forces status new', () => {
    const result = parseContactMessageInput({
      ...base,
      email: 'a@example.com',
      status: 'archived',
      unknown: 'drop-me',
    });
    expect(result).toEqual({
      fullName: 'Nguyen Van A',
      email: 'a@example.com',
      message: 'Muon dat tiec 30 khach.',
      sourceLocale: 'vi',
      status: 'new',
    });
    expect(result).not.toHaveProperty('phone');
    expect(result).not.toHaveProperty('topic');
  });

  it('accepts phone-only payload', () => {
    const result = parseContactMessageInput({
      ...base,
      phone: '0901234567',
      sourceLocale: 'en',
    });
    expect(result.phone).toBe('0901234567');
    expect(result).not.toHaveProperty('email');
    expect(result.sourceLocale).toBe('en');
  });

  it('accepts legacy locale key as sourceLocale alias', () => {
    const result = parseContactMessageInput({
      fullName: 'Nguyen Van A',
      message: 'Hello',
      email: 'a@example.com',
      locale: 'en',
    });
    expect(result.sourceLocale).toBe('en');
  });

  it('accepts both email and phone with optional fields', () => {
    const result = parseContactMessageInput({
      ...base,
      email: '  a@example.com ',
      phone: ' 0901234567 ',
      topic: 'private_event',
      sourcePath: '/vi/lien-he',
      website: '',
    });
    expect(result.email).toBe('a@example.com');
    expect(result.phone).toBe('0901234567');
    expect(result.topic).toBe('private_event');
    expect(result.sourcePath).toBe('/vi/lien-he');
  });

  it('rejects non-object body', () => {
    expect(() => parseContactMessageInput(null)).toThrow(ContactMessageValidationError);
    try {
      parseContactMessageInput([]);
    } catch (error) {
      expect(error).toBeInstanceOf(ContactMessageValidationError);
      expect((error as ContactMessageValidationError).code).toBe(
        ContactMessageValidationErrorCode.InvalidBody,
      );
    }
  });

  it('rejects empty fullName', () => {
    expect(() =>
      parseContactMessageInput({ ...base, fullName: '  ', email: 'a@example.com' }),
    ).toThrowError(/fullName/i);
  });

  it('rejects empty message', () => {
    expect(() =>
      parseContactMessageInput({ ...base, message: '', email: 'a@example.com' }),
    ).toThrowError(/message/i);
  });

  it('rejects when neither email nor phone', () => {
    try {
      parseContactMessageInput({ ...base });
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ContactMessageValidationError);
      expect((error as ContactMessageValidationError).code).toBe(
        ContactMessageValidationErrorCode.ContactRequired,
      );
    }
  });

  it('rejects invalid email format', () => {
    try {
      parseContactMessageInput({ ...base, email: 'not-an-email' });
      expect.unreachable('should throw');
    } catch (error) {
      expect((error as ContactMessageValidationError).code).toBe(
        ContactMessageValidationErrorCode.EmailInvalid,
      );
    }
  });

  it('rejects non-empty honeypot website', () => {
    try {
      parseContactMessageInput({
        ...base,
        email: 'a@example.com',
        website: 'http://spam.example',
      });
      expect.unreachable('should throw');
    } catch (error) {
      expect((error as ContactMessageValidationError).code).toBe(
        ContactMessageValidationErrorCode.Honeypot,
      );
    }
  });

  it('rejects fullName over max length', () => {
    expect(() =>
      parseContactMessageInput({
        ...base,
        fullName: 'x'.repeat(CONTACT_MESSAGE_LIMITS.fullName + 1),
        email: 'a@example.com',
      }),
    ).toThrowError(/fullName/i);
  });

  it('rejects message over max length', () => {
    expect(() =>
      parseContactMessageInput({
        ...base,
        message: 'x'.repeat(CONTACT_MESSAGE_LIMITS.message + 1),
        email: 'a@example.com',
      }),
    ).toThrowError(/message/i);
  });

  it('rejects invalid sourceLocale', () => {
    try {
      parseContactMessageInput({ ...base, email: 'a@example.com', sourceLocale: 'fr' });
      expect.unreachable('should throw');
    } catch (error) {
      expect((error as ContactMessageValidationError).code).toBe(
        ContactMessageValidationErrorCode.SourceLocaleInvalid,
      );
    }
  });
});
