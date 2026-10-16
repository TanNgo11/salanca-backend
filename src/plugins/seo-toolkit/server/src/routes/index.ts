export default {
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'POST',
        // POST: a full audit is a resource-heavy read and must not be cached.
        path: '/audit/run',
        handler: 'audit.run',
        config: {
          policies: [
            'admin::isAuthenticatedAdmin',
            {
              name: 'admin::hasPermissions',
              config: { actions: ['plugin::seo-toolkit.audit.run'] },
            },
          ],
        },
      },
    ],
  },
};
