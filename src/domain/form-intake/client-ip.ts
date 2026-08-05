/**
 * Best-effort client IP from Koa/Strapi request context shape (rate-limit key only).
 */
export const resolveClientIp = (ctx: {
  request?: { ip?: string };
  ip?: string;
}): string => {
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
