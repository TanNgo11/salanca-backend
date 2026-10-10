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

  strapi.log.info(
    `[ordering] lifecycle: plugin bootstrap; catalog adapters: ${registry.catalogAdapterCodes().join(', ')}`,
  );
};

export default bootstrap;
