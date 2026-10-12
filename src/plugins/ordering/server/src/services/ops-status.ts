import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { OrderingError } from '../domain/errors';
import { SIGNED_WEBHOOK_CAPABILITY } from '../domain/raw-body';
import { jobByName, ORDERING_JOBS } from '../jobs/catalog';
import type alertRulesFactory from './alert-rules';
import type changeLogFactory from './change-log';
import { actorRefOf } from './context';
import type { ServiceContext } from './context';
import type outboxFactory from './outbox';
import type { OrderingRegistry } from './registry';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const FAILED_OUTBOX_LIMIT = 50;

type JobLockRow = {
  jobName: string;
  expiresAt: string | Date | null;
  lastRunAt: string | Date | null;
  lastDurationMs: number | null;
  lastSuccessAt: string | Date | null;
  lastError: string | null;
};

type OutboxRow = {
  id: number;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  attempts: number;
  failedAt: string | Date | null;
  lastError: string | null;
};

type CronSpec = { name?: string | null; job?: { nextInvocation?: () => Date | null } };

/** `strapi.cron.jobs` is the live `jobsSpecs` array from @strapi/core services/cron.js. */
const nextInvocationOf = (strapi: Core.Strapi, taskName: string): string | null => {
  try {
    const specs = ((strapi.cron as unknown as { jobs?: CronSpec[] }).jobs ?? []) as CronSpec[];
    const spec = specs.find((item) => item.name === taskName);
    const next = spec?.job?.nextInvocation?.();
    return next instanceof Date ? next.toISOString() : null;
  } catch {
    return null; // nextInvocation is best-effort; the row just reports null (screens V1).
  }
};

