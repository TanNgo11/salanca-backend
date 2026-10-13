import type { Core } from '@strapi/strapi';

import type customerGroupFactory from '../services/customer-group';
import { adminAction, positiveInt, text } from './http';

type CustomerGroups = ReturnType<typeof customerGroupFactory>;

/** O14 customer groups (screen L3). Search returns a masked phone and is not logged. */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('ordering').service('customer-group') as CustomerGroups;
  const id = (ctx: { params: Record<string, unknown> }) => positiveInt(ctx.params.id) ?? 0;

  return {
    list: adminAction(strapi, async () => service().list()),
    search: adminAction(strapi, async (ctx) => service().search(text(ctx.query.q) ?? '')),
    get: adminAction(strapi, async (ctx) => service().get(id(ctx))),
    create: adminAction(strapi, async (ctx, serviceCtx) => {
      const created = await service().create(ctx.request.body, serviceCtx);
      ctx.status = 201;
      return created;
    }),
    update: adminAction(strapi, async (ctx, serviceCtx) => service().update(id(ctx), ctx.request.body, serviceCtx)),
    members: adminAction(strapi, async (ctx, serviceCtx) => service().setMembers(id(ctx), ctx.request.body, serviceCtx)),
  };
};
