import { describe, expect, it, vi } from 'vitest';

import { createTestCaptchaProvider, createTurnstileCaptchaProvider } from './turnstile-captcha';

const respond = (payload: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;

describe('turnstile captcha', () => {
  it('sends secret, token and remote IP and accepts success', async () => {
    const fetchImpl = respond({ success: true, action: 'order-create' });
    const provider = createTurnstileCaptchaProvider({ secretKey: () => 'secret', fetchImpl });
    expect(await provider.verify({ token: 'tok', ip: '1.2.3.4', action: 'order-create' })).toEqual({
      valid: true,
    });
    const body = (fetchImpl as unknown as { mock: { calls: [string, { body: URLSearchParams }][] } })
      .mock.calls[0][1].body;
    expect(Object.fromEntries(body)).toEqual({ secret: 'secret', response: 'tok', remoteip: '1.2.3.4' });
  });

  it('fails closed on failure, action mismatch, missing secret/token and network errors', async () => {
    const failed = createTurnstileCaptchaProvider({ secretKey: () => 's', fetchImpl: respond({ success: false }) });
    expect((await failed.verify({ token: 't', action: 'a' })).valid).toBe(false);
    const mismatch = createTurnstileCaptchaProvider({
      secretKey: () => 's',
      fetchImpl: respond({ success: true, action: 'other' }),
    });
    expect((await mismatch.verify({ token: 't', action: 'a' })).valid).toBe(false);
    const noSecret = createTurnstileCaptchaProvider({ secretKey: () => undefined });
    expect(await noSecret.verify({ token: 't', action: 'a' })).toMatchObject({ code: 'CAPTCHA_MISCONFIGURED' });
    const broken = createTurnstileCaptchaProvider({
      secretKey: () => 's',
      fetchImpl: vi.fn(async () => {
        throw new Error('down');
      }) as unknown as typeof fetch,
    });
    expect(await broken.verify({ token: 't', action: 'a' })).toMatchObject({ code: 'CAPTCHA_UNAVAILABLE' });
    expect(await broken.verify({ token: '', action: 'a' })).toMatchObject({ code: 'CAPTCHA_MISSING' });
  });

  it('test provider passes only the token "pass"', async () => {
    const provider = createTestCaptchaProvider();
    expect((await provider.verify({ token: 'pass', action: 'a' })).valid).toBe(true);
    expect((await provider.verify({ token: 'nope', action: 'a' })).valid).toBe(false);
  });
});
