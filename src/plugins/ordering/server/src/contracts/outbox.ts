import type { JsonObject } from './common';

/** Durable outbox event row and consumer signature (contracts doc §12). */
export type OutboxEvent = {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: JsonObject;
  uniqueKey: string;
  occurredAt: string;
  availableAt: string;
  attempts: number;
  lockedAt?: string;
  deliveredAt?: string;
  lastError?: string;
};

/** Consumers must be idempotent by event id; `ctx.strapi` stays opaque to keep contracts pure. */
export type OutboxConsumer = (
  event: OutboxEvent,
  ctx: { strapi: unknown },
) => Promise<void>;
