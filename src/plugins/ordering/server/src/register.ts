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
    // Strapi passes the admin user itself (merged with the permission), not `{ user }`;
    // see admin::is-creator in @strapi/admin config/admin-conditions.js.
    handler: async (user: { id?: number }) =>
      strapi.plugin('ordering').service('branch-scope').condition({ user }),
  });
  if (strapi.config.get('plugin::ordering.spike.enabled')) {
    // O0 probe of Strapi's fail-open rule: a handler returning null must never ship (see C17.1).
    strapi.admin.services.permission.conditionProvider.register({
      name: 'spike-null-probe', displayName: 'O0 null probe', plugin: 'ordering', category: 'ordering',
      handler: async () => null,
    });
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
