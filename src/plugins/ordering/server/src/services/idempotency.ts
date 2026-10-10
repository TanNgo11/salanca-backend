import type { Core } from '@strapi/strapi';

import type { JsonObject } from '../contracts/common';
import { OrderingError } from '../domain/errors';
import { hashPayload } from '../domain/hashing';
import type { OrderingConfig } from '../config';
import type { ServiceContext } from './context';
import { nowOf } from './context';
import type { TransactionClient } from '../migrations/runner';

/**
 * Internal sentinel (never leaves the service layer as an API error): the unique index on
 * (scope, key) fired, meaning another request already claimed this idempotency key.
 */
export class IdempotencyConflict extends Error {
  constructor(
    readonly scope: string,
    readonly key: string,
  ) {
    super(`idempotency key conflict on ${scope}:${key}`);
    this.name = 'IdempotencyConflict';
  }
}

const isUniqueViolation = (error: unknown): boolean => {
  const code = (error as { code?: string; cause?: { code?: string } }).code ??
    (error as { cause?: { code?: string } }).cause?.code;
  return code === '23505';
};

export type IdempotencyRunResult<T> =
  | { result: T; replayed: false }
  | { result: JsonObject; replayed: true };

/**
 * Idempotent command wrapper. `run` opens the business transaction, claims (scope, key) with
 * status `in-progress`, executes `work`, then marks the row completed with a redaction-safe
 * response snapshot (never store tokens or contact data). On a unique-conflict it re-reads the
 * row after rollback: a different payload hash → IDEMPOTENCY_PAYLOAD_MISMATCH, a still-open row
 * → IDEMPOTENCY_IN_PROGRESS, a completed row → the stored snapshot replayed.
 */
const idempotency = ({ strapi }: { strapi: Core.Strapi }) => {
  const query = () => strapi.db.query('plugin::ordering.idempotency-key');
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;

  /** Creates the claimed row. Must run inside the caller's transaction. */
  const begin = async (
    input: { scope: string; key: string; payload: unknown; ttlHours?: number },
    ctx: ServiceContext,
  ): Promise<void> => {
    const ttlHours = input.ttlHours ?? config().idempotency.ttlHours;
    const expiresAt = new Date(nowOf(ctx).getTime() + ttlHours * 3_600_000);
    try {
      await query().create({
        data: {
          scope: input.scope,
          key: input.key,
          requestHash: hashPayload(input.payload),
          status: 'in-progress',
          expiresAt,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new IdempotencyConflict(input.scope, input.key);
      throw error;
    }
  };

  /** Marks the claimed row completed. Must run inside the same transaction. */
  const complete = async (input: {
    scope: string;
    key: string;
    responseRef: string;
    responseSnapshot: JsonObject;
  }): Promise<void> => {
    await query().updateMany({
      where: { scope: input.scope, key: input.key },
      data: {
        status: 'completed',
        responseRef: input.responseRef,
        responseSnapshot: input.responseSnapshot,
      },
    });
  };

  return {
    begin,
    complete,

    async run<T>(
      input: { scope: string; key: string; payload: unknown; ttlHours?: number },
      ctx: ServiceContext,
      work: (trx: TransactionClient) => Promise<{
        result: T;
        responseRef: string;
        responseSnapshot: JsonObject;
      }>,
    ): Promise<IdempotencyRunResult<T>> {
      const requestHash = hashPayload(input.payload);
      try {
        return await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
          await begin({ ...input }, ctx);
          const { result, responseRef, responseSnapshot } = await work(trx);
          await complete({ scope: input.scope, key: input.key, responseRef, responseSnapshot });
          return { result, replayed: false as const };
        });
      } catch (error) {
        if (!(error instanceof IdempotencyConflict)) throw error;
        // The losing transaction rolled back; re-read the committed row outside it.
        const row = await query().findOne({
          where: { scope: input.scope, key: input.key },
        });
        if (!row) {
          throw new OrderingError('INTERNAL', 'idempotency conflict without a stored row', {
            cause: error,
          });
        }
        if (row.requestHash !== requestHash) {
          throw new OrderingError(
            'IDEMPOTENCY_PAYLOAD_MISMATCH',
            'idempotency key was used with a different payload',
            { details: { scope: input.scope } },
          );
        }
        if (row.status === 'in-progress') {
          throw new OrderingError(
            'IDEMPOTENCY_IN_PROGRESS',
            'a request with this idempotency key is still running',
            { details: { scope: input.scope } },
          );
        }
        return { result: row.responseSnapshot as JsonObject, replayed: true as const };
      }
    },

    /** Deletes expired rows; the Step-12 cleanup job calls this. */
    async cleanupExpired(now: Date): Promise<number> {
      const { count } = await query().deleteMany({ where: { expiresAt: { $lt: now } } });
      return count;
    },
  };
};

export default idempotency;
