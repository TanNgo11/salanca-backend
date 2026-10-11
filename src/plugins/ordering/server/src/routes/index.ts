/** Admin route guard: authenticated admin holding every listed plugin action. */
const can = (...actions: string[]) => ({
  policies: [
    'admin::isAuthenticatedAdmin',
    {
      name: 'admin::hasPermissions',
      config: { actions: actions.map((action) => `plugin::ordering.${action}`) },
    },
  ],
});

/** Public storefront route: no users-permissions auth; the controller rate-limits (§21.8). */
const publicRoute = (method: string, path: string, handler: string) => ({
  method,
  path,
  handler,
  config: { auth: false as const, policies: [], middlewares: [] },
});

const adminRoute = (method: string, path: string, handler: string, ...actions: string[]) => ({
  method,
  path,
  handler,
  config: can(...actions),
});

export default {
  'content-api': {
    type: 'content-api',
    routes: [
      {
        method: 'GET',
        path: '/catalog/categories',
        handler: 'catalog.categories',
        config: { auth: false, policies: [], middlewares: [] },
      },
      {
        method: 'GET',
        path: '/catalog/products',
        handler: 'catalog.products',
        config: { auth: false, policies: [], middlewares: [] },
      },
      {
        method: 'GET',
        path: '/catalog/products/:slug',
        handler: 'catalog.product',
        config: { auth: false, policies: [], middlewares: [] },
      },
      publicRoute('GET', '/branches', 'storefront.branches'),
      publicRoute('GET', '/config', 'storefront.config'),
      publicRoute('GET', '/slots', 'storefront.slots'),
      publicRoute('POST', '/quote', 'storefront.quote'),
      publicRoute('POST', '/orders', 'storefront.create'),
      publicRoute('GET', '/orders', 'storefront.show'),
      publicRoute('GET', '/orders/payment', 'storefront.payment'),
      publicRoute('POST', '/orders/cancel', 'storefront.cancel'),
      publicRoute('POST', '/orders/lookup', 'storefront.lookup'),
    ],
  },
  admin: {
    type: 'admin',
    routes: [
      // Category management API behind the "Danh mục" screen (plan step 7b). All routes
      // require an authenticated admin holding `plugin::ordering.catalog.manage`.
      {
        method: 'GET',
        path: '/categories',
        handler: 'categories.tree',
        config: {
          policies: [
            'admin::isAuthenticatedAdmin',
            {
              name: 'admin::hasPermissions',
              config: { actions: ['plugin::ordering.catalog.manage'] },
            },
          ],
        },
      },
      {
        method: 'POST',
        path: '/categories',
        handler: 'categories.create',
        config: {
          policies: [
            'admin::isAuthenticatedAdmin',
            {
              name: 'admin::hasPermissions',
              config: { actions: ['plugin::ordering.catalog.manage'] },
            },
          ],
        },
      },
      {
        method: 'PUT',
        path: '/categories/:id',
        handler: 'categories.update',
        config: {
          policies: [
            'admin::isAuthenticatedAdmin',
            {
              name: 'admin::hasPermissions',
              config: { actions: ['plugin::ordering.catalog.manage'] },
            },
          ],
        },
      },
      {
        method: 'POST',
        path: '/categories/:id/move',
        handler: 'categories.move',
        config: {
          policies: [
            'admin::isAuthenticatedAdmin',
            {
              name: 'admin::hasPermissions',
              config: { actions: ['plugin::ordering.catalog.manage'] },
            },
          ],
        },
      },
      {
        method: 'DELETE',
        path: '/categories/:id',
        handler: 'categories.remove',
        config: {
          policies: [
            'admin::isAuthenticatedAdmin',
            {
              name: 'admin::hasPermissions',
              config: { actions: ['plugin::ordering.catalog.manage'] },
            },
          ],
        },
      },
      // "Tạm hết món" screen (plan step 8). `has-catalog-access` admits holders of either
      // `catalog.manage` or `catalog.toggle-availability`; branch scope is enforced in the
      // service so staff only touch their own locations.
      {
        method: 'GET',
        path: '/availability/locations',
        handler: 'availability.locations',
        config: {
          policies: ['admin::isAuthenticatedAdmin', 'plugin::ordering.has-catalog-access'],
        },
      },
      {
        method: 'GET',
        path: '/availability',
        handler: 'availability.list',
        config: {
          policies: ['admin::isAuthenticatedAdmin', 'plugin::ordering.has-catalog-access'],
        },
      },
      {
        method: 'POST',
        path: '/availability/toggle',
        handler: 'availability.toggle',
        config: {
          policies: ['admin::isAuthenticatedAdmin', 'plugin::ordering.has-catalog-access'],
        },
      },
      // "Chi nhánh" (screens S7). Scope is enforced in the branch service.
      adminRoute('GET', '/branches', 'admin-branches.list', 'settings.manage'),
      adminRoute('POST', '/branches', 'admin-branches.create', 'settings.manage'),
      adminRoute('GET', '/branches/:code', 'admin-branches.get', 'settings.manage'),
      adminRoute('PATCH', '/branches/:code', 'admin-branches.update', 'settings.manage'),
      // Order inbox and actions (screens S1–S5).
      adminRoute('GET', '/orders', 'admin-orders.list', 'order.read'),
      adminRoute('GET', '/orders/summary', 'admin-orders.summary', 'order.read'),
      adminRoute('GET', '/orders/:id', 'admin-orders.detail', 'order.read'),
      adminRoute('POST', '/orders/:id/transition', 'admin-orders.transition', 'order.process'),
      adminRoute('POST', '/orders/:id/notes', 'admin-orders.addNote', 'order.process'),
      adminRoute('POST', '/orders/:id/cash-handover', 'admin-orders.cashHandover', 'payment.record-cash'),
      adminRoute('POST', '/orders/:id/cancel', 'admin-orders.cancel', 'order.cancel'),
      adminRoute(
        'GET',
        '/orders/:id/lines/:lineId/cancel-preview',
        'admin-orders.lineCancelPreview',
        'order.edit-lines',
      ),
      adminRoute('POST', '/orders/:id/lines/:lineId/cancel', 'admin-orders.cancelLine', 'order.edit-lines'),
      adminRoute('POST', '/orders/:id/refunds', 'admin-orders.refund', 'refund.manage'),
      // Staff phone orders (screens S6).
      adminRoute('POST', '/drafts/quote', 'admin-orders.quoteDraft', 'order.create'),
      adminRoute('POST', '/drafts', 'admin-orders.createDraft', 'order.create'),
      adminRoute('POST', '/drafts/:id/confirm', 'admin-orders.confirmDraft', 'order.create'),
      adminRoute('DELETE', '/drafts/:id', 'admin-orders.deleteDraft', 'order.create'),
      // General sales settings (screens S9).
      adminRoute('GET', '/settings', 'admin-orders.getSettings', 'settings.manage'),
      adminRoute('PUT', '/settings', 'admin-orders.putSettings', 'settings.manage'),
    ],
  },
};
