import type { Core } from '@strapi/strapi';

import { auditActionForTimeline } from '../domain/audit/actions';
import { maskPayload } from '../domain/pii';
import type changeLogFactory from './change-log';
import { actorRefOf, nowOf, type ServiceContext } from './context';

/**
 * Append-only order timeline. Payloads are masked before storage — the timeline can outlive
 * any request log, so it must never carry PII or tokens.
 */
const timeline = ({ strapi }: { strapi: Core.Strapi }) => {
  const events = () => strapi.db.query('plugin::ordering.order-event');
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;

  /**
   * O15: a staff order action (transition, cancel, reject, line cancel, cash capture, draft
   * confirm) also lands in the admin change log — one hook here instead of a `record` call in
   * every order service. Same transaction as the timeline row, so a rollback (e.g. a preview)
   * drops both.
   */
  const auditStaffEvent = async (
    input: { orderId: number; type: string; payload?: Record<string, unknown> },
    ctx: ServiceContext,
  ) => {
    if (ctx.actor.kind !== 'staff') return;
    const audit = auditActionForTimeline(input.type, input.payload);
    if (!audit) return;
    const order = (await strapi.db.query('plugin::ordering.order').findOne({
      where: { id: input.orderId },
      select: ['code', 'locationRef'],
    })) as { code?: string; locationRef?: string } | null;
    await changeLog().record(
      {
        action: audit.action,
        entityType: 'order',
        entityId: input.orderId,
        entityLabel: order?.code ?? null,
        orderId: input.orderId,
        ...(order?.locationRef ? { locationRef: order.locationRef } : {}),
        before: audit.before ?? null,
        after: audit.after ?? null,
      },
      ctx,
    );
  };

  return {
    async record(
      input: {
        orderId: number;
        type: string;
        isPublic: boolean;
        payload?: Record<string, unknown>;
        occurredAt?: Date;
      },
      ctx: ServiceContext,
    ): Promise<void> {
      await events().create({
        data: {
          order: input.orderId,
          type: input.type,
          actorRef: actorRefOf(ctx),
          isPublic: input.isPublic,
          payload: input.payload === undefined ? null : maskPayload(input.payload),
          occurredAt: input.occurredAt ?? nowOf(ctx),
        },
      });
      await auditStaffEvent(input, ctx);
    },

    /** Staff view: every event, newest first (screens S4b). */
    async listAll(orderId: number) {
      return events().findMany({ where: { order: orderId }, orderBy: { occurredAt: 'desc' } });
    },

    async listPublic(orderId: number) {
      return events().findMany({
        where: { order: orderId, isPublic: true },
        orderBy: { occurredAt: 'asc' },
      });
    },
  };
};

export default timeline;
