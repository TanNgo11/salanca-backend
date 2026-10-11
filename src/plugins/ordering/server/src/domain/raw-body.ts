/**
 * Signed webhooks (SePay HMAC) are verified on the original request bytes. Strapi parses JSON
 * before the route runs, so the app must set `includeUnparsed: true` on `strapi::body`. Without
 * that, a provider would have to re-serialize the body and the signature would never match —
 * bootstrap refuses to start instead of skipping the check.
 */

export const SIGNED_WEBHOOK_CAPABILITY = 'signed-webhook';

type MiddlewareEntry = { name?: string; config?: { includeUnparsed?: boolean } };

export const rawBodyIsEnabled = (middlewares: unknown): boolean => {
  if (!Array.isArray(middlewares)) return false;
  return middlewares.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as MiddlewareEntry;
    return item.name === 'strapi::body' && item.config?.includeUnparsed === true;
  });
};

/** Reads `ctx.request.body[Symbol.for('unparsedBody')]`. Missing or non-string → null. */
export const readUnparsedBody = (body: unknown): string | null => {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as Record<symbol, unknown>)[Symbol.for('unparsedBody')];
  return typeof raw === 'string' ? raw : null;
};

export const assertSignedWebhooksHaveRawBody = (input: {
  providers: Array<{ code: string; capabilities: readonly string[]; enabled: boolean }>;
  middlewares: unknown;
}): void => {
  const needs = input.providers.filter(
    (provider) => provider.enabled && provider.capabilities.includes(SIGNED_WEBHOOK_CAPABILITY),
  );
  if (needs.length === 0 || rawBodyIsEnabled(input.middlewares)) return;
  const codes = needs.map((provider) => provider.code).join(', ');
  throw new Error(
    `[ordering] payment provider(s) ${codes} verify webhook signatures, but strapi::body is missing includeUnparsed: true. ` +
      'The original request body is required; refusing to start.',
  );
};
