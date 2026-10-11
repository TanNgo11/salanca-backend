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

/** `POST /ordering/webhooks/:providerCode` — public, authenticated by the provider signature. */
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
          },
          { actor: { kind: 'system', actorRef: 'webhook' }, requestId },
        );
        ctx.status = response.status;
        ctx.body = response.body ?? null;
      } catch (error) {
        sendError(ctx, error, requestId);
      }
    },
  };
};
