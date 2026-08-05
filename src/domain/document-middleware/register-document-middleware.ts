import type { Core } from '@strapi/strapi';

import type {
  DocumentAfterHandler,
  DocumentBeforeHandler,
  DocumentMiddlewareContext,
} from './types';

export type RegisterDocumentMiddlewareOptions = {
  before?: readonly DocumentBeforeHandler[];
  after?: readonly DocumentAfterHandler[];
};

/**
 * Registers exactly one Document Service middleware that runs ordered handlers.
 * Prefer adding a handler here over another `strapi.documents.use` call.
 */
export const registerDocumentMiddleware = (
  strapi: Core.Strapi,
  options: RegisterDocumentMiddlewareOptions,
): void => {
  const before = options.before ?? [];
  const after = options.after ?? [];

  strapi.documents.use(async (context, next) => {
    const ctx = context as DocumentMiddlewareContext;

    for (const handler of before) {
      await handler(strapi, ctx);
    }

    const result = await next();

    for (const handler of after) {
      await handler(strapi, ctx, result);
    }

    return result;
  });
};
