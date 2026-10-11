import type { CaptchaProvider } from '../contracts';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare Turnstile (contracts §11). The secret comes from app config
 * (`providers.captcha.turnstile.secretKey`), never from the request. A network failure counts
 * as "not verified" — captcha protects order creation, so it fails closed.
 */
export const createTurnstileCaptchaProvider = (input: {
  secretKey: () => string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): CaptchaProvider => ({
  code: 'turnstile',
  async verify({ token, ip, action }) {
    const secret = input.secretKey();
    if (!secret) {
      return { valid: false, code: 'CAPTCHA_MISCONFIGURED', message: 'captcha secret is not set' };
    }
    if (!token) return { valid: false, code: 'CAPTCHA_MISSING', message: 'captcha token is required' };
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== 'unknown') body.set('remoteip', ip);
    try {
      const response = await (input.fetchImpl ?? fetch)(SITEVERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(input.timeoutMs ?? 5000),
      });
      const result = (await response.json()) as { success?: boolean; action?: string };
      if (result.success !== true) {
        return { valid: false, code: 'CAPTCHA_FAILED', message: 'captcha verification failed' };
      }
      // Widgets may omit `action`; when present it must match the protected operation.
      if (result.action && result.action !== action) {
        return { valid: false, code: 'CAPTCHA_FAILED', message: 'captcha action mismatch' };
      }
      return { valid: true };
    } catch {
      return { valid: false, code: 'CAPTCHA_UNAVAILABLE', message: 'captcha service unreachable' };
    }
  },
});

/** Deterministic captcha for integration tests (`testing.builtins` only): token "pass" passes. */
export const createTestCaptchaProvider = (): CaptchaProvider => ({
  code: 'test-captcha',
  async verify({ token }) {
    return token === 'pass'
      ? { valid: true }
      : { valid: false, code: 'CAPTCHA_FAILED', message: 'captcha verification failed' };
  },
});
