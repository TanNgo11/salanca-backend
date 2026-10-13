import { createHash } from 'node:crypto';

/**
 * Tamper-evidence for the admin change log (O15). Each row's `hash` covers its own content plus
 * the previous row's hash, in id order. Hashes are filled by the `audit-chain` job after the
 * writing transaction committed — writers never take a global lock.
 */
export const GENESIS_HASH = 'genesis';

export type ChainRow = {
  id: number;
  actorRef: string;
  action: string;
  entityType: string;
  entityId: string;
  locationRef: string | null;
  occurredAt: string | Date;
  changes: unknown;
  category: string | null;
  entityLabel: string | null;
  orderId: number | null;
  requestId: string | null;
};

/** JSON with object keys sorted at every level — stable across drivers and key order. */
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
};

const iso = (value: string | Date): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

/** `changes` read through raw SQL arrives as a JSON string; the ORM returns an object. */
const parsed = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const rowHash = (prevHash: string, row: ChainRow): string =>
  createHash('sha256')
    .update(prevHash)
    .update('\n')
    .update(
      canonicalJson({
        id: row.id,
        actorRef: row.actorRef,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        locationRef: row.locationRef ?? null,
        occurredAt: iso(row.occurredAt),
        changes: parsed(row.changes),
        category: row.category ?? null,
        entityLabel: row.entityLabel ?? null,
        orderId: row.orderId ?? null,
        requestId: row.requestId ?? null,
      }),
    )
    .digest('hex');
