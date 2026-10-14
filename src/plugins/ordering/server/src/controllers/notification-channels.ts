import type { Core } from '@strapi/strapi';

import type notificationChannelFactory from '../services/notification-channel';
import { adminAction, type HttpCtx } from './http';

type NotificationChannelService = ReturnType<typeof notificationChannelFactory>;

/** O13 "Kênh thông báo" (screens P3): every route needs `settings.manage`. */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () =>
    strapi.plugin('ordering').service('notification-channel') as NotificationChannelService;

  return {
    /** GET /ordering/notification-channels — every template's effective chain + usage counters. */
    list: adminAction(strapi, async () => service().overview()),

    /** PUT /ordering/notification-channels/:template — `{channels, zns?, active?}` (validated). */
    put: adminAction(strapi, async (ctx: HttpCtx, serviceCtx) =>
      service().put(ctx.params.template ?? '', ctx.request.body ?? {}, serviceCtx),
    ),

    /** POST /ordering/notification-channels/test — `{template, channel, target}` → one send. */
    test: adminAction(strapi, async (ctx, serviceCtx) =>
      service().sendTest(ctx.request.body ?? {}, serviceCtx),
    ),
  };
};
