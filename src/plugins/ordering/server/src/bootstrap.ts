import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from './config';
import { orderingMigrations } from './migrations';
import { runOrderingMigrations } from './migrations/runner';
import type { OrderingRegistry } from './services/registry';

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const config = strapi.config.get('plugin::ordering') as OrderingConfig;
  const registry = strapi.plugin('ordering').service('registry') as OrderingRegistry;

  // The validator runs before any register(), so code references can only be checked here.
  if (!registry.hasCatalogAdapter(config.catalog.adapter)) {
    throw new Error(
      `[ordering] catalog adapter "${config.catalog.adapter}" is not registered ` +
        `(registered: ${registry.catalogAdapterCodes().join(', ') || 'none'})`,
    );
  }

  await runOrderingMigrations(strapi, orderingMigrations);
  registry.recordLifecycle('plugin.bootstrap');
  if (config.spike.enabled) {
    const database = strapi.config.get('database.connection.connection.database');
    const host = strapi.config.get('database.connection.connection.host');
    if (database !== 'salanca_ordering_spike' || !['localhost', '127.0.0.1', '::1'].includes(String(host))) {
      throw new Error('[ordering] O0 probes require the local salanca_ordering_spike database');
    }
    await strapi.eventHub.emit('ordering.spike.ready', { phase: 'O0' });
  }

  strapi.log.info(
    `[ordering] lifecycle: plugin bootstrap; catalog adapters: ${registry.catalogAdapterCodes().join(', ')}`,
  );
};

export default bootstrap;
