import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { runAuditChain } from './audit-chain';
import { runHoldExpiry } from './hold-expiry';
import { runIdempotencyCleanup } from './idempotency-cleanup';
import { runManualPaymentCheck } from './manual-confirmation';
import { runOpsCheck } from './ops-check';
import { runOutboxDispatcher } from './outbox-dispatcher';
import { runPaymentExpiry } from './payment-expiry';
import { runSepayReconciliation } from './reconciliation';
import { runRetention } from './retention';
import { runSlaCheck } from './sla-check';

export type JobRun = (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
) => Promise<unknown>;

export type OrderingJob = {
  /** Job-lock row name and the `ordering.<name>` cron task name. */
  name: string;
  /** Key into `config.jobs` holding the cron expression. */
  cronKey: keyof OrderingConfig['jobs'] & string;
  run: JobRun;
  /**
   * Safe to trigger from Admin ("Chạy ngay"): every ordering job is idempotent — locked jobs
   * simply report `ran:false`, the dispatcher is concurrency-safe by design.
   */
  runnable: boolean;
};

/**
 * The scheduled jobs (screens V1 job table, ops-check heartbeats, step 6 retention job appends
 * here). Bootstrap registers `ordering.<name>` for each entry, `ops-status` reads it for the
 * job table, and `POST /ops/jobs/:name/run` looks it up for manual runs.
 */
export const ORDERING_JOBS: OrderingJob[] = [
  { name: 'outbox', cronKey: 'outboxCron', run: runOutboxDispatcher, runnable: true },
  { name: 'hold-expiry', cronKey: 'holdExpiryCron', run: runHoldExpiry, runnable: true },
  {
    name: 'idempotency-cleanup',
    cronKey: 'idempotencyCleanupCron',
    run: runIdempotencyCleanup,
    runnable: true,
  },
  { name: 'sla-check', cronKey: 'slaCheckCron', run: runSlaCheck, runnable: true },
  {
    name: 'sepay-reconciliation',
    cronKey: 'reconciliationCron',
    run: runSepayReconciliation,
    runnable: true,
  },
  { name: 'payment-expiry', cronKey: 'paymentExpiryCron', run: runPaymentExpiry, runnable: true },
  {
    name: 'manual-payment-check',
    cronKey: 'manualConfirmCron',
    run: runManualPaymentCheck,
    runnable: true,
  },
  { name: 'ops-check', cronKey: 'opsCheckCron', run: runOpsCheck, runnable: true },
  { name: 'retention', cronKey: 'retentionCron', run: runRetention, runnable: true },
  { name: 'audit-chain', cronKey: 'auditChainCron', run: runAuditChain, runnable: true },
];

export const jobByName = (name: string): OrderingJob | undefined =>
  ORDERING_JOBS.find((job) => job.name === name);
