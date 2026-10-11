import type { Core } from '@strapi/strapi';

import { maskPayload } from '../domain/pii';
import { actorRefOf, nowOf, type ServiceContext } from './context';

/**
 * Append-only order timeline. Payloads are masked before storage — the timeline can outlive
 * any request log, so it must never carry PII or tokens.
 */
const timeline = ({ strapi }: { strapi: Core.Strapi }) => {
  const events = () => strapi.db.query('plugin::ordering.order-event');

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
