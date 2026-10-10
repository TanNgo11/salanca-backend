import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import { maskPayload } from '../domain/pii';
import { nowOf, type ServiceContext } from './context';

/**
 * Transactional outbox, write side only (claim/deliver lands with the Step-12 job).
 * `enqueue` MUST be called inside the business transaction so the event commits or rolls back
 * with its state change — never call it after commit.
 */
const outbox = ({ strapi }: { strapi: Core.Strapi }) => {
  const events = () => strapi.db.query('plugin::ordering.outbox');

  return {
    async enqueue(
      input: {
        type: string;
        aggregateType: string;
        aggregateId: string;
        payload: Record<string, unknown>;
        uniqueKey?: string;
        availableAt?: Date;
      },
      ctx: ServiceContext,
    ): Promise<number> {
      const now = nowOf(ctx);
      const row = await events().create({
        data: {
          type: input.type,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          payload: maskPayload(input.payload),
          uniqueKey: input.uniqueKey ?? `${input.type}:${input.aggregateId}:${randomUUID()}`,
          occurredAt: now,
          availableAt: input.availableAt ?? now,
          attempts: 0,
        },
      });
      return row.id as number;
    },
  };
};

export default outbox;
