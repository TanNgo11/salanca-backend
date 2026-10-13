import type { Core } from '@strapi/strapi';

import { ORDER_EXPORT_MAX_DAYS, ORDER_EXPORT_MAX_ROWS } from '../../../shared/export-limits';
import { AUDIT_CATEGORIES, auditLabelOf } from '../domain/audit/actions';
import { buildCsv } from '../domain/csv';
import { OrderingError } from '../domain/errors';
import type { LocationScope } from '../domain/scope';
import type { ServiceContext } from './context';
import type scopeFactory from './scope';

const TABLE = 'plugins_ordering_admin_change_log';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Log days are read in Vietnam time — every Salanca branch uses it; the screen says so. */
const DAY_OFFSET = '+07:00';
const MAX_LIST_DAYS = 366;
const PAGE_SIZE = 50;

export type AuditLogQuery = {
  from?: string;
  to?: string;
  actor?: string;
  category?: string;
  action?: string;
  branch?: string;
  q?: string;
  page?: number;
  locale?: string;
};

type Row = {
  id: number;
  occurred_at: string | Date;
  actor_ref: string;
  action: string;
  category: string | null;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  location_ref: string | null;
  order_id: number | null;
  request_id: string | null;
  changes: unknown;
};

const dayOf = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new OrderingError('VALIDATION_ERROR', `${field} must be YYYY-MM-DD`, { details: { field } });
  }
  return value;
};

const spanDays = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const parsedJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const iso = (value: string | Date): string => (value instanceof Date ? value : new Date(value)).toISOString();

/**
 * O15 audit-log reader. Rows tied to a branch follow the caller's location scope; rows without a
 * branch (settings, scopes, jobs, catalog) are visible to `allLocations` staff only.
 */
