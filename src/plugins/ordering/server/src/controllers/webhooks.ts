import type { Core } from '@strapi/strapi';

import type webhookDeliveryFactory from '../services/webhook-delivery';
import type webhookEndpointFactory from '../services/webhook-endpoint';
import type { EndpointInput } from '../services/webhook-endpoint';
import { adminAction, positiveInt, text } from './http';

type EndpointService = ReturnType<typeof webhookEndpointFactory>;
type DeliveryService = ReturnType<typeof webhookDeliveryFactory>;

/**
 * "Webhook" screen API (screens X1). Every route requires `plugin::ordering.webhook.manage`.
 * The endpoint service never returns secret material — the plaintext secret appears exactly
 * twice in this surface: on `create` and on `rotateSecret`, both by design (the UI shows it
 * once, then it is sealed forever).
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const endpoints = () => strapi.plugin('ordering').service('webhook-endpoint') as EndpointService;
  const deliveries = () => strapi.plugin('ordering').service('webhook-delivery') as DeliveryService;

  const endpointId = (raw: string | undefined): number => positiveInt(raw) ?? 0;

  return {
    list: adminAction(strapi, async (_ctx, serviceCtx) => ({
      results: await endpoints().list(serviceCtx),
    })),

    eventCatalog: adminAction(strapi, async (_ctx, serviceCtx) => ({
      results: endpoints().eventCatalog(serviceCtx),
    })),

    get: adminAction(strapi, async (ctx, serviceCtx) => ({
      item: await endpoints().get(endpointId(ctx.params.id), serviceCtx),
    })),

    create: adminAction(strapi, async (ctx, serviceCtx) =>
      endpoints().create((ctx.request.body ?? {}) as EndpointInput, serviceCtx),
    ),

    update: adminAction(strapi, async (ctx, serviceCtx) =>
      endpoints().update(
        endpointId(ctx.params.id),
        (ctx.request.body ?? {}) as EndpointInput,
        serviceCtx,
      ),
    ),

    rotateSecret: adminAction(strapi, async (ctx, serviceCtx) =>
      endpoints().rotateSecret(endpointId(ctx.params.id), serviceCtx),
    ),

    setActive: adminAction(strapi, async (ctx, serviceCtx) => {
      const body = (ctx.request.body ?? {}) as { active?: unknown };
      return endpoints().setActive(endpointId(ctx.params.id), body.active === true, serviceCtx);
    }),

    sendTest: adminAction(strapi, async (ctx, serviceCtx) =>
      deliveries().sendTest(endpointId(ctx.params.id), serviceCtx),
    ),

    deliveries: adminAction(strapi, async (ctx, _serviceCtx) =>
      deliveries().listDeliveries(endpointId(ctx.params.id), {
        status: text(ctx.query.status),
        page: positiveInt(ctx.query.page),
        pageSize: positiveInt(ctx.query.pageSize),
      }),
    ),

    resend: adminAction(strapi, async (ctx, serviceCtx) =>
      deliveries().resend(endpointId(ctx.params.id), serviceCtx),
    ),
  };
};
