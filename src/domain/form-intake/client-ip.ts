import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const INTAKE_SECRET_HEADER = 'x-salanca-intake-secret';
export const VISITOR_IP_HEADER = 'x-salanca-visitor-ip';

type HeaderValue = string | string[] | undefined;

type ClientIpContext = {
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

/**
 * Visitor IP forwarded by the trusted web server. Only honoured when
 * `FORM_INTAKE_SHARED_SECRET` is set and the request proves it; anything else
 * (wrong secret, junk IP) silently falls back to the socket IP so a bad header
 * can never turn into a new way to reject traffic.
 */
const trustedVisitorIp = (
  headers: Record<string, HeaderValue> | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined => {
  const expected = env.FORM_INTAKE_SHARED_SECRET?.trim();
  if (!expected || !headers) {
    return undefined;
  }
  const received = firstHeader(headers[INTAKE_SECRET_HEADER]);
  if (!received || !secretsMatch(expected, received)) {
    return undefined;
  }
  const visitorIp = firstHeader(headers[VISITOR_IP_HEADER]);
  return visitorIp && isIP(visitorIp) ? visitorIp : undefined;
};

/**
 * Client IP for rate limiting / Turnstile `remoteip` from a Koa/Strapi context.
 */
export const resolveClientIp = (
  ctx: ClientIpContext,
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const forwarded = trustedVisitorIp(ctx.request?.headers, env);
  if (forwarded) {
    return forwarded;
  }
  const fromRequest = ctx.request?.ip?.trim();
  if (fromRequest) {
    return fromRequest;
  }
  const fromCtx = ctx.ip?.trim();
  if (fromCtx) {
    return fromCtx;
  }
  return 'unknown';
};
