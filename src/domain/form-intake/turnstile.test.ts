import { afterEach, describe, expect, it, vi } from 'vitest';

import { FormValidationError } from './form-validation-error';
import {
  assertTurnstileIfConfigured,
  extractTurnstileToken,
  isTurnstileEnforced,
  verifyTurnstileToken,
} from './turnstile';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isTurnstileEnforced', () => {
  it('is false for empty secret', () => {
    expect(isTurnstileEnforced(undefined)).toBe(false);
    expect(isTurnstileEnforced('')).toBe(false);
    expect(isTurnstileEnforced('   ')).toBe(false);
  });

  it('is true for non-empty secret', () => {
    expect(isTurnstileEnforced('secret')).toBe(true);
  });
});

describe('extractTurnstileToken', () => {
  it('reads preferred and Cloudflare field names', () => {
    expect(extractTurnstileToken({ turnstileToken: '  abc  ' })).toBe('abc');
    expect(extractTurnstileToken({ 'cf-turnstile-response': 'xyz' })).toBe('xyz');
    expect(
      extractTurnstileToken({
        turnstileToken: 'prefer',
        'cf-turnstile-response': 'other',
      }),
    ).toBe('prefer');
    expect(extractTurnstileToken({})).toBeUndefined();
    expect(extractTurnstileToken(null)).toBeUndefined();
  });
});

describe('verifyTurnstileToken', () => {
  it('rejects missing token without calling fetch', async () => {
    const fetchImpl = vi.fn();
    await expect(
      verifyTurnstileToken({ secret: 's', token: '', fetchImpl }),
    ).resolves.toEqual({ ok: false, reason: 'missing_token' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts success:true from Cloudflare', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await expect(
      verifyTurnstileToken({
        secret: 's',
        token: 'tok',
        remoteip: '1.2.3.4',
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('secret=s');
    expect(String(init.body)).toContain('response=tok');
    expect(String(init.body)).toContain('remoteip=1.2.3.4');
  });

  it('maps success:false to rejected', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    });

    await expect(
      verifyTurnstileToken({ secret: 's', token: 'bad', fetchImpl }),
    ).resolves.toEqual({ ok: false, reason: 'rejected' });
  });

  it('maps network failure to upstream', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    await expect(
      verifyTurnstileToken({ secret: 's', token: 'tok', fetchImpl }),
    ).resolves.toEqual({ ok: false, reason: 'upstream' });
  });

  it('maps abort/timeout to upstream and passes AbortSignal', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
    );

    await expect(
      verifyTurnstileToken({
        secret: 's',
        token: 'tok',
        fetchImpl,
        timeoutMs: 50,
      }),
    ).resolves.toEqual({ ok: false, reason: 'upstream' });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeDefined();
    expect(init.signal?.aborted).toBeTypeOf('boolean');
  });
});


describe('assertTurnstileIfConfigured', () => {
  it('no-ops when secret is unset', async () => {
    const fetchImpl = vi.fn();
    await expect(
      assertTurnstileIfConfigured({
        secret: undefined,
        rawData: {},
        errorCode: 'X',
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws when enforced and token missing', async () => {
    await expect(
      assertTurnstileIfConfigured({
        secret: 's',
        rawData: { fullName: 'A' },
        errorCode: 'CONTACT_TURNSTILE',
      }),
    ).rejects.toMatchObject({
      name: 'FormValidationError',
      code: 'CONTACT_TURNSTILE',
    });
  });

  it('throws when Cloudflare rejects the token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false }),
    });

    await expect(
      assertTurnstileIfConfigured({
        secret: 's',
        rawData: { turnstileToken: 'bad' },
        errorCode: 'RESERVATION_TURNSTILE',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(FormValidationError);
  });

  it('passes when Cloudflare accepts the token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await expect(
      assertTurnstileIfConfigured({
        secret: 's',
        rawData: { turnstileToken: 'good' },
        errorCode: 'CONTACT_TURNSTILE',
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
  });
});
