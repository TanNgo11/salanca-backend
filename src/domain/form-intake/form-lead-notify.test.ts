import { describe, expect, it, vi } from 'vitest';

import {
  buildContactLeadEmail,
  buildReservationLeadEmail,
  formatNotifyErrorCode,
  isFormNotifySmtpConfigured,
  notifyFormLead,
  parseFormNotifyRecipients,
  resolveFormNotifyRecipients,
  sanitizeSubjectFragment,
  toContactLeadNotifyPayload,
} from './form-lead-notify';

describe('parseFormNotifyRecipients', () => {
  it('parses, lowercases, dedupes, and drops invalid', () => {
    expect(
      parseFormNotifyRecipients(
        ' Booking@Salanca.com , other@example.com; booking@salanca.com, nope',
      ),
    ).toEqual(['booking@salanca.com', 'other@example.com']);
    expect(parseFormNotifyRecipients('')).toEqual([]);
    expect(parseFormNotifyRecipients(undefined)).toEqual([]);
  });
});

describe('resolveFormNotifyRecipients', () => {
  it('warns when raw is set but every address is invalid', () => {
    const warn = vi.fn();
    expect(resolveFormNotifyRecipients('not-an-email, also-bad', { warn })).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('does not warn when raw is empty', () => {
    const warn = vi.fn();
    expect(resolveFormNotifyRecipients('  ', { warn })).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('sanitizeSubjectFragment / isFormNotifySmtpConfigured', () => {
  it('strips control characters from subject fragments', () => {
    expect(sanitizeSubjectFragment('A\r\nB\0C')).toBe('A B C');
  });

  it('requires EMAIL_SMTP_HOST for intentional SMTP', () => {
    expect(isFormNotifySmtpConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isFormNotifySmtpConfigured({ EMAIL_SMTP_HOST: '  ' } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      isFormNotifySmtpConfigured({
        EMAIL_SMTP_HOST: 'smtp.resend.com',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it('formats error codes without dumping bodies', () => {
    expect(formatNotifyErrorCode(Object.assign(new Error('x'), { code: 'EAUTH' }))).toBe(
      'Error:EAUTH',
    );
    expect(formatNotifyErrorCode(new Error('x'))).toBe('Error:unknown');
  });
});

describe('buildFormLeadEmail', () => {
  it('builds contact subject and escapes html body', () => {
    const message = buildContactLeadEmail({
      kind: 'contact-message',
      documentId: 'doc1',
      fullName: 'A <B>',
      email: 'a@example.com',
      message: 'Hello <script>',
      sourceLocale: 'vi',
    });

    expect(message.subject).toContain('A <B>');
    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.html).toContain('A &lt;B&gt;');
    expect(message.html).toContain('Hello &lt;script&gt;');
    expect(message.text).toContain('Hello <script>');
  });

  it('strips newlines from subject name fragments', () => {
    const message = buildContactLeadEmail({
      kind: 'contact-message',
      documentId: 'doc1',
      fullName: 'Evil\r\nBcc: attacker@example.com',
      message: 'hi',
      sourceLocale: 'vi',
    });
    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.subject).toContain('Evil');
  });

  it('flags reservation overlap in subject from overlapCount', () => {
    const message = buildReservationLeadEmail({
      kind: 'reservation-request',
      documentId: 'doc2',
      fullName: 'Guest',
      phone: '090',
      preferredDate: '2026-08-20',
      preferredTime: '19:00',
      guestCount: 4,
      menuSelectionMode: 'later',
      sourceLocale: 'vi',
      overlapCount: 2,
    });

    expect(message.subject).toContain('overlap');
    expect(message.text).toContain('Overlap count: 2');
  });

  it('builds contact notify payload without undefined keys', () => {
    expect(
      toContactLeadNotifyPayload('id1', {
        fullName: 'A',
        message: 'm',
        sourceLocale: 'vi',
        email: 'a@example.com',
      }),
    ).toEqual({
      kind: 'contact-message',
      documentId: 'id1',
      fullName: 'A',
      email: 'a@example.com',
      message: 'm',
      sourceLocale: 'vi',
    });
  });
});

describe('notifyFormLead', () => {
  it('skips when no recipients', async () => {
    const send = vi.fn();
    const result = await notifyFormLead({
      payload: {
        kind: 'contact-message',
        documentId: 'x',
        fullName: 'A',
        message: 'm',
        sourceLocale: 'vi',
      },
      recipients: [],
      send,
      log: { info: vi.fn(), error: vi.fn() },
    });
    expect(result).toEqual({ sent: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends and absorbs delivery errors', async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    const sendOk = vi.fn().mockResolvedValue(undefined);
    await expect(
      notifyFormLead({
        payload: {
          kind: 'contact-message',
          documentId: 'x',
          fullName: 'A',
          message: 'm',
          sourceLocale: 'vi',
        },
        recipients: ['ops@example.com'],
        send: sendOk,
        log,
      }),
    ).resolves.toEqual({ sent: true });
    expect(log.info).toHaveBeenCalled();

    const sendFail = vi.fn().mockRejectedValue(Object.assign(new Error('smtp'), { code: 'EAUTH' }));
    await expect(
      notifyFormLead({
        payload: {
          kind: 'contact-message',
          documentId: 'x',
          fullName: 'A',
          message: 'm',
          sourceLocale: 'vi',
        },
        recipients: ['ops@example.com'],
        send: sendFail,
        log,
      }),
    ).resolves.toEqual({ sent: false });
    expect(log.error).toHaveBeenCalledWith(
      'form lead notify failed',
      expect.objectContaining({ code: 'Error:EAUTH' }),
    );
  });
});
