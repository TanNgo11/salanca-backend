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
      // O12: scanned table QR resolves branch + table for the at-table menu. POST so the secret
      // stays out of the URL (access logs record it).
      publicRoute('POST', '/tables/resolve', 'table.resolve'),
      publicRoute('POST', '/quote', 'storefront.quote'),
      publicRoute('POST', '/orders', 'storefront.create'),
      publicRoute('GET', '/orders', 'storefront.show'),
      publicRoute('GET', '/orders/payment', 'storefront.payment'),
      publicRoute('GET', '/orders/rating', 'storefront.rating'),
      publicRoute('POST', '/orders/rating', 'storefront.rate'),
      publicRoute('POST', '/orders/cancel', 'storefront.cancel'),
      publicRoute('POST', '/orders/lookup', 'storefront.lookup'),
      publicRoute('POST', '/gift-cards/balance', 'storefront.giftCardBalance'),
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
      publicRoute('POST', '/me/orders/:code/reorder', 'customer.reorder'),
      // O11 step 6: Decree 13 self-service — export everything, then erase it.
      // O16: the signed-in customer's points (X-Customer-Token; scoped to that customer).
      publicRoute('GET', '/me/loyalty', 'customer.loyalty'),
      publicRoute('GET', '/me/loyalty/history', 'customer.loyaltyHistory'),
      publicRoute('GET', '/me/data-export', 'customer.dataExport'),
      publicRoute('POST', '/me/erase', 'customer.erase'),
      // O11 step 4: server-side carts — X-Cart-Token for guests, X-Customer-Token for
      // sessions; when both arrive the guest cart merges into the customer's.
      publicRoute('POST', '/carts', 'cart.create'),
      publicRoute('GET', '/carts/current', 'cart.current'),
      publicRoute('PATCH', '/carts/current', 'cart.patch'),
      publicRoute('POST', '/carts/current/lines', 'cart.addLine'),
      publicRoute('PATCH', '/carts/current/lines/:lineId', 'cart.updateLine'),
      publicRoute('DELETE', '/carts/current/lines/:lineId', 'cart.removeLine'),
      publicRoute('POST', '/carts/current/checkout', 'cart.checkout'),
      // O13: wallet checkout sessions (X-Order-Token) and the display-only return landing.
      publicRoute('POST', '/payments/session', 'storefront.paymentSession'),
      publicRoute('GET', '/payments/return/:provider', 'storefront.paymentReturn'),
      publicRoute('POST', '/webhooks/:providerCode', 'webhook.receive'),
      // VNPay sends its IPN as GET — the signed data is the query-param set itself.
      publicRoute('GET', '/webhooks/:providerCode', 'webhook.receive'),
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
      // O12 pause/busy (screens N3): inbox staff toggle them, so `order.process` not `settings.manage`.
      adminRoute('POST', '/branches/:code/pause', 'admin-branches.pause', 'order.process'),
      adminRoute('POST', '/branches/:code/resume', 'admin-branches.resume', 'order.process'),
      adminRoute('POST', '/branches/:code/busy', 'admin-branches.busy', 'order.process'),
      adminRoute('POST', '/branches/:code/busy/clear', 'admin-branches.clearBusy', 'order.process'),
      adminRoute('GET', '/staff-scopes', 'admin-branches.staffList', 'scope.manage'),
      adminRoute('PUT', '/staff-scopes/:adminUserId', 'admin-branches.staffPut', 'scope.manage'),
      // Phone page for the assigned courier (screens E4). Scope is the assignee, not the branch.
      adminRoute('GET', '/courier/deliveries', 'courier.deliveries', 'order.process'),
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
      // O12 print pages (screens N1): kitchen ticket / provisional receipt payload. The
      // session variant (N7 "In hóa đơn bàn") merges every order of the table on one bill.
      adminRoute('GET', '/print/orders/:id', 'print.order', 'order.read'),
      adminRoute('GET', '/print/table-sessions/:id', 'print.session', 'table.manage'),
      // O12 KDS (screens N2): board, per-line prepared, whole-order ready, KDS-scoped SSE.
      adminRoute('GET', '/kitchen', 'kitchen.board', 'kitchen.read'),
      adminRoute('GET', '/kitchen/stream', 'admin-stream.stream', 'kitchen.read'),
      adminRoute('POST', '/kitchen/lines/:lineId/prepared', 'kitchen.prepared', 'kitchen.read'),
      adminRoute('POST', '/kitchen/orders/:id/start', 'kitchen.start', 'kitchen.read'),
      adminRoute('POST', '/kitchen/orders/:id/complete', 'kitchen.complete', 'kitchen.read'),
      // O12 tables (screens N6) and sessions (screens N7). The session close also touches
      // money, so it additionally requires `payment.record-cash`.
      adminRoute('GET', '/tables', 'table.list', 'table.manage'),
      adminRoute('POST', '/tables', 'table.create', 'table.manage'),
      adminRoute('PUT', '/tables/:id', 'table.update', 'table.manage'),
      adminRoute('POST', '/tables/:id/rotate-qr', 'table.rotateQr', 'table.manage'),
      adminRoute('GET', '/tables/:id/qr.svg', 'table.qr', 'table.manage'),
      adminRoute('GET', '/table-sessions', 'table.sessions', 'table.manage'),
      adminRoute(
        'POST',
        '/table-sessions/:id/close',
        'table.closeSession',
        'table.manage',
        'payment.record-cash',
      ),
      adminRoute('POST', '/orders/:id/payment-link', 'admin-orders.paymentLink', 'order.read'),
      adminRoute('POST', '/orders/:id/transition', 'admin-orders.transition', 'order.process'),
      adminRoute('POST', '/orders/:id/notes', 'admin-orders.addNote', 'order.process'),
      adminRoute('POST', '/orders/:id/cash-handover', 'admin-orders.cashHandover', 'payment.record-cash'),
      // O13 "Gọi xe": staff quotes, books and cancels a carrier trip for the delivery leg.
      adminRoute('POST', '/orders/:id/carrier/quote', 'admin-orders.carrierQuote', 'order.process'),
      adminRoute('POST', '/orders/:id/carrier/book', 'admin-orders.carrierBook', 'order.process'),
      adminRoute('POST', '/orders/:id/carrier/cancel', 'admin-orders.carrierCancel', 'order.process'),
      adminRoute('POST', '/orders/:id/cancel', 'admin-orders.cancel', 'order.cancel'),
      adminRoute(
        'GET',
        '/orders/:id/lines/:lineId/cancel-preview',
        'admin-orders.lineCancelPreview',
        'order.edit-lines',
      ),
      adminRoute('POST', '/orders/:id/lines/:lineId/cancel', 'admin-orders.cancelLine', 'order.edit-lines'),
      adminRoute('POST', '/orders/:id/edit/preview', 'admin-orders.editPreview', 'order.edit'),
      adminRoute('POST', '/orders/:id/edit', 'admin-orders.edit', 'order.edit'),
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
      // O8 "Khuyến mãi" (screens K1–K4). Literal segments precede `/:id` routes.
      // O14 price lists and customer groups. Literal segments precede `/:id`.
      adminRoute('GET', '/price-lists', 'price-lists.list', 'price.manage'),
      adminRoute('POST', '/price-lists', 'price-lists.create', 'price.manage'),
      adminRoute('GET', '/price-lists/options', 'price-lists.options', 'price.manage'),
      adminRoute('GET', '/price-lists/:id', 'price-lists.get', 'price.manage'),
      adminRoute('PUT', '/price-lists/:id', 'price-lists.update', 'price.manage'),
      adminRoute('POST', '/price-lists/:id/active', 'price-lists.setActive', 'price.manage'),
      adminRoute('POST', '/price-preview', 'price-lists.preview', 'price.manage'),
      adminRoute('GET', '/customer-groups', 'customer-groups.list', 'price.manage'),
      adminRoute('POST', '/customer-groups', 'customer-groups.create', 'price.manage'),
      adminRoute('GET', '/customer-groups/search', 'customer-groups.search', 'price.manage'),
      adminRoute('GET', '/customer-groups/:id', 'customer-groups.get', 'price.manage'),
      adminRoute('PUT', '/customer-groups/:id', 'customer-groups.update', 'price.manage'),
      adminRoute('POST', '/customer-groups/:id/members', 'customer-groups.members', 'price.manage'),
      adminRoute('GET', '/promotions', 'promotions.list', 'promotion.manage'),
      adminRoute('POST', '/promotions', 'promotions.create', 'promotion.manage'),
      adminRoute('GET', '/promotions/targets', 'promotions.targets', 'promotion.manage'),
      adminRoute('GET', '/promotions/:id', 'promotions.get', 'promotion.manage'),
      adminRoute('PUT', '/promotions/:id', 'promotions.update', 'promotion.manage'),
      adminRoute('POST', '/promotions/:id/active', 'promotions.setActive', 'promotion.manage'),
      adminRoute('GET', '/promotions/:id/codes/export', 'promotions.exportCodes', 'promotion.manage', 'export'),
      adminRoute('GET', '/promotions/:id/codes', 'promotions.codes', 'promotion.manage'),
      adminRoute('POST', '/promotions/:id/codes', 'promotions.addCodes', 'promotion.manage'),
      adminRoute('GET', '/promotions/:id/redemptions', 'promotions.redemptions', 'promotion.manage'),
      adminRoute('POST', '/promotion-codes/:id/active', 'promotions.codeActive', 'promotion.manage'),
      // O9 "Thẻ quà tặng" (screens G1–G3): `gift-card.manage` for reads and lifecycle ops;
      // `gift-card.adjust` for the signed balance correction; batch export also needs `export`
      // because the CSV carries plaintext codes (the printing hand-off). `/search` and
      // `/gift-card-batches/import` precede their `/:id` siblings so they are not parsed as ids.
      adminRoute('GET', '/gift-cards', 'gift-cards.list', 'gift-card.manage'),
      adminRoute('POST', '/gift-cards/search', 'gift-cards.search', 'gift-card.manage'),
      adminRoute('POST', '/gift-cards', 'gift-cards.create', 'gift-card.manage'),
      adminRoute('GET', '/gift-cards/:id', 'gift-cards.get', 'gift-card.manage'),
      adminRoute('POST', '/gift-cards/:id/block', 'gift-cards.block', 'gift-card.manage'),
      adminRoute('POST', '/gift-cards/:id/unblock', 'gift-cards.unblock', 'gift-card.manage'),
      adminRoute('POST', '/gift-cards/:id/extend', 'gift-cards.extend', 'gift-card.manage'),
      adminRoute('POST', '/gift-cards/:id/adjust', 'gift-cards.adjust', 'gift-card.adjust'),
      adminRoute('POST', '/gift-cards/:id/resend', 'gift-cards.resend', 'gift-card.manage'),
      adminRoute('GET', '/gift-card-batches', 'gift-cards.listBatches', 'gift-card.manage'),
      adminRoute('POST', '/gift-card-batches/import', 'gift-cards.importBatch', 'gift-card.manage'),
      adminRoute('POST', '/gift-card-batches', 'gift-cards.createBatch', 'gift-card.manage'),
      adminRoute('GET', '/gift-card-batches/:id', 'gift-cards.getBatch', 'gift-card.manage'),
      adminRoute('GET', '/gift-card-batches/:id/export', 'gift-cards.exportBatch', 'gift-card.manage', 'export'),
      // O16 "Điểm và hạng" (screens Y1–Y2): program settings and tiers; `loyalty.manage` guards both.
      adminRoute('GET', '/loyalty/settings', 'loyalty.getSettings', 'loyalty.manage'),
      adminRoute('PUT', '/loyalty/settings', 'loyalty.putSettings', 'loyalty.manage'),
      adminRoute('GET', '/loyalty/tiers', 'loyalty.listTiers', 'loyalty.manage'),
      adminRoute('POST', '/loyalty/tiers', 'loyalty.createTier', 'loyalty.manage'),
      adminRoute('GET', '/loyalty/tiers/:id', 'loyalty.getTier', 'loyalty.manage'),
      adminRoute('PUT', '/loyalty/tiers/:id', 'loyalty.updateTier', 'loyalty.manage'),
      adminRoute('POST', '/loyalty/tiers/recalculate', 'loyalty.recalculate', 'loyalty.manage'),
      // Y3 (customer points; same branch scope as the profile) and Y4 (report).
      adminRoute('GET', '/customers/:id/loyalty', 'loyalty.customer', 'customer.read'),
      adminRoute('POST', '/customers/:id/loyalty/adjust', 'loyalty.adjust', 'customer.read', 'loyalty.adjust'),
      adminRoute('GET', '/reports/loyalty', 'loyalty.report', 'report.read'),
      // O8 "Đánh giá" (screens R1–R2): reading follows order scope, changes need `rating.manage`.
      adminRoute('GET', '/ratings', 'ratings.list', 'order.read'),
      adminRoute('GET', '/ratings/:id', 'ratings.detail', 'order.read'),
      adminRoute('POST', '/ratings/:id/hide', 'ratings.hide', 'order.read', 'rating.manage'),
      adminRoute('POST', '/ratings/:id/note', 'ratings.note', 'order.read', 'rating.manage'),
      adminRoute('GET', '/audit-log', 'audit-log.list', 'audit.read'),
      adminRoute('GET', '/audit-log/actors', 'audit-log.actors', 'audit.read'),
      adminRoute('GET', '/audit-log/export', 'audit-log.exportCsv', 'audit.read', 'export'),
      adminRoute('GET', '/audit-log/:id', 'audit-log.detail', 'audit.read'),
      // O11: customers (screens C1–C2) and Decree 13 data requests (screen C3). Staff see a
      // customer only through an in-scope order — hidden customers 404.
      adminRoute('GET', '/customers', 'admin-customers.list', 'customer.read'),
      adminRoute('GET', '/customers/:id', 'admin-customers.detail', 'customer.read'),
      adminRoute('PUT', '/customers/:id', 'admin-customers.update', 'customer.manage'),
      adminRoute('POST', '/customers/:id/reveal-phone', 'admin-customers.revealPhone', 'customer.manage'),
      adminRoute('GET', '/customers/:id/export', 'admin-customers.exportCustomer', 'customer.manage'),
      adminRoute('GET', '/data-requests', 'admin-customers.listRequests', 'customer.erase'),
      adminRoute('POST', '/data-requests', 'admin-customers.createRequest', 'customer.erase'),
      adminRoute('POST', '/data-requests/:id/process', 'admin-customers.processRequest', 'customer.erase'),
      adminRoute('POST', '/data-requests/:id/reject', 'admin-customers.rejectRequest', 'customer.erase'),
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
      // O13 "Nhà cung cấp" (screens P1): read-only grouped provider overview — masked
      // identifiers only, secrets stay env-only.
      adminRoute('GET', '/providers', 'providers.list', 'settings.manage'),
      // O13 "Kênh thông báo" (screens P3): ordered channel chain + ZNS mapping per template,
      // plus a staff test-send that writes a `test:*` delivery row.
      adminRoute('GET', '/notification-channels', 'notification-channels.list', 'settings.manage'),
      adminRoute(
        'PUT',
        '/notification-channels/:template',
        'notification-channels.put',
        'settings.manage',
      ),
      adminRoute(
        'POST',
        '/notification-channels/test',
        'notification-channels.test',
        'settings.manage',
      ),
    ],
  },
};
