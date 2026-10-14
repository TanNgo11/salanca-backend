import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import { sendError, type HttpCtx } from './http';
import type webhookFactory from '../services/webhook';

const headersOf = (ctx: HttpCtx): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(ctx.request.headers ?? {})) {
    if (typeof value === 'string') headers[key.toLowerCase()] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') headers[key.toLowerCase()] = value[0];
  }
  return headers;
};

/**
 * `/ordering/webhooks/:providerCode` — public, authenticated by the provider signature.
 * POST carries a signed body; GET (VNPay IPN) carries the signed params in the query string.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const webhooks = () => strapi.plugin('ordering').service('webhook') as ReturnType<typeof webhookFactory>;

  return {
    async receive(ctx: HttpCtx) {
      const requestId = randomUUID();
      try {
        const response = await webhooks().receive(
          {
            providerCode: ctx.params.providerCode ?? '',
            body: ctx.request.body,
            headers: headersOf(ctx),
            ...(ctx.method === 'GET'
              ? { params: (ctx.query ?? {}) as Record<string, unknown> }
              : {}),
          },
          { actor: { kind: 'system', actorRef: 'webhook' }, requestId },
        );
        ctx.status = response.status;
        // `body = null` would reset the status to 204 in Koa — only set it when defined.
        if (response.body !== undefined) ctx.body = response.body;
      } catch (error) {
        sendError(ctx, error, requestId);
      }
    },
  };
};
