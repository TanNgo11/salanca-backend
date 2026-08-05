import type { Core } from '@strapi/strapi';

/**
 * Shared Document Service middleware context (single middleware stack).
 * Handlers receive this shape; they must no-op when uid/action do not match.
 */
export type DocumentMiddlewareContext = {
  uid: string;
  action: string;
  params: {
    data?: Record<string, unknown>;
    documentId?: string;
    locale?: string;
  };
};

export type DocumentBeforeHandler = (
  strapi: Core.Strapi,
  ctx: DocumentMiddlewareContext,
) => void | Promise<void>;

export type DocumentAfterHandler = (
  strapi: Core.Strapi,
  ctx: DocumentMiddlewareContext,
  result: unknown,
) => void | Promise<void>;
