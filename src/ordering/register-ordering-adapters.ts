import type { Core } from '@strapi/strapi';

type OrderingRegistry = {
  registerCatalogAdapter: (adapter: { code: string }) => void;
  recordLifecycle: (step: string) => void;
  recordAppEvent: (payload: unknown) => void;
};

/**
 * Registers Salanca's adapters into the generic ordering plugin. The plugin never imports app code;
 * the app reaches the plugin through its public registry service, and only when the plugin is enabled.
 *
 * Phase O0 spike: registers a no-op adapter to prove the lifecycle order
 * (plugin register → app register → plugin bootstrap).
 */
export const registerOrderingAdapters = (strapi: Core.Strapi) => {
  const plugin = strapi.plugin('ordering');
  if (!plugin) {
    return;
  }
  const registry = plugin.service('registry') as OrderingRegistry;
  registry.registerCatalogAdapter({ code: 'salanca-spike-noop' });
  registry.recordLifecycle('app.register');
  strapi.eventHub.on('ordering.spike.ready', async (payload: unknown) => { registry.recordAppEvent(payload); });
  strapi.log.info('[ordering] lifecycle: app register');
};

export const recordOrderingAppBootstrap = (strapi: Core.Strapi) => {
  const plugin = strapi.plugin('ordering');
  if (plugin) (plugin.service('registry') as OrderingRegistry).recordLifecycle('app.bootstrap');
};
