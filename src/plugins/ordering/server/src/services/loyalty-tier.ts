import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { amountFromDb } from '../domain/money';
import { DEFAULT_TIER_GROUPS, DEFAULT_TIERS, parseTierInput } from '../domain/loyalty/settings';
import type { Tier } from '../domain/loyalty/tier';
import type changeLogFactory from './change-log';
import type { ServiceContext } from './context';

const TIER = 'plugin::ordering.loyalty-tier';
const GROUP = 'plugin::ordering.customer-group';

type TierRow = {
  id: number;
  code: string;
  name: { vi?: string; en?: string } | string | null;
  minSpend12m: string | number | null;
  multiplier: number;
  customerGroupCode: string | null;
  active: boolean;
};

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value ?? fallback) as T;
};

/** `code` is what the Admin translates (validation.<path>.<code>); `message` is English for API clients. */
const invalid = (path: string, message: string, code: string): never => {
  throw new OrderingError('VALIDATION_ERROR', 'loyalty tier is invalid', {
    details: { issues: [{ path, message, code }] },
  });
};

/**
 * Loyalty tiers (O16 step 2). Tiers are switched off, never deleted, so a customer's `tierCode`
 * always resolves. The tier job (step 5) keeps the O14 group named by `customerGroupCode` in step
 * with the tier; that group must be manual-only (`auto = null`) or `refreshAuto` would fight it.
 */
