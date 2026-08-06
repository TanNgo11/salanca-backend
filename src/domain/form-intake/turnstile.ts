/**
 * Cloudflare Turnstile server verification for public form intake.
 *
 * Opt-in: when TURNSTILE_SECRET_KEY is unset/empty, verification is skipped
 * so local smokes and dev stay unblocked. Production should set the secret.
 *
 * Request-only token fields: `turnstileToken` (preferred) or
 * `cf-turnstile-response` (Cloudflare default). Never persist tokens.
 */

import { isPlainRecord, trimmedNonEmptyString } from '../../shared/normalization/value';

import { FormValidationError } from './form-validation-error';

export const TURNSTILE_SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileVerifyFailureReason =
  | 'missing_token'
  | 'rejected'
  | 'upstream';

export type TurnstileVerifyResult =
  | { ok: true }
  | { ok: false; reason: TurnstileVerifyFailureReason };

/** Default bound for Cloudflare siteverify so hung upstream cannot stall create. */
export const TURNSTILE_VERIFY_TIMEOUT_MS = 5_000;

export type VerifyTurnstileOptions = {
  secret: string;
  token: string;
  /** Optional client IP (Cloudflare recommendation when available). */
  remoteip?: string;
  /** Injected for unit tests. */
  fetchImpl?: typeof fetch;
  /** Override siteverify URL (tests only). */
  siteverifyUrl?: string;
  /** Abort siteverify after this many ms (default TURNSTILE_VERIFY_TIMEOUT_MS). */
  timeoutMs?: number;
};

/**
 * Returns true when the secret is configured (non-empty after trim).
 */
export const isTurnstileEnforced = (secret: string | undefined | null): boolean =>
  Boolean(secret?.trim());

/**
 * Reads a Turnstile response token from a form payload object.
 * Accepts `turnstileToken` or Cloudflare's `cf-turnstile-response`.
 */
export function extractTurnstileToken(raw: unknown): string | undefined {
  if (!isPlainRecord(raw)) {
    return undefined;
  }
  return (
    trimmedNonEmptyString(raw.turnstileToken)
    ?? trimmedNonEmptyString(raw['cf-turnstile-response'])
    ?? undefined
  );
}

type SiteverifyBody = {
  success?: unknown;
  'error-codes'?: unknown;
};

/**
 * POSTs the token to Cloudflare siteverify.
 * Network / non-JSON failures map to `upstream` (fail closed when enforced).
 */
export async function verifyTurnstileToken(
  options: VerifyTurnstileOptions,
): Promise<TurnstileVerifyResult> {
  const secret = options.secret.trim();
  const token = options.token.trim();

  if (!secret) {
    return { ok: false, reason: 'upstream' };
  }
  if (!token) {
    return { ok: false, reason: 'missing_token' };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.siteverifyUrl ?? TURNSTILE_SITEVERIFY_URL;
  const timeoutMs = options.timeoutMs ?? TURNSTILE_VERIFY_TIMEOUT_MS;

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  const remoteip = options.remoteip?.trim();
  if (remoteip && remoteip !== 'unknown') {
    body.set('remoteip', remoteip);
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Network failure, abort/timeout, or thrown fetchImpl → fail closed.
    return { ok: false, reason: 'upstream' };
  }

  if (!response.ok) {
    return { ok: false, reason: 'upstream' };
  }

  let payload: SiteverifyBody;
  try {
    payload = (await response.json()) as SiteverifyBody;
  } catch {
    return { ok: false, reason: 'upstream' };
  }

  if (payload.success === true) {
    return { ok: true };
  }

  return { ok: false, reason: 'rejected' };
}

/**
 * When secret is set, require a valid Turnstile token or throw FormValidationError.
 * When secret is unset, no-op (dev / smoke).
 */
export async function assertTurnstileIfConfigured(options: {
  secret: string | undefined | null;
  rawData: unknown;
  remoteip?: string;
  errorCode: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<void> {
  const secret = options.secret?.trim();
  if (!secret) {
    return;
  }

  const token = extractTurnstileToken(options.rawData);
  if (!token) {
    throw new FormValidationError(
      options.errorCode,
      'Human verification is required.',
    );
  }

  const result = await verifyTurnstileToken({
    secret,
    token,
    remoteip: options.remoteip,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });

  if (!result.ok) {
    throw new FormValidationError(
      options.errorCode,
      result.reason === 'upstream'
        ? 'Human verification is temporarily unavailable.'
        : 'Human verification failed.',
    );
  }
}

/**
 * Controller helper: enforce Turnstile from TURNSTILE_SECRET_KEY + request body.
 * Keeps env/token wiring out of individual form create controllers.
 */
export async function assertEnvTurnstile(options: {
  rawData: unknown;
  remoteip?: string;
  errorCode: string;
}): Promise<void> {
  await assertTurnstileIfConfigured({
    secret: process.env.TURNSTILE_SECRET_KEY,
    rawData: options.rawData,
    remoteip: options.remoteip,
    errorCode: options.errorCode,
  });
}
