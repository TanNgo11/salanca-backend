import type { Core } from '@strapi/strapi';

import { nowOf, type ServiceContext } from './context';

/**
 * Stock/slot holds. Releasing marks `releasedAt` + `releaseReason` and writes a private
 * `hold.released` timeline entry per hold; holds never delete (audit trail).
 */
const hold = ({ strapi }: { strapi: Core.Strapi }) => {
  const holds = () => strapi.db.query('plugin::ordering.hold');
  const timeline = () => strapi.plugin('ordering').service('timeline') as {
    record: (
      input: {
        orderId: number;
        type: string;
        isPublic: boolean;
        payload?: Record<string, unknown>;
      },
      ctx: ServiceContext,
    ) => Promise<void>;
  };

  const release = async (
    rows: Array<{ id: number; order: number | { id: number } | null; resourceRef?: string | null }>,
    reason: string,
    ctx: ServiceContext,
  ): Promise<number> => {
    let count = 0;
    for (const row of rows) {
      await holds().update({
        where: { id: row.id },
        data: { releasedAt: nowOf(ctx), releaseReason: reason },
      });
      const orderId = typeof row.order === 'object' ? row.order?.id : row.order;
      if (orderId) {
        await timeline().record(
          {
            orderId,
            type: 'hold.released',
            isPublic: false,
            payload: { holdId: row.id, resourceRef: row.resourceRef ?? undefined, reason },
          },
          ctx,
        );
      }
      count += 1;
    }
    return count;
  };

  return {
    async create(
      input: {
        orderId: number;
        lineId?: number;
        groupId?: number;
        resourceRef?: string;
        quantity: number;
        expiresAt: Date;
      },
      _ctx: ServiceContext,
    ): Promise<number> {
      const row = await holds().create({
        data: {
          order: input.orderId,
          line: input.lineId ?? null,
          group: input.groupId ?? null,
          resourceRef: input.resourceRef ?? null,
          quantity: input.quantity,
          expiresAt: input.expiresAt,
        },
      });
      return row.id as number;
    },

    async releaseForOrder(orderId: number, reason: string, ctx: ServiceContext): Promise<number> {
      // `order` lives in a link table; populate it so release() can write the timeline row.
      const rows = await holds().findMany({
        where: { order: orderId, releasedAt: null },
        populate: { order: true },
      });
      return release(rows, reason, ctx);
    },

    async releaseForGroup(groupId: number, reason: string, ctx: ServiceContext): Promise<number> {
      const rows = await holds().findMany({
        where: { group: groupId, releasedAt: null },
        populate: { order: true },
      });
      return release(rows, reason, ctx);
    },

    /** Releases expired open holds; the Step-12 job calls this. Returns rows released. */
    async releaseExpired(now: Date, limit = 200, ctx: ServiceContext): Promise<number> {
      const rows = await holds().findMany({
        where: { releasedAt: null, expiresAt: { $lt: now } },
        limit,
        populate: { order: true },
      });
      return release(rows, 'expired', ctx);
    },
  };
};

export default hold;
