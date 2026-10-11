import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * Client IP for rate limits and captcha `remoteip`. Behind Cloudflare, or when the web app calls
 * the API from its own server, `ctx.request.ip` is the proxy or the web server, so every visitor
 * would share one bucket. A trusted caller may forward the visitor IP in `ipHeader` while proving
 * itself with `sharedSecret` in `secretHeader` (the app supplies the header names and secret
 * through plugin config). Anything else — no secret configured, a wrong secret, a junk IP — falls
 * back to the socket IP silently, so a bad header can never become a way to reject traffic.
 */
export type ClientIpConfig = {
  sharedSecret?: string;
  secretHeader: string;
  ipHeader: string;
};

type HeaderValue = string | string[] | undefined;

export type ClientIpContext = {
  request?: { ip?: string; headers?: Record<string, HeaderValue> };
  ip?: string;
};

const firstHeader = (value: HeaderValue): string | undefined =>
  (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

const secretsMatch = (expected: string, received: string): boolean => {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function resolveClientIp(ctx: ClientIpContext, config?: ClientIpConfig): string {
  const fallback = ctx.request?.ip ?? ctx.ip ?? 'unknown';
  const expected = config?.sharedSecret?.trim();
  const headers = ctx.request?.headers;
  if (!config || !expected || !headers) return fallback;
  const received = firstHeader(headers[config.secretHeader.toLowerCase()]);
  if (!received || !secretsMatch(expected, received)) return fallback;
  const forwarded = firstHeader(headers[config.ipHeader.toLowerCase()]);
  return forwarded && isIP(forwarded) ? forwarded : fallback;
}
