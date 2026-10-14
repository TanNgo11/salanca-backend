import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { runAuditChain } from './audit-chain';
import { runAutoReject } from './auto-reject';
import { runCartExpiry } from './cart-expiry';
import { runCustomerGroupRefresh } from './customer-group-refresh';
import { runCartReminder } from './cart-reminder';
import { runDataRequestWaiting } from './data-request-waiting';
import { runGiftCardExpiry } from './gift-card-expiry';
import { runHoldExpiry } from './hold-expiry';
import { runIdempotencyCleanup } from './idempotency-cleanup';
import { runManualPaymentCheck } from './manual-confirmation';
import { runOpsCheck } from './ops-check';
import { runOutboxDispatcher } from './outbox-dispatcher';
import { runPaymentExpiry } from './payment-expiry';
import { runSepayReconciliation } from './reconciliation';
import { runWalletStatusCheck } from './wallet-status';
import { runRetention } from './retention';
import { runSlaCheck } from './sla-check';
import { runTableSessionAutoclose } from './table-session-autoclose';
import { runWebhookDispatcher } from './webhook-dispatcher';

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
  // O12: rejects groups stuck in `awaiting-acceptance` past the branch's per-kind timeout.
  { name: 'auto-reject', cronKey: 'autoRejectCron', run: runAutoReject, runnable: true },
  {
    name: 'sepay-reconciliation',
    cronKey: 'reconciliationCron',
    run: runSepayReconciliation,
    runnable: true,
  },
  { name: 'payment-expiry', cronKey: 'paymentExpiryCron', run: runPaymentExpiry, runnable: true },
  // O13: wallet catch-up — MoMo/VNPay have no list API; pending sessions are queried one by one.
  {
    name: 'wallet-status-check',
    cronKey: 'walletStatusCron',
    run: runWalletStatusCheck,
    runnable: true,
  },
  {
    name: 'manual-payment-check',
    cronKey: 'manualConfirmCron',
    run: runManualPaymentCheck,
    runnable: true,
  },
  { name: 'ops-check', cronKey: 'opsCheckCron', run: runOpsCheck, runnable: true },
  { name: 'retention', cronKey: 'retentionCron', run: runRetention, runnable: true },
  { name: 'audit-chain', cronKey: 'auditChainCron', run: runAuditChain, runnable: true },
  {
    name: 'webhook-dispatcher',
    cronKey: 'webhookDispatcherCron',
    run: runWebhookDispatcher,
    runnable: true,
  },
  // O11: server-cart lifecycle (expiry + retention + reminders) and Decree 13 erasure waits.
  { name: 'cart-expiry', cronKey: 'cartExpiryCron', run: runCartExpiry, runnable: true },
  { name: 'cart-reminder', cronKey: 'cartReminderCron', run: runCartReminder, runnable: true },
  {
    name: 'data-request-waiting',
    cronKey: 'dataRequestWaitingCron',
    run: runDataRequestWaiting,
    runnable: true,
  },
  {
    name: 'customer-group-refresh',
    cronKey: 'customerGroupRefreshCron',
    run: runCustomerGroupRefresh,
    runnable: true,
  },
  // O9: daily write-off of expired card balances (`expire` ledger rows).
  { name: 'gift-card-expiry', cronKey: 'giftCardExpiryCron', run: runGiftCardExpiry, runnable: true },
  // O12 (plan step 7): flags dine-in table sessions still open after the business day rolled
  // over — alerts only, never collects payment or closes the session.
  {
    name: 'table-session-autoclose',
    cronKey: 'tableSessionAutocloseCron',
    run: runTableSessionAutoclose,
    runnable: true,
  },
];

export const jobByName = (name: string): OrderingJob | undefined =>
  ORDERING_JOBS.find((job) => job.name === name);
