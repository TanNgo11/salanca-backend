import { hostname } from 'node:os';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from './config';
import { runHoldExpiry } from './jobs/hold-expiry';
import { runIdempotencyCleanup } from './jobs/idempotency-cleanup';
import { runOutboxDispatcher } from './jobs/outbox-dispatcher';
import { orderingMigrations } from './migrations';
import { persistOrderingTables } from './migrations/persisted-tables';
import { runOrderingMigrations } from './migrations/runner';
import { assertEnabledCodesRegistered, type OrderingRegistry } from './services/registry';

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const config = strapi.config.get('plugin::ordering') as OrderingConfig;
  const registry = strapi.plugin('ordering').service('registry') as OrderingRegistry;

  // The validator runs before any register(), so code references can only be checked here.
  assertEnabledCodesRegistered(config, registry);

  // Reserve ordering tables in the core store BEFORE migrations run — otherwise a later
  // boot with ORDERING_ENABLED=false would drop every plugins_ordering_* table (schema
  // sync removes tables that were in the previous stored schema but not the current one).
  const added = await persistOrderingTables(strapi);
  if (added.length > 0) {
    strapi.log.info(`[ordering] persisted ${added.length} tables`);
  }
  await runOrderingMigrations(strapi, orderingMigrations);

  if (config.jobs.enabled) {
    const owner = `${hostname()}:${process.pid}`;
    const wrap =
      (name: string, run: () => Promise<unknown>) =>
      async () => {
        try {
          await run();
        } catch (error) {
          strapi.log.warn(
            `[ordering] job ${name} failed: ${(error as Error)?.message ?? error}`,
          );
        }
      };
    // Shape from @strapi/core services/cron.js: { <taskName>: { task, options } } — options go
    // straight to node-schedule's Job.schedule, so { rule } carries the cron expression.
    strapi.cron.add({
      'ordering.outbox': {
        task: wrap('outbox', () => runOutboxDispatcher(strapi, { owner })),
        options: { rule: config.jobs.outboxCron },
      },
      'ordering.hold-expiry': {
        task: wrap('hold-expiry', () => runHoldExpiry(strapi, { owner })),
        options: { rule: config.jobs.holdExpiryCron },
      },
      'ordering.idempotency-cleanup': {
        task: wrap('idempotency-cleanup', () => runIdempotencyCleanup(strapi, { owner })),
        options: { rule: config.jobs.idempotencyCleanupCron },
      },
    });
    strapi.log.info(`[ordering] jobs scheduled as ${owner}`);
  }

  strapi.log.info(
    `[ordering] lifecycle: plugin bootstrap; catalog adapters: ${registry.catalogAdapterCodes().join(', ')}`,
  );
};

export default bootstrap;
