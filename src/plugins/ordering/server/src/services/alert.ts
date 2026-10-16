import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { scopeIncludes } from '../domain/scope';
import type { AlertRule } from './alert-rules';
import type alertRulesFactory from './alert-rules';
import { FALLBACK_RULE } from './alert-rules';
import type outboxFactory from './outbox';
import type scopeFactory from './scope';
import { actorRefOf, nowOf } from './context';
import type { ServiceContext } from './context';

const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string }).code === '23505' ||
  (error as { cause?: { code?: string } }).cause?.code === '23505';

type AlertRow = {
  id: number;
  alertCode: string;
  dedupeKey: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  aggregateRef: string | null;
  locationRef: string | null;
  count: number;
  firstSeenAt: string | Date;
  lastSeenAt: string | Date;
  resolvedAt: string | Date | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | Date | null;
};

export type OpenInput = {
  alertCode: string;
  dedupeKey: string;
  severity?: 'info' | 'warning' | 'critical';
  aggregateRef?: string;
  locationRef?: string;
};

export type OpenResult = { id: number; opened: boolean; escalated: boolean };

/** Saleor-style bound: keep the newest 500 alert rows, pruning the oldest resolved ones. */
const MAX_ROWS = 500;

const MINUTE_MS = 60_000;

/**
 * Rules whose `count` is a count of real occurrences (each `open` is one more bad webhook,
 * unmatched transfer, failed reconciliation row or mismatched closing), so `criticalThreshold`
 * compares with `count`. Every other rule is opened again on each run of a periodic check
 * (ops-check, sla-check, manual-payment-check), where `count` only counts runs; those callers
 * measure their own unit (minutes, periods, hours, SLA multiples) and pass `severity`.
 */
const COUNT_ESCALATED = new Set([
  'webhook-failing',
  'payment-unmatched',
  'reconciliation-mismatch',
  'cash-closing-mismatch',
  'notification-template-broken',
  'gift-card-probing',
]);

/**
 * Operational alerts (contracts §12, §19.9; O6 step 1). One open alert per `dedupeKey` — the
 * partial unique index from migration 0001 makes concurrent openers converge on the same row,
 * which only bumps `count`/`lastSeenAt`. Behaviour follows the Saleor `AppProblem` model:
 *
 * - a disabled rule records and sends nothing;
 * - an open/acknowledged row only bumps `count` (acknowledged blocks re-notifying at the same
 *   severity but never blocks escalation to critical);
 * - crossing `criticalThreshold` (count-based rules only, see COUNT_ESCALATED) or a caller-passed
 *   `severity: 'critical'` escalates once via the `ops-alert.escalated` outbox event;
 * - the newest `resolved` row inside the rule's `aggregationMinutes` window is reopened silently
 *   (anti-flapping — no email), outside it a new row + `ops-alert.opened` is created;
 * - the table is capped at 500 rows, pruning the oldest resolved first.
 */
