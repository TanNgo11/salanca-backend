import type { Core } from '@strapi/strapi';

import type notificationTemplateFactory from '../services/notification-template';
import { adminAction, type HttpCtx } from './http';

type NotificationTemplateService = ReturnType<typeof notificationTemplateFactory>;

/** O10 "Mẫu email" (screens X4): every route needs `settings.manage`. */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () =>
    strapi.plugin('ordering').service('notification-template') as NotificationTemplateService;
  const params = (ctx: HttpCtx) => ({ code: ctx.params.code ?? '', locale: ctx.params.locale ?? '' });

  return {
    /** GET /ordering/notification-templates — list all codes × locales with "đã sửa" flags. */
    list: adminAction(strapi, async () => ({ results: await service().list() })),

    /** GET /ordering/notification-templates/:code/:locale — effective source + defaults + vars. */
    get: adminAction(strapi, async (ctx) => {
      const { code, locale } = params(ctx);
      return service().get(code, locale);
    }),

    /** PUT /ordering/notification-templates/:code/:locale — save `{subject, body}` (validated). */
    save: adminAction(strapi, async (ctx, serviceCtx) => {
      const { code, locale } = params(ctx);
      const input = (ctx.request.body ?? {}) as { subject?: unknown; body?: unknown };
      return service().put(code, locale, input, serviceCtx);
    }),

    /** POST …/preview — render optional `{subject, body}` (or the effective template) on samples. */
    preview: adminAction(strapi, async (ctx) => {
      const { code, locale } = params(ctx);
      return service().preview(
        code,
        locale,
        (ctx.request.body ?? undefined) as { subject?: unknown; body?: unknown } | undefined,
      );
    }),

    /** POST …/test — send the rendered sample to the signed-in admin's email. */
    test: adminAction(strapi, async (ctx, serviceCtx) => {
      const { code, locale } = params(ctx);
      return service().sendTest(code, locale, serviceCtx);
    }),

    /** DELETE /ordering/notification-templates/:code/:locale — restore the built-in copy. */
    remove: adminAction(strapi, async (ctx, serviceCtx) => {
      const { code, locale } = params(ctx);
      return service().remove(code, locale, serviceCtx);
    }),
  };
};
