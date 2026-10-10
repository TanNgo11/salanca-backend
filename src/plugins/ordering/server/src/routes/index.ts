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
    ],
  },
};