const loyaltyTier = ({ strapi }: { strapi: Core.Strapi }) => {
  const tiers = () => strapi.db.query(TIER);
  const groups = () => strapi.db.query(GROUP);
  const changeLog = () => strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;

  const rowView = (row: TierRow, customerCount = 0) => ({
    id: row.id,
    code: row.code,
    name: parseJson<{ vi?: string; en?: string }>(row.name, { vi: row.code }),
    minSpend12m: amountFromDb(row.minSpend12m),
    multiplier: row.multiplier,
    customerGroupCode: row.customerGroupCode ?? null,
    active: row.active !== false,
    customerCount,
  });

  const load = async (id: number): Promise<TierRow> => {
    const row = (await tiers().findOne({ where: { id } })) as TierRow | null;
    if (!row) throw new OrderingError('LOYALTY_TIER_NOT_FOUND', 'loyalty tier not found');
    return row;
  };

  const customerCounts = async (): Promise<Map<string, number>> => {
    const { rows } = await strapi.db.connection.raw(
      `SELECT tier_code, COUNT(*)::int AS n FROM plugins_ordering_customer
       WHERE status <> 'erased' AND tier_code IS NOT NULL GROUP BY tier_code`,
    );
    return new Map((rows as Array<{ tier_code: string; n: number }>).map((row) => [row.tier_code, Number(row.n)]));
  };

  const allRows = async (): Promise<TierRow[]> =>
    (await tiers().findMany({ orderBy: { id: 'asc' } })) as TierRow[];

  /** The invariants a tier set must keep, checked against the rows as they would be after the write. */
  const assertSetValid = (rows: TierRow[]) => {
    const active = rows.filter((row) => row.active !== false);
    if (active.length === 0) invalid('active', 'at least one tier must stay active', 'last_active');
    const spends = active.map((row) => amountFromDb(row.minSpend12m));
    if (new Set(spends).size !== spends.length) {
      invalid('minSpend12m', 'active tiers need different spend thresholds', 'duplicate_threshold');
    }
    const lowest = Math.min(...spends);
    if (lowest !== 0) invalid('minSpend12m', 'the lowest active tier must start at 0', 'lowest_not_zero');
    const used = rows.filter((row) => row.customerGroupCode).map((row) => row.customerGroupCode?.toUpperCase());
    if (new Set(used).size !== used.length) {
      invalid('customerGroupCode', 'a customer group can follow only one tier', 'group_taken');
    }
  };

  const assertGroupUsable = async (code: string | null) => {
    if (!code) return;
    const { rows } = await strapi.db.connection.raw(
      `SELECT id, auto FROM plugins_ordering_customer_group WHERE upper(code) = upper(?)`,
      [code],
    );
    const group = (rows as Array<{ id: number; auto: unknown }>)[0];
    if (!group) invalid('customerGroupCode', 'customer group does not exist', 'group_missing');
    if (parseJson(group.auto, null) !== null) {
      invalid('customerGroupCode', 'the group is filled by an automatic rule; pick a manual group', 'group_auto');
    }
  };

  return {
    /** Active tiers in the shape the pure tier rules use. */
    async activeTiers(): Promise<Tier[]> {
      return (await allRows())
        .filter((row) => row.active !== false)
        .map((row) => ({
          code: row.code,
          minSpend12m: amountFromDb(row.minSpend12m),
          multiplier: row.multiplier,
          active: true,
        }));
    },

    /** Every tier, including inactive ones, for Admin and tier-name lookups. */
    async allTiers() {
      return (await allRows()).map((row) => rowView(row));
    },

    async list() {
      const [rows, counts] = await Promise.all([allRows(), customerCounts()]);
      return {
        items: rows
          .map((row) => rowView(row, counts.get(row.code) ?? 0))
          .sort((a, b) => a.minSpend12m - b.minSpend12m || a.id - b.id),
      };
    },

    async get(id: number) {
      const [row, counts] = await Promise.all([load(id), customerCounts()]);
      return { item: rowView(row, counts.get(row.code) ?? 0) };
    },

    async create(raw: unknown, ctx: ServiceContext) {
      const input = parseTierInput(raw);
      const existing = await allRows();
      if (existing.some((row) => row.code === input.code)) invalid('code', 'tier code is already used', 'taken');
      await assertGroupUsable(input.customerGroupCode);
      const candidate = { id: -1, ...input, minSpend12m: input.minSpend12m } as unknown as TierRow;
      assertSetValid([...existing, candidate]);
      const created = (await tiers().create({ data: input })) as TierRow;
      await changeLog().record(
        {
          action: 'loyalty.tier.create',
          entityType: 'loyalty-tier',
          entityId: created.id,
          entityLabel: input.code,
          after: {
            minSpend12m: input.minSpend12m,
            multiplier: input.multiplier,
            customerGroupCode: input.customerGroupCode,
            active: input.active,
          },
        },
        ctx,
      );
      return this.get(created.id);
    },

    async update(id: number, raw: unknown, ctx: ServiceContext) {
      const before = await load(id);
      const input = parseTierInput({ ...(raw as object), code: before.code });
      const existing = await allRows();
      await assertGroupUsable(input.customerGroupCode);
      const candidate = { ...before, ...input } as unknown as TierRow;
      assertSetValid(existing.map((row) => (row.id === id ? candidate : row)));
      await tiers().update({
        where: { id },
        data: {
          name: input.name,
          minSpend12m: input.minSpend12m,
          multiplier: input.multiplier,
          customerGroupCode: input.customerGroupCode,
          active: input.active,
        },
      });
      await changeLog().record(
        {
          action: 'loyalty.tier.update',
          entityType: 'loyalty-tier',
          entityId: id,
          entityLabel: before.code,
          before: {
            minSpend12m: amountFromDb(before.minSpend12m),
            multiplier: before.multiplier,
            customerGroupCode: before.customerGroupCode,
            active: before.active !== false,
          },
          after: {
            minSpend12m: input.minSpend12m,
            multiplier: input.multiplier,
            customerGroupCode: input.customerGroupCode,
            active: input.active,
          },
        },
        ctx,
      );
      return this.get(id);
    },

    /**
     * Seeds the three default tiers and their two O14 groups the first time the program is saved.
     * Idempotent: does nothing once any tier exists (tiers are never deleted), and a group is
     * created only when no group already uses its code.
     */
    async ensureDefaults(): Promise<{ created: number }> {
      if ((await allRows()).length > 0) return { created: 0 };
      for (const group of DEFAULT_TIER_GROUPS) {
        const { rows } = await strapi.db.connection.raw(
          `SELECT id FROM plugins_ordering_customer_group WHERE upper(code) = upper(?)`,
          [group.code],
        );
        if ((rows as unknown[]).length === 0) {
          await groups().create({ data: { code: group.code, name: group.name, auto: null, active: true } });
        }
      }
      let created = 0;
      for (const tier of DEFAULT_TIERS) {
        await tiers().create({ data: tier });
        created += 1;
      }
      return { created };
    },
  };
};

export default loyaltyTier;