const auditLog = ({ strapi }: { strapi: Core.Strapi }) => {
  const knex = () => strapi.db.connection;
  const scope = () => strapi.plugin('ordering').service('scope') as ReturnType<typeof scopeFactory>;

  const callerScope = async (ctx: ServiceContext): Promise<LocationScope> => {
    const loaded = await scope().loadScope(ctx);
    if (!loaded) throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
    return loaded;
  };

  /** Shared filtered query (no paging); `maxDays` bounds the range. */
  const filtered = async (query: AuditLogQuery, ctx: ServiceContext, maxDays: number) => {
    const to = query.to ? dayOf(query.to, 'to') : new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const from = query.from
      ? dayOf(query.from, 'from')
      : new Date(Date.parse(`${to}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
    if (from > to || spanDays(from, to) > maxDays) {
      throw new OrderingError('VALIDATION_ERROR', `range must be at most ${maxDays} days`, {
        details: { field: 'to' },
      });
    }
    if (query.category && !(AUDIT_CATEGORIES as readonly string[]).includes(query.category)) {
      throw new OrderingError('VALIDATION_ERROR', 'unknown category', { details: { field: 'category' } });
    }
    const staffScope = await callerScope(ctx);
    const builder = knex()(TABLE)
      .where('occurred_at', '>=', `${from}T00:00:00${DAY_OFFSET}`)
      .where('occurred_at', '<', knex().raw(`?::timestamptz + interval '1 day'`, [`${to}T00:00:00${DAY_OFFSET}`]));
    if (!staffScope.allLocations) {
      builder.whereIn('location_ref', staffScope.locationRefs);
    }
    if (query.branch) {
      if (!staffScope.allLocations && !staffScope.locationRefs.includes(query.branch)) {
        throw new OrderingError('BRANCH_NOT_FOUND', 'branch not found');
      }
      builder.where('location_ref', query.branch);
    }
    if (query.actor) builder.where('actor_ref', query.actor);
    if (query.category) builder.where('category', query.category);
    if (query.action) builder.where('action', query.action);
    const q = query.q?.trim();
    if (q) {
      const order = (await knex()('plugins_ordering_order')
        .whereRaw('upper(code) = upper(?)', [q])
        .first('id')) as { id: number } | undefined;
      builder.where((inner) => {
        inner.whereILike('entity_label', `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`).orWhere('entity_id', q);
        if (order) inner.orWhere('order_id', order.id);
      });
    }
    return { builder, from, to };
  };

  const decorate = async (rows: Row[], locale: string | undefined) => {
    const adminIds = [
      ...new Set(
        rows
          .map((row) => /^admin:(\d+)$/.exec(row.actor_ref)?.[1])
          .filter((id): id is string => Boolean(id))
          .map(Number),
      ),
    ];
    const names = new Map<string, string>();
    if (adminIds.length > 0) {
      const users = (await strapi.db.query('admin::user').findMany({
        where: { id: { $in: adminIds } },
        select: ['id', 'firstname', 'lastname'],
      })) as Array<{ id: number; firstname?: string | null; lastname?: string | null }>;
      for (const user of users) {
        names.set(`admin:${user.id}`, [user.firstname, user.lastname].filter(Boolean).join(' '));
      }
    }
    const orderIds = [
      ...new Set(rows.filter((row) => row.order_id !== null && !row.entity_label).map((row) => Number(row.order_id))),
    ];
    const codes = new Map<number, string>();
    if (orderIds.length > 0) {
      const orders = (await knex()('plugins_ordering_order').whereIn('id', orderIds).select('id', 'code')) as Array<{
        id: number;
        code: string;
      }>;
      for (const order of orders) codes.set(Number(order.id), order.code);
    }
    return rows.map((row) => ({
      id: Number(row.id),
      occurredAt: iso(row.occurred_at),
      actorRef: row.actor_ref,
      actorName: names.get(row.actor_ref) || null,
      action: row.action,
      actionLabel: auditLabelOf(row.action, locale),
      category: row.category ?? 'other',
      entityType: row.entity_type,
      entityId: row.entity_id,
      entityLabel: row.entity_label ?? (row.order_id !== null ? codes.get(Number(row.order_id)) ?? null : null),
      locationRef: row.location_ref,
      orderId: row.order_id === null ? null : Number(row.order_id),
      requestId: row.request_id,
      changes: parsedJson(row.changes) as Record<string, { before: unknown; after: unknown }>,
    }));
  };

  const COLUMNS = [
    'id',
    'occurred_at',
    'actor_ref',
    'action',
    'category',
    'entity_type',
    'entity_id',
    'entity_label',
    'location_ref',
    'order_id',
    'request_id',
    'changes',
  ];

  return {
    async list(query: AuditLogQuery, ctx: ServiceContext) {
      const { builder, from, to } = await filtered(query, ctx, MAX_LIST_DAYS);
      const page = Math.max(1, query.page ?? 1);
      const rows = (await builder
        .clone()
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .offset((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE + 1)
        .select(COLUMNS)) as Row[];
      return {
        range: { from, to },
        page,
        pageSize: PAGE_SIZE,
        hasNext: rows.length > PAGE_SIZE,
        rows: await decorate(rows.slice(0, PAGE_SIZE), query.locale),
      };
    },

    /** One row + every row of the same admin request (e.g. cancel + refund + stock release). */
    async detail(id: number, query: { locale?: string }, ctx: ServiceContext) {
      const staffScope = await callerScope(ctx);
      const row = (await knex()(TABLE).where({ id }).first(COLUMNS)) as Row | undefined;
      const visible = (candidate: Row) =>
        staffScope.allLocations ||
        (candidate.location_ref !== null && staffScope.locationRefs.includes(candidate.location_ref));
      if (!row || !visible(row)) {
        throw new OrderingError('AUDIT_ENTRY_NOT_FOUND', 'audit entry not found', { details: { id } });
      }
      const siblings = row.request_id
        ? ((await knex()(TABLE)
            .where({ request_id: row.request_id })
            .whereNot({ id })
            .orderBy('id', 'asc')
            .limit(50)
            .select(COLUMNS)) as Row[]).filter(visible)
        : [];
      const [entry, ...related] = await decorate([row, ...siblings], query.locale);
      return { entry, related };
    },

    /** People who appear in the visible log (for the actor filter). */
    async actors(ctx: ServiceContext) {
      const staffScope = await callerScope(ctx);
      const builder = knex()(TABLE).distinct('actor_ref');
      if (!staffScope.allLocations) builder.whereIn('location_ref', staffScope.locationRefs);
      const refs = ((await builder.limit(500)) as Array<{ actor_ref: string }>).map((row) => row.actor_ref);
      const decorated = await decorate(
        refs.map((ref, index) => ({
          id: index,
          occurred_at: new Date(0),
          actor_ref: ref,
          action: '',
          category: null,
          entity_type: '',
          entity_id: '',
          entity_label: null,
          location_ref: null,
          order_id: null,
          request_id: null,
          changes: {},
        })),
        undefined,
      );
      return decorated
        .map((row) => ({ ref: row.actorRef, name: row.actorName }))
        .sort((a, b) => (a.name ?? a.ref).localeCompare(b.name ?? b.ref));
    },

    async exportCsv(query: AuditLogQuery, ctx: ServiceContext) {
      const { builder, from, to } = await filtered(query, ctx, ORDER_EXPORT_MAX_DAYS);
      const count = Number(((await builder.clone().count('* as n').first()) as { n: string | number }).n);
      if (count > ORDER_EXPORT_MAX_ROWS) {
        throw new OrderingError('EXPORT_TOO_LARGE', 'export exceeds the row limit', {
          details: { rowCount: count, maxRows: ORDER_EXPORT_MAX_ROWS },
        });
      }
      const rows = await decorate(
        (await builder.clone().orderBy('occurred_at', 'asc').orderBy('id', 'asc').select(COLUMNS)) as Row[],
        query.locale,
      );
      const vi = !query.locale?.toLowerCase().startsWith('en');
      const headers = vi
        ? ['Lúc', 'Người', 'Mã người', 'Thao tác', 'Nhóm', 'Đối tượng', 'Mã đối tượng', 'Chi nhánh', 'Thay đổi']
        : ['At', 'Actor', 'Actor ref', 'Action', 'Category', 'Entity', 'Entity id', 'Branch', 'Changes'];
      const cells = rows.map((row) => [
        row.occurredAt,
        row.actorName ?? '',
        row.actorRef,
        row.actionLabel,
        row.category,
        row.entityLabel ?? row.entityType,
        row.entityId,
        row.locationRef ?? '',
        JSON.stringify(row.changes ?? {}),
      ]);
      strapi.log.info(`[ordering] audit export rows=${rows.length} range=${from}..${to}`);
      return { csv: buildCsv(headers, cells), fileName: `lich-su-thay-doi-${from}_${to}.csv`, rowCount: rows.length };
    },
  };
};

export default auditLog;
