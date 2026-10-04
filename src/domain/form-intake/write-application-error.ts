/**
 * Strapi-shaped error body (same envelope as ApplicationError) with a custom
 * HTTP status, for responses like 429 that `ApplicationError` (400) cannot express.
 */
export const writeApplicationError = (
  ctx: {
    status: number;
    set: (name: string, value: string) => void;
    body: unknown;
  },
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