const alert = ({ strapi }: { strapi: Core.Strapi }) => {
  const alerts = () => strapi.db.query('plugin::ordering.ops-alert');
  const outbox = () => strapi.plugin('ordering').service('outbox') as ReturnType<typeof outboxFactory>;
  const rules = () =>
    strapi.plugin('ordering').service('alert-rules') as ReturnType<typeof alertRulesFactory>;
  const scope = () => strapi.plugin('ordering').service('scope') as ReturnType<typeof scopeFactory>;

  const enqueueEvent = (
    type: 'ops-alert.opened' | 'ops-alert.escalated',
    row: AlertRow,
    ctx: ServiceContext,
    uniqueSuffix?: string,
  ) =>
    outbox().enqueue(
      {
        type,
        aggregateType: 'ops-alert',
        aggregateId: String(row.id),
        payload: {
          alertId: row.id,
          alertCode: row.alertCode,
          aggregateRef: row.aggregateRef,
          locationRef: row.locationRef,
          severity: row.severity,
          count: row.count,
        },
        uniqueKey: `${type}:${row.id}${uniqueSuffix ?? ''}`,
      },
      ctx,
    );

  /**
   * Escalates a live row to critical when the new count reaches `criticalThreshold` or the caller
   * asserts critical — emails once via `ops-alert.escalated`, including on acknowledged rows.
   */
  const maybeEscalate = async (
    row: AlertRow,
    input: OpenInput,
    rule: AlertRule,
    ctx: ServiceContext,
  ): Promise<boolean> => {
    const reached =
      COUNT_ESCALATED.has(row.alertCode) &&
      rule.criticalThreshold !== undefined &&
      row.count >= rule.criticalThreshold;
    if ((!reached && input.severity !== 'critical') || row.severity === 'critical') return false;
    await alerts().update({ where: { id: row.id }, data: { severity: 'critical' } });
    await enqueueEvent(
      'ops-alert.escalated',
      { ...row, severity: 'critical' },
      ctx,
      `:${row.count}`,
    );
    return true;
  };

  /** Bumps a live (open/acknowledged) row and escalates when the rule says so. */
  const bumpLive = async (
    row: AlertRow,
    input: OpenInput,
    rule: AlertRule,
    ctx: ServiceContext,
    now: Date,
  ): Promise<OpenResult> => {
    const count = row.count + 1;
    await alerts().update({ where: { id: row.id }, data: { count, lastSeenAt: now } });
    const escalated = await maybeEscalate({ ...row, count }, input, rule, ctx);
    return { id: row.id, opened: false, escalated };
  };

  /** Keeps the table under MAX_ROWS by dropping the oldest resolved rows first. */
  const pruneResolved = async (): Promise<void> => {
    const total = await alerts().count({});
    if (total <= MAX_ROWS) return;
    const stale = (await alerts().findMany({
      where: { status: 'resolved' },
      orderBy: { resolvedAt: 'asc' },
      select: ['id'],
      limit: total - MAX_ROWS,
    })) as Array<{ id: number }>;
    if (stale.length > 0) {
      await alerts().deleteMany({ where: { id: { $in: stale.map((row) => row.id) } } });
    }
  };

  const service = {
    async open(input: OpenInput, ctx: ServiceContext): Promise<OpenResult> {
      const rule = await rules().ruleOf(input.alertCode);
      if (!rule.enabled) return { id: 0, opened: false, escalated: false };
      const now = nowOf(ctx);
      const live = (await alerts().findOne({
        where: { dedupeKey: input.dedupeKey, status: { $in: ['open', 'acknowledged'] } },
        orderBy: { lastSeenAt: 'desc' },
      })) as AlertRow | null;
      if (live) return bumpLive(live, input, rule, ctx, now);

      // Anti-flapping: a recently resolved row of the same key reopens silently inside the
      // aggregation window instead of paging the recipients again.
      const resolved = (await alerts().findOne({
        where: { dedupeKey: input.dedupeKey, status: 'resolved' },
        orderBy: { resolvedAt: 'desc' },
      })) as AlertRow | null;
      if (
        resolved?.resolvedAt &&
        now.getTime() - new Date(resolved.resolvedAt).getTime() <= rule.aggregationMinutes * MINUTE_MS
      ) {
        await alerts().update({
          where: { id: resolved.id },
          data: {
            status: 'open',
            resolvedAt: null,
            acknowledgedBy: null,
            acknowledgedAt: null,
            count: resolved.count + 1,
            lastSeenAt: now,
            ...(input.severity === 'critical' && resolved.severity !== 'critical'
              ? { severity: 'critical' as const }
              : {}),
          },
        });
        return { id: resolved.id, opened: false, escalated: false };
      }

      try {
        return await strapi.db.transaction(async () => {
          const row = (await alerts().create({
            data: {
              alertCode: input.alertCode,
              dedupeKey: input.dedupeKey,
              severity: input.severity ?? 'warning',
              aggregateRef: input.aggregateRef ?? null,
              locationRef: input.locationRef ?? null,
              status: 'open',
              firstSeenAt: now,
              lastSeenAt: now,
              count: 1,
            },
          })) as AlertRow;
          await enqueueEvent('ops-alert.opened', row, ctx);
          await pruneResolved();
          return { id: row.id, opened: true, escalated: false };
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const winner = (await alerts().findOne({
          where: { dedupeKey: input.dedupeKey, status: { $in: ['open', 'acknowledged'] } },
          orderBy: { lastSeenAt: 'desc' },
        })) as AlertRow | null;
        if (!winner) throw error;
        return bumpLive(winner, input, rule, ctx, now);
      }
    },

    /** Resolves the live alerts of a key once its condition is gone (e.g. the order was accepted). */
    async resolve(dedupeKey: string, ctx: ServiceContext): Promise<boolean> {
      const { count } = await alerts().updateMany({
        where: { dedupeKey, status: { $in: ['open', 'acknowledged'] } },
        data: { status: 'resolved', resolvedAt: nowOf(ctx) },
      });
      return count > 0;
    },

    /** Staff presses "Đã biết": open → acknowledged (who/when recorded), resolved → 409. */
    async acknowledge(id: number, ctx: ServiceContext): Promise<AlertRow> {
      const row = (await alerts().findOne({ where: { id } })) as AlertRow | null;
      if (!row) {
        throw new OrderingError('ALERT_NOT_FOUND', 'alert not found', { details: { id } });
      }
      if (row.status !== 'open') {
        throw new OrderingError('INVALID_TRANSITION', 'alert is not open', {
          details: { id, status: row.status },
        });
      }
      return (await alerts().update({
        where: { id },
        data: { status: 'acknowledged', acknowledgedBy: actorRefOf(ctx), acknowledgedAt: nowOf(ctx) },
      })) as AlertRow;
    },

    /**
     * Admin list query, newest activity first. `locationRefs`/`codes` narrow the result; 'all'
     * (or undefined) means unfiltered.
     */
    async list(input: {
      status?: string;
      locationRefs?: string[] | 'all';
      codes?: string[] | 'all';
      page?: number;
      pageSize?: number;
    }): Promise<{ rows: AlertRow[]; total: number }> {
      const where: Record<string, unknown> = {};
      if (input.status) where.status = input.status;
      if (input.locationRefs && input.locationRefs !== 'all') {
        where.locationRef = { $in: input.locationRefs };
      }
      if (input.codes && input.codes !== 'all') {
        where.alertCode = { $in: input.codes };
      }
      const pageSize = Math.min(input.pageSize ?? 25, 100);
      const page = input.page ?? 1;
      const [rows, total] = await Promise.all([
        alerts().findMany({
          where,
          orderBy: { lastSeenAt: 'desc' },
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        alerts().count({ where }),
      ]);
      return { rows: rows as AlertRow[], total: Number(total) };
    },

    /** Ordering actions the staff actor holds (from `admin_permissions` via their roles). */
    async staffActions(ctx: ServiceContext): Promise<Set<string>> {
      if (ctx.actor.kind !== 'staff') return new Set();
      const permissions = (await strapi.db.query('admin::permission').findMany({
        where: {
          action: { $startsWith: 'plugin::ordering.' },
          role: { users: { id: ctx.actor.adminUserId } },
        },
        select: ['action'],
      })) as Array<{ action: string }>;
      return new Set(permissions.map((row) => row.action.slice('plugin::ordering.'.length)));
    },
  };

  /**
   * Rule codes a staff member may see: `ops.read` (or super admin) sees everything; otherwise a
   * rule is visible when one of its recipients is an action the user holds — 'branch-email'
   * rules map to branch staff, i.e. `order.read` holders.
   */
  const visibleCodes = async (ctx: ServiceContext): Promise<string[] | 'all'> => {
    if (ctx.actor.kind === 'staff' && ctx.actor.isSuperAdmin) return 'all';
    const actions = await service.staffActions(ctx);
    if (actions.has('ops.read')) return 'all';
    const all = await rules().get();
    return Object.entries(all)
      .filter(
        ([, rule]) =>
          rule.recipients.some((recipient) => actions.has(recipient)) ||
          (rule.recipients.includes('branch-email') && actions.has('order.read')),
      )
      .map(([code]) => code);
  };

  /**
   * `list` + acknowledge for admin staff: rule-recipient match first, then the location scope
   * (alerts without a locationRef pass on the action match alone).
   */
  const staffFilter = async (
    ctx: ServiceContext,
  ): Promise<{ codes: string[] | 'all'; locationRef: Record<string, unknown> | null }> => {
    const codes = await visibleCodes(ctx);
    const seesAll = codes === 'all';
    const locationScope = seesAll
      ? null
      : await scope().loadScope(ctx);
    const locationRef =
      seesAll || locationScope?.allLocations
        ? null
        : locationScope
          ? { $or: [{ locationRef: null }, { locationRef: { $in: locationScope.locationRefs } }] }
          : { locationRef: null };
    return { codes, locationRef };
  };

  const withRules = async (
    rows: AlertRow[],
  ): Promise<Array<AlertRow & { recipients: string[] }>> => {
    const all = await rules().get();
    return rows.map((row) => ({
      ...row,
      recipients: (all[row.alertCode as keyof typeof all] ?? FALLBACK_RULE).recipients,
    }));
  };

  const adminService = {
    async listForStaff(
      query: { status?: string; page?: number; pageSize?: number },
      ctx: ServiceContext,
    ): Promise<{ rows: Array<AlertRow & { recipients: string[] }>; total: number; page: number; pageSize: number }> {
      const pageSize = Math.min(query.pageSize ?? 25, 100);
      const page = query.page ?? 1;
      const filter = await staffFilter(ctx);
      const where: Record<string, unknown> = {};
      if (query.status) where.status = query.status;
      if (filter.codes !== 'all') where.alertCode = { $in: filter.codes };
      if (filter.locationRef) Object.assign(where, filter.locationRef);
      const [rows, total] = await Promise.all([
        alerts().findMany({
          where,
          orderBy: { lastSeenAt: 'desc' },
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        alerts().count({ where }),
      ]);
      return { rows: await withRules(rows as AlertRow[]), total: Number(total), page, pageSize };
    },

    /** Same visibility rule as the list; anything else deliberately answers ALERT_NOT_FOUND. */
    async acknowledgeForStaff(id: number, ctx: ServiceContext): Promise<AlertRow> {
      const row = (await alerts().findOne({ where: { id } })) as AlertRow | null;
      if (!row) {
        throw new OrderingError('ALERT_NOT_FOUND', 'alert not found', { details: { id } });
      }
      if (ctx.actor.kind === 'staff' && !ctx.actor.isSuperAdmin) {
        const codes = await visibleCodes(ctx);
        if (codes !== 'all' && !codes.includes(row.alertCode)) {
          throw new OrderingError('ALERT_NOT_FOUND', 'alert not found', { details: { id } });
        }
        if (row.locationRef && codes !== 'all') {
          const locationScope = await scope().loadScope(ctx);
          if (!scopeIncludes(locationScope, row.locationRef)) {
            throw new OrderingError('ALERT_NOT_FOUND', 'alert not found', { details: { id } });
          }
        }
      }
      return service.acknowledge(id, ctx);
    },
  };

  const store = () => strapi.store({ type: 'plugin', name: 'ordering' });
  const failureCount = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
  };

  /**
   * Rolling 24h sample log for the P4 error rate. Timestamps only — provider payload and
   * customer data never reach the store.
   */
  const noteWebhookSample = async (
    providerCode: string,
    ok: boolean,
    ctx: ServiceContext,
  ): Promise<void> => {
    const key = `webhook-events-24h:${providerCode}`;
    const raw = await store().get({ key });
    const cutoff = nowOf(ctx).getTime() - 24 * 60 * 60 * 1000;
    const samples = (Array.isArray(raw) ? raw : [])
      .filter((entry) => {
        const at = (entry as { at?: unknown }).at;
        return typeof at === 'string' && new Date(at).getTime() >= cutoff;
      })
      .slice(-499);
    samples.push({ at: nowOf(ctx).toISOString(), ok });
    await store().set({ key, value: samples });
  };

  /**
   * `rule.threshold` bad signatures in a row open `webhook-failing:<provider>`; a good webhook
   * resets it. `webhook-last-failure`/`webhook-last-success` feed the ops screen (O6 step 2).
   */
  const noteWebhookFailure = async (
    providerCode: string,
    ctx: ServiceContext,
  ): Promise<{ failures: number; opened: boolean; escalated: boolean }> => {
    await noteWebhookSample(providerCode, false, ctx);
    const storeKey = `webhook-failures:${providerCode}`;
    const failures = failureCount(await store().get({ key: storeKey })) + 1;
    await store().set({ key: storeKey, value: String(failures) });
    await store().set({
      key: `webhook-last-failure:${providerCode}`,
      value: nowOf(ctx).toISOString(),
    });
    const rule = await rules().ruleOf('webhook-failing');
    if (failures < rule.threshold) return { failures, opened: false, escalated: false };
    const severity =
      rule.criticalThreshold !== undefined && failures >= rule.criticalThreshold
        ? 'critical'
        : 'warning';
    const result = await service.open(
      {
        alertCode: 'webhook-failing',
        dedupeKey: `webhook-failing:${providerCode}`,
        severity,
        aggregateRef: `provider:${providerCode}`,
      },
      ctx,
    );
    return { failures, opened: result.opened, escalated: result.escalated };
  };

  const noteWebhookSuccess = async (providerCode: string, ctx: ServiceContext): Promise<void> => {
    await noteWebhookSample(providerCode, true, ctx);
    await store().set({ key: `webhook-failures:${providerCode}`, value: '0' });
    await store().set({
      key: `webhook-last-success:${providerCode}`,
      value: nowOf(ctx).toISOString(),
    });
    await service.resolve(`webhook-failing:${providerCode}`, ctx);
  };

  /** One open alert per provider while unmatched transfers keep arriving. */
  const noteUnmatched = async (
    providerCode: string,
    ctx: ServiceContext,
  ): Promise<OpenResult> =>
    service.open(
      {
        alertCode: 'payment-unmatched',
        dedupeKey: `payment-unmatched:${providerCode}`,
        severity: 'warning',
        aggregateRef: `provider:${providerCode}`,
      },
      ctx,
    );

  /** One open alert per provider transaction the reconciliation could not apply. */
  const noteReconciliationMismatch = async (
    input: { providerCode: string; providerTransactionId: string },
    ctx: ServiceContext,
  ): Promise<OpenResult> =>
    service.open(
      {
        alertCode: 'reconciliation-mismatch',
        dedupeKey: `reconciliation-mismatch:${input.providerCode}:${input.providerTransactionId}`,
        severity: 'warning',
        aggregateRef: `provider:${input.providerCode}`,
      },
      ctx,
    );

  /**
   * Core-sales provider recovery: a carrier book/cancel call may already have reached the
   * provider while its result could not be stored locally. Always critical — the leg stays
   * blocked and only staff can prove what the carrier holds. One alert per operation key.
   */
  const noteCarrierOperationUnknown = async (
    input: { operationKey: string; orderId: number },
    ctx: ServiceContext,
  ): Promise<OpenResult> =>
    service.open(
      {
        alertCode: 'carrier-operation-unknown',
        dedupeKey: `carrier-operation-unknown:${input.operationKey}`,
        severity: 'critical',
        aggregateRef: `order:${input.orderId}`,
      },
      ctx,
    );

  /** The operation reached a known end state, so its alert is no longer true. */
  const resolveCarrierOperation = (operationKey: string, ctx: ServiceContext): Promise<boolean> =>
    service.resolve(`carrier-operation-unknown:${operationKey}`, ctx);

  return {
    ...service,
    ...adminService,
    noteWebhookFailure,
    noteWebhookSuccess,
    noteUnmatched,
    noteReconciliationMismatch,
    noteCarrierOperationUnknown,
    resolveCarrierOperation,
  };
};

export default alert;
