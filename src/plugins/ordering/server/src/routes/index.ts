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
      // O11 step 2: customer OTP sign-in (email only until O13) and logout. The controller
      // resolves `X-Customer-Token` itself; these routes stay `auth: false` by design.
      publicRoute('POST', '/auth/otp', 'customer-auth.requestOtp'),
      publicRoute('POST', '/auth/verify', 'customer-auth.verify'),
      publicRoute('POST', '/auth/logout', 'customer-auth.logout'),
      // O11 step 3: the signed-in customer surface — X-Customer-Token required; the controller
      // scopes every row to the session's customer (foreign ids 404).
      publicRoute('GET', '/me', 'customer.me'),
      publicRoute('PUT', '/me', 'customer.update'),
      publicRoute('GET', '/me/addresses', 'customer.listAddresses'),
      publicRoute('POST', '/me/addresses', 'customer.createAddress'),
      publicRoute('PUT', '/me/addresses/:id', 'customer.updateAddress'),
      publicRoute('DELETE', '/me/addresses/:id', 'customer.deleteAddress'),
      publicRoute('GET', '/me/orders', 'customer.myOrders'),
      publicRoute('GET', '/me/orders/:code', 'customer.myOrder'),
      // O11 step 4: server-side carts — X-Cart-Token for guests, X-Customer-Token for
      // sessions; when both arrive the guest cart merges into the customer's.
      publicRoute('POST', '/carts', 'cart.create'),
      publicRoute('GET', '/carts/current', 'cart.current'),
      publicRoute('PATCH', '/carts/current', 'cart.patch'),
      publicRoute('POST', '/carts/current/lines', 'cart.addLine'),
      publicRoute('PATCH', '/carts/current/lines/:lineId', 'cart.updateLine'),
      publicRoute('DELETE', '/carts/current/lines/:lineId', 'cart.removeLine'),
      publicRoute('POST', '/carts/current/checkout', 'cart.checkout'),
      publicRoute('POST', '/webhooks/:providerCode', 'webhook.receive'),
      // O10: the public contract, self-served (cached 1h by the controller).
      publicRoute('GET', '/openapi.json', 'openapi.document'),
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
      // O15 "Lịch sử thay đổi" — scope filtered in the service; export needs both actions.
      adminRoute('GET', '/audit-log', 'audit-log.list', 'audit.read'),
      adminRoute('GET', '/audit-log/actors', 'audit-log.actors', 'audit.read'),
      adminRoute('GET', '/audit-log/export', 'audit-log.exportCsv', 'audit.read', 'export'),
      adminRoute('GET', '/audit-log/:id', 'audit-log.detail', 'audit.read'),
      // O10 "Nhập/Xuất menu" (screens X3): catalog CSV round-trip. Import posts the file as
      // text/csv (≤256 KB) or application/octet-stream (≤2 MB); export needs both actions.
      adminRoute('GET', '/catalog/imports', 'catalog-import.list', 'catalog.manage'),
      adminRoute('GET', '/catalog/export', 'catalog-import.exportCsv', 'catalog.manage', 'export'),
      adminRoute('POST', '/catalog/import', 'catalog-import.importCsv', 'catalog.manage'),
      adminRoute('POST', '/catalog/import/:id/apply', 'catalog-import.apply', 'catalog.manage'),
      // O10 "Webhook" (screens X1): outbound endpoint management. `webhook.manage` gates the
      // whole surface; the plaintext signing secret leaves the server only in create/rotate
      // responses. `/webhooks/events` precedes `/webhooks/:id` so it is not parsed as
      // an id (same rule as `/orders/export`).
      adminRoute('GET', '/webhooks', 'webhooks.list', 'webhook.manage'),
      adminRoute('GET', '/webhooks/events', 'webhooks.eventCatalog', 'webhook.manage'),
      adminRoute('GET', '/webhooks/:id', 'webhooks.get', 'webhook.manage'),
      adminRoute('POST', '/webhooks', 'webhooks.create', 'webhook.manage'),
      adminRoute('PATCH', '/webhooks/:id', 'webhooks.update', 'webhook.manage'),
      // The Admin fetch client has no PATCH; PUT carries the same partial update.
      adminRoute('PUT', '/webhooks/:id', 'webhooks.update', 'webhook.manage'),
      adminRoute('POST', '/webhooks/:id/rotate-secret', 'webhooks.rotateSecret', 'webhook.manage'),
      adminRoute('POST', '/webhooks/:id/active', 'webhooks.setActive', 'webhook.manage'),
      adminRoute('POST', '/webhooks/:id/test', 'webhooks.sendTest', 'webhook.manage'),
      adminRoute('GET', '/webhooks/:id/deliveries', 'webhooks.deliveries', 'webhook.manage'),
      adminRoute('POST', '/webhook-deliveries/:id/resend', 'webhooks.resend', 'webhook.manage'),
      // O10 "Mẫu email" (screens X4): subject + restricted-markdown body overrides per
      // (code, locale); :code contains dots but stays inside one path segment.
      adminRoute('GET', '/notification-templates', 'notification-templates.list', 'settings.manage'),
      adminRoute(
        'GET',
        '/notification-templates/:code/:locale',
        'notification-templates.get',
        'settings.manage',
      ),
      adminRoute(
        'PUT',
        '/notification-templates/:code/:locale',
        'notification-templates.save',
        'settings.manage',
      ),
      adminRoute(
        'POST',
        '/notification-templates/:code/:locale/preview',
        'notification-templates.preview',
        'settings.manage',
      ),
      adminRoute(
        'POST',
        '/notification-templates/:code/:locale/test',
        'notification-templates.test',
        'settings.manage',
      ),
      adminRoute(
        'DELETE',
        '/notification-templates/:code/:locale',
        'notification-templates.remove',
        'settings.manage',
      ),
    ],
  },
};
