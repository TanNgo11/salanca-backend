import { hostname } from 'node:os';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from './config';
import { runHoldExpiry } from './jobs/hold-expiry';
import { runIdempotencyCleanup } from './jobs/idempotency-cleanup';
import { runOutboxDispatcher } from './jobs/outbox-dispatcher';
import { runManualPaymentCheck } from './jobs/manual-confirmation';
import { runOpsCheck } from './jobs/ops-check';
import { runPaymentExpiry } from './jobs/payment-expiry';
import { runSepayReconciliation } from './jobs/reconciliation';
import { runSlaCheck } from './jobs/sla-check';
import { orderingMigrations } from './migrations';
import { persistOrderingTables } from './migrations/persisted-tables';
import { runOrderingMigrations } from './migrations/runner';
import { assertSignedWebhooksHaveRawBody } from './domain/raw-body';
import type adminUnitsFactory from './services/admin-units';
import { parseEncryptionKey } from './domain/token-cipher';
import { assertEnabledCodesRegistered, type OrderingRegistry } from './services/registry';

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const config = strapi.config.get('plugin::ordering') as OrderingConfig;
  const registry = strapi.plugin('ordering').service('registry') as OrderingRegistry;

  // The validator runs before any register(), so code references can only be checked here.
  assertEnabledCodesRegistered(config, registry);
  // A signed webhook provider without the original body would silently fail every signature.
  assertSignedWebhooksHaveRawBody({
    providers: registry.paymentProviders().map((provider) => ({
      code: provider.code,
      capabilities: provider.capabilities,
      enabled: config.providers.payment[provider.code]?.enabled === true,
    })),
    middlewares: strapi.config.get('middlewares'),
  });

  const captcha = config.storefront.captchaProvider;
  if (captcha && !registry.hasCaptchaProvider(captcha)) {
    throw new Error(`[ordering] storefront.captchaProvider "${captcha}" is not registered`);
  }
  if (!captcha && process.env.NODE_ENV === 'production') {
    strapi.log.warn('[ordering] storefront captcha is disabled; order creation and lookup are bot-exposed');
  }

  // contracts §21.10: the order token is kept encrypted for idempotent replays. Production must
  // boot with a valid key; elsewhere a missing key only warns and order creation refuses.
  const key = parseEncryptionKey(config.encryptionKey);
  if (!key.valid) {
    const message = `[ordering] encryptionKey ${key.reason === 'missing' ? 'is not set' : 'must be 32 bytes, base64'} (ORDERING_ENCRYPTION_KEY)`;
    if (process.env.NODE_ENV === 'production') throw new Error(message);
    strapi.log.warn(`${message}; order creation is disabled until it is configured`);
  }

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
      'ordering.sla-check': {
        task: wrap('sla-check', () => runSlaCheck(strapi, { owner })),
        options: { rule: config.jobs.slaCheckCron },
      },
      'ordering.sepay-reconciliation': {
        task: wrap('sepay-reconciliation', () => runSepayReconciliation(strapi, { owner })),
        options: { rule: config.jobs.reconciliationCron },
      },
      'ordering.payment-expiry': {
        task: wrap('payment-expiry', () => runPaymentExpiry(strapi, { owner })),
        options: { rule: config.jobs.paymentExpiryCron },
      },
      'ordering.manual-payment-check': {
        task: wrap('manual-payment-check', () => runManualPaymentCheck(strapi, { owner })),
        options: { rule: config.jobs.manualConfirmCron },
      },
      'ordering.ops-check': {
        task: wrap('ops-check', () => runOpsCheck(strapi, { owner })),
        options: { rule: config.jobs.opsCheckCron },
      },
    });
    strapi.log.info(`[ordering] jobs scheduled as ${owner}`);
  }

  const units = strapi.plugin('ordering').service('admin-units') as ReturnType<typeof adminUnitsFactory>;
  const catalog = units.load();
  if (catalog.origin === 'file' && catalog.catalog.version) {
    strapi.log.info(
      `[ordering] administrative units ${catalog.catalog.version}: ${catalog.catalog.provinces.length} provinces, ${catalog.catalog.communes.length} communes`,
    );
  } else if (catalog.origin === 'test-fixture') {
    strapi.log.info(
      `[ordering] administrative units: TEST FIXTURE (${catalog.catalog.provinces.length} provinces, ${catalog.catalog.communes.length} communes, prefix XT) — not the official catalog`,
    );
  }
  const providerOn = config.providers.fulfillment['self-delivery']?.enabled === true;
  let branchOn = false;
  try {
    branchOn = await units.anyBranchDeliveryEnabled();
  } catch (error) {
    strapi.log.warn(
      `[ordering] could not read branch delivery settings: ${(error as Error).message ?? error}`,
    );
  }
  const warning = units.warning(providerOn || branchOn);
  if (warning) strapi.log.warn(`[ordering] ${warning}`);

  strapi.log.info(
    `[ordering] lifecycle: plugin bootstrap; catalog adapters: ${registry.catalogAdapterCodes().join(', ')}`,
  );
};

export default bootstrap;
