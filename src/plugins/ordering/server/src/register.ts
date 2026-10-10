import type { Core } from '@strapi/strapi';

import type { OrderingRegistry } from './services/registry';

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  const registry = strapi.plugin('ordering').service('registry') as OrderingRegistry;
  registry.registerCatalogAdapter({ code: 'ordering-catalog' });
  registry.recordLifecycle('plugin.register');
  strapi.customFields.register({ name: 'localized-text', plugin: 'ordering', type: 'json' });
  strapi.admin.services.permission.actionProvider.register({
    section: 'plugins', displayName: 'Read orders (O0 probe)', uid: 'order.read', pluginName: 'ordering',
  });
  strapi.admin.services.permission.conditionProvider.register({
    name: 'same-location', displayName: 'Assigned ordering branches', plugin: 'ordering',
    category: 'ordering',
    handler: async (context: { user?: { id?: number } }) =>
      strapi.plugin('ordering').service('branch-scope').condition(context),
  });
  if (strapi.config.get('plugin::ordering.spike.enabled')) {
    strapi.documents.use(async (context, next) => {
      if (context.uid === 'plugin::ordering.order' && context.action === 'update') {
        throw new Error('O0 probe: order updates must use the ordering service');
      }
      return next();
    });
  }
  strapi.log.info('[ordering] lifecycle: plugin register');
};

export default register;
