import { randomBytes } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import type { TransactionClient } from '../migrations/runner';

const LIMIT_UID = 'plugin::ordering.catalog-daily-limit';
const RESERVATION_UID = 'plugin::ordering.catalog-daily-reservation';
const LIMIT = 'plugins_ordering_catalog_daily_limit';
const USAGE = 'plugins_ordering_catalog_daily_usage';
const RESERVATION = 'plugins_ordering_catalog_daily_reservation';
const ORDER_LINK = 'plugins_ordering_catalog_daily_reservation_order_lnk';
const LINE_LINK = 'plugins_ordering_catalog_daily_reservation_line_lnk';

const ENTITY_TYPES = ['product', 'variant', 'modifier'] as const;

export type DailyEntityType = (typeof ENTITY_TYPES)[number];

export type DailyEntityRef = {
  entityType: DailyEntityType;
  entityDocumentId: string;
};

export type DailyReservationItem = DailyEntityRef & {
  lineId: number;
  quantity: number;
  /** Copied onto ITEM_SOLD_OUT so the storefront can point at the cart line. */
  sellableUid?: string;
  variantUid?: string;
  modifierUid?: string;
};

export type DailyRemaining = {
  dailyLimit: number;
  reserved: number;
  remaining: number;
};

type UsageRow = {
  entity_type: DailyEntityType;
  entity_document_id: string;
  location_ref: string;
  business_date: unknown;
  quantity: number;
  released_quantity: number;
  id: number;
};

const documentId = () => randomBytes(18).toString('base64url').slice(0, 24);

const entityKey = (entityType: string, entityDocumentId: string) =>
  `${entityType}\u0000${entityDocumentId}`;

const asDate = (value: unknown): string => {
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  throw new OrderingError('INTERNAL', 'daily stock date was not a date');
};

const asInt = (value: unknown): number => {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new OrderingError('INTERNAL', 'daily stock counter was not an integer');
  }
  return number;
};

const assertDate = (businessDate: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new OrderingError('VALIDATION_ERROR', 'businessDate must be YYYY-MM-DD');
  }
};

const assertRef = (ref: DailyEntityRef) => {
  if (!ENTITY_TYPES.includes(ref.entityType)) {
    throw new OrderingError('VALIDATION_ERROR', 'entityType is not a daily-stock entity');
  }
  if (typeof ref.entityDocumentId !== 'string' || ref.entityDocumentId.length === 0) {
    throw new OrderingError('VALIDATION_ERROR', 'entityDocumentId is required');
  }
};

const assertPositiveInt = (value: number, message: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new OrderingError('VALIDATION_ERROR', message);
  }
};

const rowsOf = (result: { rows?: UsageRow[] }): UsageRow[] => result.rows ?? [];

/**
 * Daily portion ledger. Call `reserveInTransaction` / `releaseFor*` from inside
 * `strapi.db.transaction` and pass that callback's `trx`: the conditional upsert
 * and the release update run on `trx`, and `db.query` joins the same transaction
 * through AsyncLocalStorage. Entities are locked in key order so two reserves
 * cannot deadlock. An entity with no limit row is unlimited and is skipped.
 */
