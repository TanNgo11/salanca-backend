import type { Core } from '@strapi/strapi';

import { maskPayload } from '../domain/pii';
import type { ServiceContext } from './context';
import { actorRefOf, nowOf } from './context';

/**
 * Append-only admin change log. `changes` is a top-level field diff over PII-masked snapshots
 * (`{ field: { before, after } }`) — changes are detected on raw values but stored masked,
 * so redacted fields appear as `'[redacted]' → '[redacted]'`, never raw values. The
 * `ordering.admin.changed` eventHub
 * emission carries refs only (no values), so listeners can't leak PII.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const changeLog = ({ strapi }: { strapi: Core.Strapi }) => {
  const logs = () => strapi.db.query('plugin::ordering.admin-change-log');

  const diff = (before: unknown, after: unknown): Record<string, { before: unknown; after: unknown }> => {
    // Changed keys are detected on the RAW values (two distinct phone numbers must register
    // as a change); the stored before/after are masked, so the log keeps the change record
    // without ever containing the value itself.
    const rawBefore = (isRecord(before) ? before : {}) as Record<string, unknown>;
    const rawAfter = (isRecord(after) ? after : {}) as Record<string, unknown>;
    const out: Record<string, { before: unknown; after: unknown }> = {};
    for (const key of new Set([...Object.keys(rawBefore), ...Object.keys(rawAfter)])) {
      if (JSON.stringify(rawBefore[key]) !== JSON.stringify(rawAfter[key])) {
        const maskedBefore = maskPayload({ [key]: rawBefore[key] }) as Record<string, unknown>;
        const maskedAfter = maskPayload({ [key]: rawAfter[key] }) as Record<string, unknown>;
        out[key] = { before: maskedBefore[key], after: maskedAfter[key] };
      }
    }
    return out;
  };

  return {
    async record(
      input: {
        action: string;
        entityType: string;
        entityId: number | string;
        locationRef?: string;
        before?: Record<string, unknown> | null;
        after?: Record<string, unknown> | null;
      },
      ctx: ServiceContext,
    ): Promise<number> {
      const occurredAt = nowOf(ctx);
      const row = await logs().create({
        data: {
          actorRef: actorRefOf(ctx),
          action: input.action,
          entityType: input.entityType,
          entityId: String(input.entityId),
          locationRef: input.locationRef ?? null,
          occurredAt,
          changes: diff(input.before, input.after),
        },
      });
      // Refs only — no before/after values, no payload.
      strapi.eventHub.emit('ordering.admin.changed', {
        action: input.action,
        entityType: input.entityType,
        entityId: String(input.entityId),
        locationRef: input.locationRef,
        actorRef: actorRefOf(ctx),
        occurredAt,
      });
      return row.id as number;
    },

    async list(filters: { entityType?: string; limit?: number }) {
      return logs().findMany({
        where: filters.entityType ? { entityType: filters.entityType } : {},
        orderBy: { occurredAt: 'desc' },
        limit: filters.limit ?? 50,
      });
    },
  };
};

export default changeLog;
