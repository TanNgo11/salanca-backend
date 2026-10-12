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
      publicRoute('GET', '/admin-units', 'admin-units.list'),
      publicRoute('GET', '/config', 'storefront.config'),
      publicRoute('GET', '/slots', 'storefront.slots'),
      publicRoute('POST', '/quote', 'storefront.quote'),
      publicRoute('POST', '/orders', 'storefront.create'),
      publicRoute('GET', '/orders', 'storefront.show'),
      publicRoute('GET', '/orders/payment', 'storefront.payment'),
      publicRoute('POST', '/orders/cancel', 'storefront.cancel'),
      publicRoute('POST', '/orders/lookup', 'storefront.lookup'),
      publicRoute('POST', '/webhooks/:providerCode', 'webhook.receive'),
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
      // Daily portion limit. The permission is specifically `catalog.toggle-availability`
      // (a catalog manager without that action cannot change the number). Out of scope
      // is 404 from the service.
      adminRoute('PUT', '/availability/daily-limit', 'availability.dailyLimit', 'catalog.toggle-availability'),
      // "Chi nhánh" (screens S7). Scope is enforced in the branch service.
      adminRoute('GET', '/admin-units', 'admin-units.list', 'settings.manage'),
      adminRoute('GET', '/branches', 'admin-branches.list', 'settings.manage'),
      adminRoute('POST', '/branches', 'admin-branches.create', 'settings.manage'),
      adminRoute('GET', '/branches/:code', 'admin-branches.get', 'settings.manage'),
      adminRoute('PATCH', '/branches/:code', 'admin-branches.update', 'settings.manage'),
      // The Admin fetch client has no PATCH; PUT carries the same partial update.
      adminRoute('PUT', '/branches/:code', 'admin-branches.update', 'settings.manage'),
      adminRoute('POST', '/branches/:code/delivery-quote', 'admin-branches.deliveryQuote', 'settings.manage'),
      adminRoute('GET', '/staff-scopes', 'admin-branches.staffList', 'scope.manage'),
      adminRoute('PUT', '/staff-scopes/:adminUserId', 'admin-branches.staffPut', 'scope.manage'),
      // Order inbox and actions (screens S1–S5).
      adminRoute('GET', '/orders', 'admin-orders.list', 'order.read'),
      adminRoute('GET', '/orders/summary', 'admin-orders.summary', 'order.read'),
      adminRoute('GET', '/orders/branches', 'admin-orders.branches', 'order.read'),
      // Couriers the assign dialog may offer for a branch (screens D3).
      adminRoute('GET', '/orders/delivery-staff', 'admin-orders.deliveryStaff', 'order.read'),
      adminRoute('GET', '/orders/stream', 'admin-stream.stream', 'order.read'),
      // CSV export (screens V5) — before `/orders/:id` so 'export' is not parsed as an id.
      adminRoute('GET', '/orders/export', 'admin-orders.exportOrders', 'export'),
      adminRoute('GET', '/orders/:id', 'admin-orders.detail', 'order.read'),
      adminRoute('POST', '/orders/:id/payment-link', 'admin-orders.paymentLink', 'order.read'),
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
      adminRoute('POST', '/refunds/:id/settle', 'admin-orders.settleRefund', 'refund.manage'),
      adminRoute('POST', '/orders/:id/manual-payments', 'admin-orders.recordManual', 'payment.review'),
      // "Duyệt chuyển khoản" (screens P2–P3). Scope is enforced in the review service.
      adminRoute('GET', '/payment-reviews', 'payment-review.list', 'payment.review'),
      adminRoute('GET', '/payment-reviews/orders', 'payment-review.searchOrders', 'payment.review'),
      adminRoute('POST', '/payment-reviews/:id/assign', 'payment-review.assign', 'payment.review'),
      adminRoute('POST', '/payment-reviews/:id/refund-due', 'payment-review.refundDue', 'payment.review'),
      adminRoute('POST', '/payment-reviews/:id/reopen', 'payment-review.reopen', 'payment.review'),
      adminRoute('POST', '/payment-reviews/:id/ignore', 'payment-review.ignore', 'payment.review'),
      // Staff phone orders (screens S6).
      adminRoute('POST', '/drafts/quote', 'admin-orders.quoteDraft', 'order.create'),
      adminRoute('POST', '/drafts', 'admin-orders.createDraft', 'order.create'),
      adminRoute('POST', '/drafts/:id/confirm', 'admin-orders.confirmDraft', 'order.create'),
      adminRoute('DELETE', '/drafts/:id', 'admin-orders.deleteDraft', 'order.create'),
      // General sales settings (screens S9).
      adminRoute('GET', '/settings', 'admin-orders.getSettings', 'settings.manage'),
      adminRoute('PUT', '/settings', 'admin-orders.putSettings', 'settings.manage'),
      adminRoute('GET', '/settings/alert-rules', 'ops.getAlertRules', 'settings.manage'),
      adminRoute('PUT', '/settings/alert-rules', 'ops.putAlertRules', 'settings.manage'),
      // Alert inbox (screens V2). `has-alert-access` admits any alert-recipient role; the
      // service narrows the rows to the caller's rules and location scope.
      {
        method: 'GET',
        path: '/alerts',
        handler: 'ops.listAlerts',
        config: {
          policies: ['admin::isAuthenticatedAdmin', 'plugin::ordering.has-alert-access'],
        },
      },
      {
        method: 'POST',
        path: '/alerts/:id/acknowledge',
        handler: 'ops.acknowledgeAlert',
        config: {
          policies: ['admin::isAuthenticatedAdmin', 'plugin::ordering.has-alert-access'],
        },
      },
      // "Tình trạng vận hành" (screens V1): status board plus the two staff actions —
      // run a catalog job now, retry a failed outbox event. `ops.read` for all three.
      adminRoute('GET', '/ops/status', 'ops.status', 'ops.read'),
      adminRoute('POST', '/ops/jobs/:name/run', 'ops.runJob', 'ops.read'),
      adminRoute('POST', '/ops/outbox/:id/retry', 'ops.retryOutbox', 'ops.read'),
      // Cash closing (screens V3, contracts §19.3): branch/day summary plus close & adjust.
      // `report.read` for all three; the service still enforces the caller's location scope.
      adminRoute('GET', '/reports/branches', 'reports.branches', 'report.read'),
      adminRoute('GET', '/cash-closing', 'cash-closing.summary', 'report.read'),
      // Alias kept for the screens V3 contract spelling `/cash-closing/summary`.
      adminRoute('GET', '/cash-closing/summary', 'cash-closing.summary', 'report.read'),
      adminRoute('POST', '/cash-closing', 'cash-closing.close', 'report.read'),
      adminRoute('POST', '/cash-closing/:id/adjust', 'cash-closing.adjust', 'report.read'),
      // Sales report (screens V4): ledger revenue + sold-order grouping by business date.
      adminRoute('GET', '/reports/sales', 'reports.sales', 'report.read'),
    ],
  },
};
