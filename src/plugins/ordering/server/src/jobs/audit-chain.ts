import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { type ChainRow, GENESIS_HASH, rowHash } from '../domain/audit/chain';
import type alertFactory from '../services/alert';
import type { ServiceContext } from '../services/context';
import type jobLockFactory from '../services/job-lock';

const TABLE = 'plugins_ordering_admin_change_log';
const COLUMNS = [
  'id',
  'actor_ref',
  'action',
  'entity_type',
  'entity_id',
  'location_ref',
  'occurred_at',
  'changes',
  'category',
  'entity_label',
  'order_id',
  'request_id',
  'prev_hash',
  'hash',
];

type RawRow = {
  id: number;
  actor_ref: string;
  action: string;
  entity_type: string;
  entity_id: string;
  location_ref: string | null;
  occurred_at: string | Date;
  changes: unknown;
  category: string | null;
  entity_label: string | null;
  order_id: number | null;
  request_id: string | null;
  prev_hash: string | null;
  hash: string | null;
};

const toChainRow = (row: RawRow): ChainRow => ({
  id: Number(row.id),
  actorRef: row.actor_ref,
  action: row.action,
  entityType: row.entity_type,
  entityId: row.entity_id,
  locationRef: row.location_ref,
  occurredAt: row.occurred_at,
  changes: row.changes,
  category: row.category,
  entityLabel: row.entity_label,
  orderId: row.order_id === null ? null : Number(row.order_id),
  requestId: row.request_id,
});

export type AuditChainResult = {
  ran: boolean;
  hashed: number;
  verified: number;
  broken: number[];
};

/**
 * O15 tamper evidence for `admin-change-log`. Writers never lock: this job fills `prevHash`/`hash`
 * after commit, linking each unhashed row (id order, older than `settleSeconds`) to the current
 * chain tip. A row committed late (lower id than the tip) simply links to the tip — the chain is a
 * tree, every link still points at an existing hash. Verification recomputes the newest rows plus
 * a random sample and checks every `prevHash` still exists; any failure opens `audit-tampered`.
 */
export const runAuditChain = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<AuditChainResult> => {
  const config = (strapi.config.get('plugin::ordering') as OrderingConfig).audit;
  if (!config.hashChain) return { ran: false, hashed: 0, verified: 0, broken: [] };
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const alerts = plugin.service('alert') as ReturnType<typeof alertFactory>;
  const now = options.now ?? new Date();
  const ctx: ServiceContext = { actor: { kind: 'system', actorRef: 'job:audit-chain' }, now };
  const knex = strapi.db.connection;

  const outcome = await jobLock.withLock(
    { jobName: 'audit-chain', owner: options.owner, now },
    async () => {
      // ── Fill ────────────────────────────────────────────────────────────────
      const tip = (await knex(TABLE)
        .whereNotNull('hash')
        .orderBy('id', 'desc')
        .first('hash')) as { hash: string } | undefined;
      let prev = tip?.hash ?? GENESIS_HASH;
      const settledBefore = new Date(now.getTime() - config.settleSeconds * 1000);
      let hashed = 0;
      for (let batch = 0; batch < config.maxBatchesPerRun; batch += 1) {
        const rows = (await knex(TABLE)
          .whereNull('hash')
          .where('created_at', '<', settledBefore)
          .orderBy('id', 'asc')
          .limit(config.batchSize)
          .select(COLUMNS)) as RawRow[];
        if (rows.length === 0) break;
        for (const row of rows) {
          const hash = rowHash(prev, toChainRow(row));
          await knex(TABLE)
            .where({ id: row.id })
            .whereNull('hash')
            .update({ prev_hash: prev, hash });
          prev = hash;
          hashed += 1;
        }
      }

      // ── Verify ──────────────────────────────────────────────────────────────
      const recent = (await knex(TABLE)
        .whereNotNull('hash')
        .orderBy('id', 'desc')
        .limit(config.verifyRecent)
        .select(COLUMNS)) as RawRow[];
      const sample =
        config.verifySample > 0
          ? ((await knex(TABLE)
              .whereNotNull('hash')
              .orderByRaw('random()')
              .limit(config.verifySample)
              .select(COLUMNS)) as RawRow[])
          : [];
      const checked = new Map<number, RawRow>();
      for (const row of [...recent, ...sample]) checked.set(Number(row.id), row);
      const broken = new Set<number>();
      const links = new Set<string>();
      for (const row of checked.values()) {
        const prevHash = row.prev_hash ?? '';
        if (rowHash(prevHash, toChainRow(row)) !== row.hash) broken.add(Number(row.id));
        if (prevHash !== GENESIS_HASH) links.add(prevHash);
      }
      if (links.size > 0) {
        const found = new Set(
          ((await knex(TABLE).whereIn('hash', [...links]).select('hash')) as Array<{ hash: string }>).map(
            (row) => row.hash,
          ),
        );
        for (const row of checked.values()) {
          const prevHash = row.prev_hash ?? '';
          if (prevHash !== GENESIS_HASH && !found.has(prevHash)) broken.add(Number(row.id));
        }
      }
      const brokenIds = [...broken].sort((a, b) => a - b);
      if (brokenIds.length > 0) {
        await alerts.open(
          {
            alertCode: 'audit-tampered',
            dedupeKey: 'audit-tampered',
            severity: 'critical',
            aggregateRef: `change-log:${brokenIds[0]}`,
          },
          ctx,
        );
      }
      strapi.log.info(
        `[ordering] audit-chain hashed=${hashed} verified=${checked.size} broken=${brokenIds.length}`,
      );
      return { hashed, verified: checked.size, broken: brokenIds };
    },
  );

  return outcome.ran
    ? { ran: true, ...(outcome.result as Omit<AuditChainResult, 'ran'>) }
    : { ran: false, hashed: 0, verified: 0, broken: [] };
};
