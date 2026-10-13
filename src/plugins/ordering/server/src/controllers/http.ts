import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import { isOrderingError } from '../domain/errors';
import type { ServiceContext } from '../services/context';
import type scopeFactory from '../services/scope';

/** Minimal Koa context surface the ordering controllers use. */
export interface HttpCtx {
  method?: string;
  query: Record<string, unknown>;
  params: Record<string, string | undefined>;
  request: {
    body?: unknown;
    ip?: string;
    headers?: Record<string, string | string[] | undefined>;
  };
  ip?: string;
  state: { user?: { id?: number; roles?: { code?: string }[]; firstname?: string; lastname?: string } };
  status: number;
  body: unknown;
  set(field: string, value: string): void;
  get(field: string): string;
}

/** Admin action context: the staff actor resolved from the authenticated admin user. */
export const adminContext = async (strapi: Core.Strapi, ctx: HttpCtx): Promise<ServiceContext> => {
  const scope = strapi.plugin('ordering').service('scope') as ReturnType<typeof scopeFactory>;
  return { actor: await scope.actorFromAdminUser(ctx.state.user ?? {}), requestId: randomUUID() };
};

/**
 * Maps `OrderingError` to the standard API error body (contracts §11) and rethrows anything
 * else so Strapi's error middleware logs it and answers 500 without leaking internals.
 */
export const sendError = (ctx: HttpCtx, error: unknown, requestId: string = randomUUID()): void => {
  if (isOrderingError(error)) {
    ctx.status = error.status;
    ctx.body = { error: error.toApiError(requestId) };
    return;
  }
  throw error;
};

/** Runs an admin handler with the staff context and the standard error mapping. */
export const adminAction =
  (strapi: Core.Strapi, handler: (ctx: HttpCtx, service: ServiceContext) => Promise<unknown>) =>
  async (ctx: HttpCtx) => {
    const serviceCtx = await adminContext(strapi, ctx);
    try {
      const body = await handler(ctx, serviceCtx);
      if (body !== undefined) ctx.body = body;
    } catch (error) {
      sendError(ctx, error, serviceCtx.requestId);
    }
  };

export const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

export const positiveInt = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};
