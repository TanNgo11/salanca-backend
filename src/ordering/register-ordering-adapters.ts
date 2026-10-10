import type { Core } from '@strapi/strapi';

/**
 * Registers Salanca's adapters into the generic ordering plugin. The plugin never imports app code;
 * the app reaches the plugin through its public registry service, and only when the plugin is enabled.
 *
 * Hook point for the adapters Salanca registers in later phases (catalog, payment, fulfillment).
 */
export const registerOrderingAdapters = (strapi: Core.Strapi) => {
  const plugin = strapi.plugin('ordering');
  if (!plugin) {
    return;
  }
  strapi.log.info('[ordering] app register hook ran');
};