const toIso = (value: string | Date | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

/**
 * "Tình trạng vận hành" (screens V1, contracts §19.3): one read for the status cards, job table
 * and failed-outbox tab, plus the two staff actions (run a job now, retry a failed event). All
 * fields carry refs and counters only — never payload or customer data.
 */
const opsStatus = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const outbox = () => plugin().service('outbox') as ReturnType<typeof outboxFactory>;
  const alertRules = () => plugin().service('alert-rules') as ReturnType<typeof alertRulesFactory>;
  const registry = () => plugin().service('registry') as OrderingRegistry;
  const changeLog = () => plugin().service('change-log') as ReturnType<typeof changeLogFactory>;
  const store = () => strapi.store({ type: 'plugin', name: 'ordering' });
  const locks = () => strapi.db.query('plugin::ordering.order-job-lock');

  const status = async () => {
    const config = strapi.config.get('plugin::ordering') as OrderingConfig;
    const now = new Date();
    const [stats, stuckRule, webhookRule] = await Promise.all([
      outbox().pendingStats(),
      alertRules().ruleOf('outbox-stuck'),
      alertRules().ruleOf('webhook-failing'),
    ]);
    const oldestAgeMinutes = stats.oldestAvailableAt
      ? Math.max(0, (now.getTime() - new Date(stats.oldestAvailableAt).getTime()) / MINUTE_MS)
      : 0;

    // Every provider that accepts signed webhooks (sepay today) gets a health row; the
    // last-good/last-bad stamps come from noteWebhookSuccess/Failure (alert.ts).
    const webhooks = await Promise.all(
      registry()
        .paymentProviders()
        .filter((provider) => provider.capabilities.includes(SIGNED_WEBHOOK_CAPABILITY))
        .map(async (provider) => {
          const code = provider.code;
          const [lastSuccess, lastFailure, failures] = await Promise.all([
            store().get({ key: `webhook-last-success:${code}` }),
            store().get({ key: `webhook-last-failure:${code}` }),
            store().get({ key: `webhook-failures:${code}` }),
          ]);
          const consecutiveFailures = Number(failures) || 0;
          const lastSuccessAt = typeof lastSuccess === 'string' ? lastSuccess : null;
          const stale =
            lastSuccessAt !== null &&
            now.getTime() - new Date(lastSuccessAt).getTime() > 24 * HOUR_MS;
          return {
            providerCode: code,
            lastSuccessAt,
            lastFailureAt: typeof lastFailure === 'string' ? lastFailure : null,
            consecutiveFailures,
            state: (consecutiveFailures >= webhookRule.threshold
              ? 'failing'
              : stale
                ? 'slow'
                : 'ok') as 'ok' | 'slow' | 'failing',
          };
        }),
    );

    const reconciliationLock = (await locks().findOne({
      where: { jobName: 'sepay-reconciliation', shardKey: 'default' },
    })) as JobLockRow | null;

    const [openAlerts, criticalAlerts] = await Promise.all([
      strapi.db.query('plugin::ordering.ops-alert').count({
        where: { status: { $in: ['open', 'acknowledged'] } },
      }),
      strapi.db.query('plugin::ordering.ops-alert').count({
        where: { status: { $in: ['open', 'acknowledged'] }, severity: 'critical' },
      }),
    ]);

    const lockRows = (await locks().findMany({ where: { shardKey: 'default' } })) as JobLockRow[];
    const lockOf = new Map(lockRows.map((row) => [row.jobName, row]));
    const jobs = ORDERING_JOBS.map((entry) => {
      const row = lockOf.get(entry.name);
      return {
        name: entry.name,
        cron: String(config.jobs[entry.cronKey] ?? ''),
        lastRunAt: toIso(row?.lastRunAt),
        lastSuccessAt: toIso(row?.lastSuccessAt),
        lastDurationMs: row?.lastDurationMs ?? null,
        lastError: row?.lastError ? row.lastError.slice(0, 200) : null,
        nextRunAt: nextInvocationOf(strapi, `ordering.${entry.name}`),
        locked: Boolean(row?.expiresAt && new Date(row.expiresAt).getTime() > now.getTime()),
        runnable: entry.runnable,
      };
    });

    const failedRows = (await strapi.db.query('plugin::ordering.outbox').findMany({
      where: { failedAt: { $notNull: true } },
      orderBy: { failedAt: 'desc' },
      limit: FAILED_OUTBOX_LIMIT,
    })) as OutboxRow[];
    // Order codes for the "Mã đơn" column — order aggregates or payloads carrying orderId.
    const orderIds = [
      ...new Set(
        failedRows
          .map((row) =>
            row.aggregateType === 'order'
              ? Number(row.aggregateId)
              : Number(row.payload?.orderId),
          )
          .filter((id) => Number.isSafeInteger(id) && id > 0),
      ),
    ];
    const codeOf = new Map<number, string>();
    if (orderIds.length > 0) {
      const orders = (await strapi.db.query('plugin::ordering.order').findMany({
        where: { id: { $in: orderIds } },
        select: ['id', 'code'],
      })) as Array<{ id: number; code: string }>;
      for (const order of orders) codeOf.set(order.id, order.code);
    }
    const failedOutbox = failedRows.map((row) => {
      const orderId =
        row.aggregateType === 'order' ? Number(row.aggregateId) : Number(row.payload?.orderId);
      return {
        id: row.id,
        type: row.type,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        orderCode: Number.isSafeInteger(orderId) ? (codeOf.get(orderId) ?? null) : null,
        attempts: row.attempts,
        failedAt: toIso(row.failedAt),
        lastError: row.lastError,
      };
    });

    return {
      now: now.toISOString(),
      outbox: {
        pending: stats.pending,
        oldestAvailableAt: stats.oldestAvailableAt,
        oldestAgeMinutes,
        failed: stats.failed,
        thresholdMinutes: stuckRule.threshold,
        stuck: oldestAgeMinutes > stuckRule.threshold || stats.failed > 0,
      },
      webhooks,
      reconciliation: {
        lastSuccessAt: toIso(reconciliationLock?.lastSuccessAt),
        nextRunAt: nextInvocationOf(strapi, 'ordering.sepay-reconciliation'),
        enabled: registry().hasPaymentProvider('sepay'),
      },
      alerts: { open: Number(openAlerts), critical: Number(criticalAlerts) },
      jobs,
      failedOutbox,
    };
  };

  return {
    status,

    /** "Chạy ngay": any catalog job is safe to re-run; a held lock answers `ran:false` (200). */
    async runJob(name: string, ctx: ServiceContext): Promise<{ name: string; result: unknown }> {
      const job = jobByName(name);
      if (!job || !job.runnable) {
        throw new OrderingError('JOB_NOT_FOUND', 'job not found', { details: { name } });
      }
      const result = await job.run(strapi, { owner: actorRefOf(ctx) });
      await changeLog().record(
        { action: 'ops.job-run', entityType: 'job', entityId: name },
        ctx,
      );
      return { name, result };
    },

    /**
     * Failed rows go back to the pending pool: lease cleared, attempts reset (the row already
     * spent its retries once — a manual retry is a fresh chance), `last_error` kept for context.
     */
    async retryOutbox(id: number, ctx: ServiceContext): Promise<{ id: number; availableAt: string }> {
      const events = strapi.db.query('plugin::ordering.outbox');
      const row = (await events.findOne({ where: { id } })) as OutboxRow | null;
      if (!row) {
        throw new OrderingError('OUTBOX_EVENT_NOT_FOUND', 'outbox event not found', {
          details: { id },
        });
      }
      if (row.failedAt === null) {
        throw new OrderingError('INVALID_TRANSITION', 'outbox event is not failed', {
          details: { id },
        });
      }
      const availableAt = new Date().toISOString();
      await events.update({
        where: { id },
        data: {
          failedAt: null,
          availableAt: new Date(availableAt),
          attempts: 0,
          leaseUntil: null,
          lockedBy: null,
          lockedAt: null,
        },
      });
      await changeLog().record(
        { action: 'ops.outbox-retry', entityType: 'outbox', entityId: id },
        ctx,
      );
      return { id, availableAt };
    },
  };
};

export default opsStatus;
