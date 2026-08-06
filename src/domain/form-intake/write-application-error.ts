/**
 * Strapi-shaped error body (same envelope as ApplicationError) with a custom
 * HTTP status, for cases a thrown ApplicationError cannot express (429).
 * Shared by both public form controllers so the FE sees one envelope.
 */

export type FormErrorContext = {
  status: number;
  set: (name: string, value: string) => void;
  body: unknown;
};

export const writeApplicationError = (
  ctx: FormErrorContext,
  status: number,
  message: string,
  code: string,
  extraDetails: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): void => {
  for (const [name, value] of Object.entries(headers)) {
    ctx.set(name, value);
  }
  ctx.status = status;
  ctx.body = {
    data: null,
    error: {
      status,
      name: 'ApplicationError',
      message,
      details: { code, ...extraDetails },
    },
  };
};

/** 429 envelope with Retry-After, shared by the form rate limiters. */
export const writeRateLimited = (
  ctx: FormErrorContext,
  message: string,
  code: string,
  retryAfterMs: number,
): void => {
  writeApplicationError(
    ctx,
    429,
    message,
    code,
    { retryAfterMs },
    { 'Retry-After': String(Math.ceil(retryAfterMs / 1000) || 1) },
  );
};
