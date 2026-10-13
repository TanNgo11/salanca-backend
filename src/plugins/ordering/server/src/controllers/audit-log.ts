import type { Core } from '@strapi/strapi';

import type auditLogFactory from '../services/audit-log';
import { adminAction, positiveInt, text } from './http';

type AuditLog = ReturnType<typeof auditLogFactory>;

/** O15 "Lịch sử thay đổi" (`audit.read`; export also needs `export`). Scope is enforced in the service. */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('ordering').service('audit-log') as AuditLog;
  const queryOf = (query: Record<string, unknown>) => ({
    from: text(query.from) ?? undefined,
    to: text(query.to) ?? undefined,
    actor: text(query.actor) ?? undefined,
    category: text(query.category) ?? undefined,
    action: text(query.action) ?? undefined,
    branch: text(query.branch) ?? undefined,
    q: text(query.q) ?? undefined,
    page: positiveInt(query.page) ?? undefined,
    locale: text(query.locale) ?? undefined,
  });

  return {
    list: adminAction(strapi, async (ctx, serviceCtx) => service().list(queryOf(ctx.query), serviceCtx)),
    detail: adminAction(strapi, async (ctx, serviceCtx) =>
      service().detail(positiveInt(ctx.params.id) ?? 0, { locale: text(ctx.query.locale) ?? undefined }, serviceCtx),
    ),
    actors: adminAction(strapi, async (_ctx, serviceCtx) => ({ actors: await service().actors(serviceCtx) })),
    exportCsv: adminAction(strapi, async (ctx, serviceCtx) => {
      const { csv, fileName } = await service().exportCsv(queryOf(ctx.query), serviceCtx);
      ctx.set('Content-Type', 'text/csv; charset=utf-8');
      ctx.set('Content-Disposition', `attachment; filename="${fileName}"`);
      ctx.body = csv;
      return undefined;
    }),
  };
};
