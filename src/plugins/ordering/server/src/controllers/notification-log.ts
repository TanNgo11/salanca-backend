import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import type notificationLogFactory from '../services/notification-log';
import { adminAction, text } from './http';

type NotificationLog = ReturnType<typeof notificationLogFactory>;

/** Upper bound of the `integer` id column; a larger value reaches pg as an out-of-range 22003. */
const MAX_ID = 2_147_483_647;

/**
 * A path id is canonical digits only, so `1.5` or `1e3` can never quietly address row 1 or 1000.
 * Anything else — text, a fraction, zero, a negative, or a value past `integer` — is a missing
 * row (404) and never reaches the database as a driver error.
 */
const deliveryId = (raw: string | undefined): number => {
  const parsed = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ID) {
    throw new OrderingError('NOTIFICATION_DELIVERY_NOT_FOUND', 'delivery not found');
  }
  return parsed;
};

/**
 * R1b "Lịch sử gửi" (read-only): `notification-log.read`; the `/technical` tail additionally
 * requires `notification-log.details` (enforced by the route policy before this handler runs).
 * Scope is enforced in the service.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('ordering').service('notification-log') as NotificationLog;
  const queryOf = (query: Record<string, unknown>) => ({
    from: text(query.from) ?? undefined,
    to: text(query.to) ?? undefined,
    status: text(query.status) ?? undefined,
    channel: text(query.channel) ?? undefined,
    template: text(query.template) ?? undefined,
    role: text(query.role) ?? undefined,
    q: text(query.q) ?? undefined,
    page: query.page,
    locale: text(query.locale) ?? undefined,
  });

  return {
    list: adminAction(strapi, async (ctx, serviceCtx) => service().list(queryOf(ctx.query), serviceCtx)),
    summary: adminAction(strapi, async (_ctx, serviceCtx) => service().summary(serviceCtx)),
    detail: adminAction(strapi, async (ctx, serviceCtx) =>
      service().detail(deliveryId(ctx.params.id), { locale: text(ctx.query.locale) ?? undefined }, serviceCtx),
    ),
    technical: adminAction(strapi, async (ctx, serviceCtx) =>
      service().technical(deliveryId(ctx.params.id), serviceCtx),
    ),
  };
};