const dailyStock = ({ strapi }: { strapi: Core.Strapi }) => {
  const reservations = () => strapi.db.query(RESERVATION_UID);
  const limits = () => strapi.db.query(LIMIT_UID);

  const lockLimit = async (
    trx: TransactionClient,
    locationRef: string,
    ref: DailyEntityRef,
  ): Promise<number | null> => {
    const { rows } = await trx.raw(
      `SELECT daily_limit FROM ${LIMIT}
       WHERE entity_type = ? AND entity_document_id = ? AND location_ref = ?
       FOR UPDATE`,
      [ref.entityType, ref.entityDocumentId, locationRef],
    );
    if (!rows?.length) return null;
    return asInt(rows[0].daily_limit);
  };

  const readReserved = async (
    trx: TransactionClient,
    locationRef: string,
    businessDate: string,
    ref: DailyEntityRef,
  ): Promise<number> => {
    const { rows } = await trx.raw(
      `SELECT reserved FROM ${USAGE}
       WHERE entity_type = ? AND entity_document_id = ? AND location_ref = ? AND business_date = ?::date`,
      [ref.entityType, ref.entityDocumentId, locationRef, businessDate],
    );
    if (!rows?.length) return 0;
    return asInt(rows[0].reserved);
  };

  const upsertUsage = async (
    trx: TransactionClient,
    locationRef: string,
    businessDate: string,
    ref: DailyEntityRef,
    quantity: number,
    limit: number,
  ): Promise<number | null> => {
    const now = new Date();
    const { rows } = await trx.raw(
      `INSERT INTO ${USAGE}
         (entity_type, entity_document_id, location_ref, business_date, reserved, document_id, created_at, updated_at)
       SELECT ?, ?, ?, ?::date, ?, ?, ?, ?
       WHERE ? <= ?
       ON CONFLICT (entity_type, entity_document_id, location_ref, business_date)
       DO UPDATE SET
         reserved = ${USAGE}.reserved + EXCLUDED.reserved,
         updated_at = EXCLUDED.updated_at
       WHERE ${USAGE}.reserved + EXCLUDED.reserved <= ?
       RETURNING reserved`,
      [
        ref.entityType,
        ref.entityDocumentId,
        locationRef,
        businessDate,
        quantity,
        documentId(),
        now,
        now,
        quantity,
        limit,
        limit,
      ],
    );
    if (!rows?.length) return null;
    return asInt(rows[0].reserved);
  };

  const loadReservations = async (
    trx: TransactionClient,
    linkTable: string,
    linkColumn: string,
    id: number,
  ): Promise<UsageRow[]> => {
    const result = await trx.raw(
      `SELECT r.id, r.entity_type, r.entity_document_id, r.location_ref, r.business_date,
              r.quantity, r.released_quantity
       FROM ${RESERVATION} r
       JOIN ${linkTable} lnk ON lnk.catalog_daily_reservation_id = r.id
       WHERE lnk.${linkColumn} = ?
       ORDER BY r.id
       FOR UPDATE OF r`,
      [id],
    );
    return rowsOf(result);
  };

  const releaseRows = async (
    trx: TransactionClient,
    rows: UsageRow[],
    cap: number | null,
  ): Promise<number> => {
    const groups = new Map<string, UsageRow[]>();
    for (const row of rows) {
      const key = [
        row.entity_type,
        row.entity_document_id,
        row.location_ref,
        asDate(row.business_date),
      ].join('\u0000');
      const list = groups.get(key);
      if (list) list.push(row);
      else groups.set(key, [row]);
    }
    let released = 0;
    for (const key of [...groups.keys()].sort()) {
      const group = groups.get(key) ?? [];
      let left = cap ?? Number.POSITIVE_INFINITY;
      let usageDelta = 0;
      for (const row of group) {
        if (left <= 0) break;
        const room = asInt(row.quantity) - asInt(row.released_quantity);
        const delta = Math.min(left, room);
        if (delta <= 0) continue;
        const { rows: updated } = await trx.raw(
          `UPDATE ${RESERVATION}
           SET released_quantity = released_quantity + ?, updated_at = ?
           WHERE id = ? AND released_quantity + ? <= quantity
           RETURNING id`,
          [delta, new Date(), row.id, delta],
        );
        if (!updated?.length) continue;
        left -= delta;
        usageDelta += delta;
        released += delta;
      }
      if (usageDelta <= 0) continue;
      const sample = group[0];
      const { rows: usage } = await trx.raw(
        `UPDATE ${USAGE}
         SET reserved = reserved - ?, updated_at = ?
         WHERE entity_type = ? AND entity_document_id = ? AND location_ref = ?
           AND business_date = ?::date
           AND reserved >= ?
         RETURNING reserved`,
        [
          usageDelta,
          new Date(),
          sample.entity_type,
          sample.entity_document_id,
          sample.location_ref,
          asDate(sample.business_date),
          usageDelta,
        ],
      );
      if (!usage?.length) {
        throw new OrderingError('INTERNAL', 'daily usage underflow');
      }
    }
    return released;
  };

  return {
    async limitsFor(locationRef: string, refs: DailyEntityRef[]): Promise<Map<string, number>> {
      const found = new Map<string, number>();
      if (refs.length === 0) return found;
      for (const ref of refs) assertRef(ref);
      const rows = (await limits().findMany({
        where: {
          locationRef,
          $or: refs.map((ref) => ({
            entityType: ref.entityType,
            entityDocumentId: ref.entityDocumentId,
          })),
        },
      })) as Array<DailyEntityRef & { dailyLimit: number }>;
      for (const row of rows) {
        found.set(entityKey(row.entityType, row.entityDocumentId), asInt(row.dailyLimit));
      }
      return found;
    },

    async remaining(
      locationRef: string,
      businessDate: string,
      refs: DailyEntityRef[],
    ): Promise<Map<string, DailyRemaining>> {
      assertDate(businessDate);
      const found = new Map<string, DailyRemaining>();
      if (refs.length === 0) return found;
      for (const ref of refs) assertRef(ref);
      const tuples = refs.map(() => '(?, ?)').join(', ');
      const bindings: Array<string> = [businessDate, locationRef];
      for (const ref of refs) bindings.push(ref.entityType, ref.entityDocumentId);
      const { rows } = await strapi.db.connection.raw(
        `SELECT l.entity_type, l.entity_document_id, l.daily_limit,
                COALESCE(u.reserved, 0) AS reserved
         FROM ${LIMIT} l
         LEFT JOIN ${USAGE} u
           ON u.entity_type = l.entity_type
          AND u.entity_document_id = l.entity_document_id
          AND u.location_ref = l.location_ref
          AND u.business_date = ?::date
         WHERE l.location_ref = ?
           AND (l.entity_type, l.entity_document_id) IN (${tuples})`,
        bindings,
      );
      for (const row of rows ?? []) {
        const dailyLimit = asInt(row.daily_limit);
        const reserved = asInt(row.reserved);
        found.set(entityKey(row.entity_type, row.entity_document_id), {
          dailyLimit,
          reserved,
          remaining: Math.max(0, dailyLimit - reserved),
        });
      }
      return found;
    },

    async reserveInTransaction(
      trx: TransactionClient,
      input: {
        orderId: number;
        locationRef: string;
        businessDate: string;
        items: DailyReservationItem[];
      },
    ): Promise<
      Array<DailyEntityRef & { quantity: number; usageReserved: number }>
    > {
      assertPositiveInt(input.orderId, 'orderId must be a positive integer');
      if (typeof input.locationRef !== 'string' || input.locationRef.length === 0) {
        throw new OrderingError('VALIDATION_ERROR', 'locationRef is required');
      }
      assertDate(input.businessDate);
      const grouped = new Map<
        string,
        DailyEntityRef & { quantity: number; items: DailyReservationItem[] }
      >();
      for (const item of input.items) {
        assertRef(item);
        assertPositiveInt(item.lineId, 'lineId must be a positive integer');
        assertPositiveInt(item.quantity, 'quantity must be a positive integer');
        const key = entityKey(item.entityType, item.entityDocumentId);
        const existing = grouped.get(key);
        if (existing) {
          existing.quantity += item.quantity;
          existing.items.push(item);
        } else {
          grouped.set(key, {
            entityType: item.entityType,
            entityDocumentId: item.entityDocumentId,
            quantity: item.quantity,
            items: [item],
          });
        }
      }

      const reserved: Array<DailyEntityRef & { quantity: number; usageReserved: number }> = [];
      for (const key of [...grouped.keys()].sort()) {
        const group = grouped.get(key);
        if (!group) continue;
        const limit = await lockLimit(trx, input.locationRef, group);
        if (limit === null) continue;
        const usageReserved = await upsertUsage(
          trx,
          input.locationRef,
          input.businessDate,
          group,
          group.quantity,
          limit,
        );
        if (usageReserved === null) {
          const already = await readReserved(trx, input.locationRef, input.businessDate, group);
          const sample = group.items[0];
          throw new OrderingError('ITEM_SOLD_OUT', 'sold out for the business day', {
            details: {
              entityType: group.entityType,
              entityDocumentId: group.entityDocumentId,
              locationRef: input.locationRef,
              remaining: Math.max(0, limit - already),
              businessDate: input.businessDate,
              ...(sample?.sellableUid ? { sellableUid: sample.sellableUid } : {}),
              ...(sample?.variantUid ? { variantUid: sample.variantUid } : {}),
              ...(sample?.modifierUid ? { modifierUid: sample.modifierUid } : {}),
            },
          });
        }
        for (const item of group.items) {
          await reservations().create({
            data: {
              order: input.orderId,
              line: item.lineId,
              entityType: item.entityType,
              entityDocumentId: item.entityDocumentId,
              locationRef: input.locationRef,
              businessDate: input.businessDate,
              quantity: item.quantity,
              releasedQuantity: 0,
            },
          });
        }
        reserved.push({
          entityType: group.entityType,
          entityDocumentId: group.entityDocumentId,
          quantity: group.quantity,
          usageReserved,
        });
      }
      return reserved;
    },

    /**
     * Returns every still-held portion of the order. A second call releases
     * nothing. `reason` is required so the caller can put the same text on the
     * timeline; the ledger itself has no reason column.
     */
    async releaseForOrder(
      trx: TransactionClient,
      orderId: number,
      reason: string,
    ): Promise<{ released: number }> {
      assertPositiveInt(orderId, 'orderId must be a positive integer');
      if (typeof reason !== 'string' || reason.trim().length === 0) {
        throw new OrderingError('VALIDATION_ERROR', 'release reason is required');
      }
      const rows = await loadReservations(trx, ORDER_LINK, 'order_id', orderId);
      return { released: await releaseRows(trx, rows, null) };
    },

    /** Returns up to `quantity` still-held portions of each entity on the line. */
    async releaseForLine(
      trx: TransactionClient,
      lineId: number,
      quantity: number,
    ): Promise<{ released: number }> {
      assertPositiveInt(lineId, 'lineId must be a positive integer');
      assertPositiveInt(quantity, 'quantity must be a positive integer');
      const rows = await loadReservations(trx, LINE_LINK, 'order_line_id', lineId);
      return { released: await releaseRows(trx, rows, quantity) };
    },

    /**
     * Inverse of `releaseForOrder` (audit O-08): re-acquires the released portions of an order
     * under the same daily-limit rows so a reopened order holds its stock again. Throws
     * `ITEM_SOLD_OUT` when another order has consumed the released units — the caller rolls
     * back, so a reopen that cannot keep its stock leaves nothing behind. Lock order matches
     * `reserveInTransaction` (entity keys ascending) so it cannot deadlock against a new order.
     */
    async restoreForOrder(
      trx: TransactionClient,
      orderId: number,
    ): Promise<{ restored: number }> {
      assertPositiveInt(orderId, 'orderId must be a positive integer');
      const rows = await loadReservations(trx, ORDER_LINK, 'order_id', orderId);
      const grouped = new Map<
        string,
        {
          ref: DailyEntityRef;
          locationRef: string;
          businessDate: string;
          release: number;
          rows: UsageRow[];
        }
      >();
      for (const row of rows) {
        // The portion to restore is what cancellation released, not what is still held.
        const room = asInt(row.released_quantity);
        if (room <= 0) continue;
        const businessDate = asDate(row.business_date);
        const key = [row.entity_type, row.entity_document_id, row.location_ref, businessDate].join('\u0000');
        const existing = grouped.get(key);
        if (existing) {
          existing.release += room;
          existing.rows.push(row);
        } else {
          grouped.set(key, {
            ref: { entityType: row.entity_type, entityDocumentId: row.entity_document_id },
            locationRef: row.location_ref,
            businessDate,
            release: room,
            rows: [row],
          });
        }
      }
      let restored = 0;
      for (const key of [...grouped.keys()].sort()) {
        const group = grouped.get(key);
        if (!group) continue;
        const limit = await lockLimit(trx, group.locationRef, group.ref);
        if (limit !== null) {
          const reserved = await upsertUsage(
            trx,
            group.locationRef,
            group.businessDate,
            group.ref,
            group.release,
            limit,
          );
          if (reserved === null) {
            const already = await readReserved(trx, group.locationRef, group.businessDate, group.ref);
            throw new OrderingError('ITEM_SOLD_OUT', 'sold out for the business day', {
              details: {
                entityType: group.ref.entityType,
                entityDocumentId: group.ref.entityDocumentId,
                locationRef: group.locationRef,
                remaining: Math.max(0, limit - already),
                businessDate: group.businessDate,
              },
            });
          }
        }
        let left = group.release;
        for (const row of group.rows) {
          if (left <= 0) break;
          const delta = Math.min(left, asInt(row.released_quantity));
          if (delta <= 0) continue;
          await trx.raw(
            `UPDATE ${RESERVATION}
             SET released_quantity = released_quantity - ?, updated_at = ?
             WHERE id = ? AND released_quantity >= ?
             RETURNING id`,
            [delta, new Date(), row.id, delta],
          );
          left -= delta;
          restored += delta;
        }
      }
      return { restored };
    },
  };
};

export default dailyStock;
