/**
 * Declarative operation table for the ordering OpenAPI documents (O10 plan step 5). One entry
 * per route declared in `routes/index.ts` — `scripts/ordering/openapi.mjs` cross-checks this
 * table against the route file, so an undocumented route fails `check:ordering`.
 *
 * `path` uses the Strapi `:param` form (the builder renders `{param}`), `scope` decides which
 * document an operation lands in: 'public' → GET /api/v1/ordering/openapi.json; 'admin' →
 * docs/ordering-admin-openapi.json (never served publicly).
 */

export type JsonSchema = Record<string, unknown>;

export type Parameter = {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  schema: JsonSchema;
  description?: string;
};

export type Operation = {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  scope: 'public' | 'admin';
  tag: string;
  summary: string;
  permissions?: string[];
  parameters?: Parameter[];
  requestBody?: JsonSchema;
  response?: JsonSchema;
};

const str: JsonSchema = { type: 'string' };
const bool: JsonSchema = { type: 'boolean' };
const int: JsonSchema = { type: 'integer' };
const num: JsonSchema = { type: 'number' };
const obj = (properties: Record<string, JsonSchema>, required?: string[]): JsonSchema => ({
  type: 'object',
  properties,
  ...(required?.length ? { required } : {}),
});
const arr = (items: JsonSchema): JsonSchema => ({ type: 'array', items });
const generic: JsonSchema = { type: 'object' };

const money = { ...int, description: 'Amount in minor currency unit (VND đồng)' };
const isoDate = { ...str, format: 'date-time' };

const pub = (
  method: Operation['method'],
  path: string,
  tag: string,
  summary: string,
  extras: Partial<Operation> = {},
): Operation => ({ method, path, tag, summary, scope: 'public', ...extras });

const adm = (
  method: Operation['method'],
  path: string,
  tag: string,
  summary: string,
  permissions: string[],
  extras: Partial<Operation> = {},
): Operation => ({ method, path, tag, summary, scope: 'admin', permissions, ...extras });

const pathParam = (name: string, description?: string): Parameter => ({
  name,
  in: 'path',
  required: true,
  schema: str,
  ...(description ? { description } : {}),
});

const orderToken: Parameter = {
  name: 'X-Order-Token',
  in: 'header',
  required: true,
  schema: str,
  description: 'Order access token returned by POST /orders (header only, never query).',
};

const customerToken: Parameter = {
  name: 'X-Customer-Token',
  in: 'header',
  required: true,
  schema: str,
  description: 'Customer session token returned by POST /auth/verify (header only, never query).',
};

const customerTokenOptional: Parameter = { ...customerToken, required: false };

const cartToken: Parameter = {
  name: 'X-Cart-Token',
  in: 'header',
  required: false,
  schema: str,
  description: 'Guest cart token returned by POST /carts (header only, never query).',
};

const cartView = obj(
  {
    cart: generic,
    quote: { anyOf: [generic, { type: 'null' }] } as unknown as JsonSchema,
    issues: arr(obj({ lineId: str, code: str, message: str }, ['code', 'message'])),
  },
  ['cart', 'quote', 'issues'],
);

const errorBody = obj(
  {
    error: obj({
      code: str,
      message: str,
      details: { type: 'object', additionalProperties: true },
      requestId: str,
    }),
  },
  ['error'],
);

export const ERROR_RESPONSE = {
  description: 'Ordering error envelope',
  content: { 'application/json': { schema: errorBody } },
};

const cartLine = obj(
  {
    sellableUid: { ...str, description: 'Catalog product id' },
    variantUid: {
      ...str,
      description:
        'Optional variant id (size, gift-card denomination). Omit for the default variant. Not a variant of this product → 400 VALIDATION_ERROR (lines.N.variantUid); a tạm hết variant → SELLABLE_UNAVAILABLE.',
    },
    quantity: int,
    selected: arr(obj({ groupUid: str, optionUid: str, quantity: int }, ['groupUid', 'optionUid'])),
    note: str,
  },
  ['sellableUid', 'quantity'],
);

const cartBody = obj(
  {
    branch: str,
    receiveMethod: obj({
      kind: { ...str, enum: ['pickup', 'delivery', 'digital', 'dine-in'] },
      locationRef: str,
      tableToken: {
        ...str,
        description: "O12 dine-in: the QR secret scanned at the table. The server stores tableId/tableCode, never the token.",
      },
      address: obj({ street: str, ward: str, district: str, province: str, note: str }),
      // O9: digital = gift-card sale — recipient mailbox + optional message.
      recipientEmail: str,
      recipientName: str,
      message: { ...str, description: 'Gift message to the recipient (≤ 300 chars)' },
    }),
    scheduledAt: isoDate,
    lines: arr(cartLine),
    adjustments: arr(obj({ kind: str, code: str, label: str, amount: num })),
    note: str,
    promotionCode: { ...str, description: 'O8: customer-entered code; the server decides the discount' },
    redeemPoints: { ...int, description: 'O16: loyalty points to spend (signed-in customer, X-Customer-Token); quote answers loyalty.reason instead of failing' },
    payment: obj({
      providerCode: { ...str, description: 'The provider covering the remainder after the card' },
      giftCardCode: {
        ...str,
        description: 'O9: gift-card code applied as a co-payment. Debited at order create; never stored.',
      },
    }),
  },
  ['branch', 'receiveMethod', 'lines'],
);

export const OPERATIONS: Operation[] = [
  // ── Public content API ──────────────────────────────────────────────────────
  pub('get', '/catalog/categories', 'Catalog', 'Category tree for the storefront', {
    parameters: [
      { name: 'location', in: 'query', schema: str, description: 'Branch code (filters the tree)' },
      { name: 'locale', in: 'query', schema: str, description: 'vi | en' },
      { name: 'receiveKind', in: 'query', schema: str, description: 'pickup | delivery | dine-in. Omitted: no price channel.' },
      { name: 'at', in: 'query', schema: isoDate, description: 'Catalog clock. A customer session answers private, no-store.' },
    ],
  }),
  pub('get', '/catalog/products', 'Catalog', 'Product page within a category', {
    parameters: [
      { name: 'category', in: 'query', schema: str },
      { name: 'cursor', in: 'query', schema: str },
      { name: 'limit', in: 'query', schema: int },
      { name: 'locale', in: 'query', schema: str },
      { name: 'receiveKind', in: 'query', schema: str, description: 'pickup | delivery | dine-in' },
      { name: 'at', in: 'query', schema: isoDate },
    ],
  }),
  pub('get', '/catalog/products/:slug', 'Catalog', 'One product with variants and option groups', {
    parameters: [
      pathParam('slug', 'VI slug'),
      { name: 'locale', in: 'query', schema: str },
      { name: 'receiveKind', in: 'query', schema: str, description: 'pickup | delivery | dine-in' },
      { name: 'at', in: 'query', schema: isoDate },
    ],
  }),
  pub('get', '/branches', 'Storefront', 'Active branches that sell online'),
  pub('get', '/admin-units', 'Storefront', 'Provinces/communes for the delivery-address picker'),
  pub('get', '/config', 'Storefront', 'Storefront configuration for a branch', {
    parameters: [{ name: 'branch', in: 'query', required: true, schema: str }],
  }),
  pub('get', '/slots', 'Storefront', 'Capacity-checked pickup/delivery slots for a day', {
    parameters: [
      { name: 'branch', in: 'query', required: true, schema: str },
      { name: 'date', in: 'query', required: true, schema: { ...str, format: 'date' } },
    ],
  }),
  // O12 step 7: the table QR lands here — branch + table for the at-table menu. Unknown or
  // rotated/disabled secrets all answer the same 404.
  pub('post', '/tables/resolve', 'Storefront', 'Resolve a table QR token (branch + table)', {
    requestBody: obj(
      { token: { ...str, description: 'QR secret — sha256-hashed server-side, never stored raw' } },
      ['token'],
    ),
    response: obj({
      item: obj({
        branch: str,
        branchName: str,
        table: obj({ code: str, name: str, area: str, seats: int }),
        menuUrl: str,
        status: { ...str, enum: ['available', 'open'] },
      }),
    }),
  }),
  pub('post', '/quote', 'Orders', 'Price a cart without creating an order', {
    requestBody: obj(
      {
        ...((cartBody.properties ?? {}) as Record<string, JsonSchema>),
        captchaToken: { ...str, description: 'Required with a promotionCode after 3 wrong codes from this IP' },
      },
      ['locationRef', 'receiveMethod', 'lines'],
    ),
    response: obj({
      subtotal: money,
      total: money,
      fulfillmentAmount: money,
      discounts: arr(generic),
      lines: arr(generic),
      promotions: arr(obj({ code: str, label: str, amount: money, target: str })),
      rejectedPromotions: arr(obj({ code: str, reason: str })),
      pendingPromotions: arr(obj({ code: str, label: str, condition: { ...str, enum: ['first-order', 'per-customer'] } })),
      giftCard: {
        ...obj({
          last4: str,
          applied: money,
          balanceAfter: money,
          reason: { ...str, enum: ['invalid', 'expired', 'insufficient'] },
        }),
        description:
          'O9: card application preview — reason flags an unusable code, applied = min(balance, due)',
      },
      loyalty: {
        ...obj({
          enabled: bool,
          loginRequired: bool,
          balance: int,
          redeemable: obj({ min: int, max: int, value: money }),
          applied: { ...obj({ points: int, amount: money }), nullable: true },
          reason: {
            ...str,
            enum: ['disabled', 'channel', 'not-logged-in', 'not-verified', 'negative-balance', 'below-minimum', 'insufficient', 'over-cap'],
          },
          earnPreview: obj({ points: int }),
        }),
        description: 'O16: points view for the signed-in customer; a refused redeemPoints is reported here, never as an error',
      },
    }),
  }),
  pub('post', '/gift-cards/balance', 'Gift cards', 'Check a card balance by code (rate-limited)', {
    requestBody: obj(
      {
        code: { ...str, description: 'The 16-char grouped card code' },
        captchaToken: { ...str, description: 'Required after 3 wrong codes from this IP' },
      },
      ['code'],
    ),
    response: obj({
      card: obj({
        last4: str,
        status: { ...str, enum: ['active', 'blocked', 'expired'] },
        balance: money,
        currency: str,
        expiresAt: isoDate,
      }),
    }),
  }),
  pub('post', '/orders', 'Orders', 'Create an order (idempotent)', {
    parameters: [
      {
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: str,
        description: 'Client-generated key; a replay returns the same order with `replayed: true`.',
      },
    ],
    requestBody: obj(
      {
        ...((cartBody.properties ?? {}) as Record<string, JsonSchema>),
        contact: obj({ name: str, phone: str }, ['phone']),
        consent: obj(
          {
            policyVersion: { ...str, description: 'Must equal consentPolicyVersion from GET /config' },
            accepted: bool,
            marketingOptIn: bool,
          },
          ['policyVersion', 'accepted'],
        ),
        customerNote: str,
        captchaToken: str,
      },
      ['branch', 'receiveMethod', 'lines', 'contact', 'consent'],
    ),
    response: obj({
      order: generic,
      token: { ...str, description: 'Order access token — store it, it is shown once' },
      replayed: bool,
    }),
  }),
  pub('get', '/orders', 'Orders', 'Order status view by token', {
    parameters: [orderToken],
    response: obj({ order: generic }),
  }),
  pub('get', '/orders/payment', 'Orders', 'Payment state and QR payload by token', {
    parameters: [orderToken],
    response: obj({ payment: generic }),
  }),
  pub('get', '/orders/rating', 'Ratings', 'Whether the order can be rated, the tags and the current rating', {
    parameters: [orderToken],
    response: obj({ rateable: bool, reason: str, tags: arr(obj({ code: str, label: str, sentiment: str })), rating: generic }),
  }),
  pub('post', '/orders/rating', 'Ratings', 'Rate a completed order (edit until editableUntil)', {
    parameters: [orderToken],
    requestBody: obj({ stars: int, tags: arr(str), comment: str }, ['stars']),
    response: obj({ rating: generic }),
  }),
  pub('post', '/orders/cancel', 'Orders', 'Cancel an order while it is customer-cancellable', {
    parameters: [orderToken],
    requestBody: obj({ reason: str }),
    response: obj({ order: generic }),
  }),
  pub('post', '/orders/lookup', 'Orders', 'Status-only lookup by code + phone (rate-limited)', {
    requestBody: obj({ code: str, phone: str, captchaToken: str }, ['code', 'phone']),
    response: obj({ order: generic }),
  }),
  // O11 step 2 — customer sign-in. Responses never reveal whether the target maps to a profile.
  pub('post', '/auth/otp', 'Customer auth', 'Request a sign-in OTP (email only until O13)', {
    requestBody: obj(
      { channel: { ...str, enum: ['email'] }, target: str, captchaToken: str },
      ['channel', 'target'],
    ),
    response: obj({ challengeId: str }, ['challengeId']),
  }),
  pub('post', '/auth/verify', 'Customer auth', 'Verify the code → session token + profile', {
    requestBody: obj({ challengeId: str, code: str }, ['challengeId', 'code']),
    response: obj({ token: str, customer: generic }, ['token', 'customer']),
  }),
  pub('post', '/auth/logout', 'Customer auth', 'Revoke the presented session (204)', {
    parameters: [customerToken],
    response: { type: 'null', description: '204 No Content' },
  }),
  // O11 step 3 — signed-in customer surface. X-Customer-Token on every route; foreign ids 404.
  pub('get', '/me', 'Customer', 'Own profile + order stats', {
    parameters: [customerToken],
    response: generic,
  }),
  pub('put', '/me', 'Customer', 'Update name / marketing consent (email read-only)', {
    parameters: [customerToken],
    requestBody: obj({
      name: str,
      email: str,
      marketingConsent: obj({ granted: bool }),
    }),
    response: generic,
  }),
  pub('get', '/me/addresses', 'Customer', 'Address book (default first)', {
    parameters: [customerToken],
    response: obj({ items: arr(generic) }, ['items']),
  }),
  pub('post', '/me/addresses', 'Customer', 'Add an address (max 10)', {
    parameters: [customerToken],
    requestBody: obj(
      {
        label: str,
        recipientName: str,
        phone: str,
        line1: str,
        communeCode: str,
        note: str,
        isDefault: bool,
      },
      ['recipientName', 'phone', 'line1', 'communeCode'],
    ),
    response: obj({ address: generic }, ['address']),
  }),
  pub('put', '/me/addresses/:id', 'Customer', 'Replace an address', {
    parameters: [customerToken, pathParam('id', 'address documentId')],
    requestBody: generic,
    response: obj({ address: generic }, ['address']),
  }),
  pub('delete', '/me/addresses/:id', 'Customer', 'Delete an address (204)', {
    parameters: [customerToken, pathParam('id', 'address documentId')],
    response: { type: 'null', description: '204 No Content' },
  }),
  pub('get', '/me/orders', 'Customer', 'Own orders, newest first (status-only view)', {
    parameters: [
      customerToken,
      { name: 'page', in: 'query', schema: int },
      { name: 'pageSize', in: 'query', schema: int },
    ],
    response: obj({ items: arr(generic), page: int, pageSize: int, total: int }, ['items']),
  }),
  pub('get', '/me/orders/:code', 'Customer', 'Own order by code (404 for foreign codes)', {
    parameters: [customerToken, pathParam('code', 'e.g. SLC-20261013-0001')],
    response: obj({ order: generic }, ['order']),
  }),
  pub('post', '/me/orders/:code/reorder', 'Customer', 'Still-sellable lines land in the cart', {
    parameters: [customerToken, pathParam('code', 'e.g. SLC-20261013-0001')],
    response: obj(
      { cart: generic, quote: generic, issues: arr(generic), unavailable: arr(generic) },
      ['cart', 'unavailable'],
    ),
  }),
  // O16 — the signed-in customer's points.
  pub('get', '/me/loyalty', 'Customer', 'Points balance, tier, next tier and points expiring within 30 days', {
    parameters: [customerToken],
    response: obj({
      loyalty: obj({
        enabled: bool,
        balance: int,
        value: money,
        tier: { ...obj({ code: str, name: generic, multiplier: int }), nullable: true },
        nextTier: { ...obj({ name: generic, missing: money }), nullable: true },
        expiringSoon: arr(obj({ points: int, expiresAt: isoDate })),
      }),
    }),
  }),
  pub('get', '/me/loyalty/history', 'Customer', 'Points ledger (no staff notes), newest first', {
    parameters: [customerToken, { name: 'page', in: 'query', schema: int }],
    response: obj({
      items: arr(obj({ at: isoDate, kind: str, points: int, balanceAfter: int, orderCode: { ...str, nullable: true } })),
      total: int,
      page: int,
      pageSize: int,
    }),
  }),
  // O11 step 6 — Decree 13 self-service data rights.
  pub('get', '/me/data-export', 'Customer', 'Own data as JSON (profile, addresses, orders, loyalty)', {
    parameters: [customerToken],
    response: obj({ generatedAt: str, profile: generic, addresses: arr(generic), orders: arr(generic) }, [
      'generatedAt',
      'profile',
      'addresses',
      'orders',
    ]),
  }),
  pub('post', '/me/erase', 'Customer', 'Request erasure; revokes every session (202)', {
    parameters: [customerToken],
    requestBody: obj({ confirm: bool }, ['confirm']),
    response: obj({ request: generic }, ['request']),
  }),
  // O11 step 4 — server carts. X-Cart-Token (guest) and/or X-Customer-Token (session); both
  // together merge the guest cart into the customer's. Every response re-quotes server-side.
  pub('post', '/carts', 'Carts', 'Create a cart (guests get a cartToken; sessions reuse theirs)', {
    parameters: [customerTokenOptional],
    requestBody: obj({
      locationRef: str,
      receiveMethod: obj({ kind: str, address: generic }),
      pickup: obj({ asap: bool, slot: obj({ startsAt: str }, ['startsAt']) }),
      locale: str,
      contact: obj({ name: str, phone: str, email: str }),
      promotionCode: { type: ['string', 'null'] },
      captchaToken: str,
    }),
    response: obj({ cartToken: str, cart: generic, quote: generic, issues: arr(generic) }, ['cart']),
  }),
  pub('get', '/carts/current', 'Carts', 'Current cart re-quoted with per-line issues', {
    parameters: [cartToken, customerTokenOptional],
    response: cartView,
  }),
  pub('patch', '/carts/current', 'Carts', 'Patch branch / receiveMethod / pickup / contact / locale', {
    parameters: [cartToken, customerTokenOptional],
    requestBody: generic,
    response: cartView,
  }),
  pub('post', '/carts/current/lines', 'Carts', 'Add a line (identical signature tops up quantity)', {
    parameters: [cartToken, customerTokenOptional],
    requestBody: obj(
      {
        sellableUid: str,
        variantUid: str,
        selected: arr(obj({ groupUid: str, optionUid: str, quantity: int }, ['groupUid', 'optionUid'])),
        quantity: int,
        note: str,
      },
      ['sellableUid', 'quantity'],
    ),
    response: cartView,
  }),
  pub('patch', '/carts/current/lines/:lineId', 'Carts', 'Update a line (404 for foreign ids)', {
    parameters: [cartToken, customerTokenOptional, pathParam('lineId')],
    requestBody: generic,
    response: cartView,
  }),
  pub('delete', '/carts/current/lines/:lineId', 'Carts', 'Remove a line (404 for foreign ids)', {
    parameters: [cartToken, customerTokenOptional, pathParam('lineId')],
    response: cartView,
  }),
  pub('post', '/carts/current/checkout', 'Carts', 'Checkout → POST /orders shape (token shown once)', {
    parameters: [cartToken, customerTokenOptional],
    requestBody: obj(
      {
        consent: obj({ policyVersion: str, accepted: bool, marketingOptIn: bool }, ['policyVersion', 'accepted']),
        payment: obj({ providerCode: str }, ['providerCode']),
        redeemPoints: { ...int, description: 'O16: loyalty points to spend; refused with LOYALTY_* errors at checkout' },
        captchaToken: str,
        idempotencyKey: str,
      },
      ['consent'],
    ),
    response: obj({ order: generic, token: str, replayed: bool }, ['order', 'token', 'replayed']),
  }),
  // O13 wallet checkout: staff/customer starts a redirect session; the return landing is
  // display-only — capture always comes from the provider IPN, never the return URL.
  pub('post', '/payments/session', 'Payments', 'Start a wallet payment session (X-Order-Token)', {
    requestBody: obj({ orderCode: str, token: str }, ['orderCode', 'token']),
    response: generic,
  }),
  pub('get', '/payments/return/:provider', 'Payments', 'Wallet return landing (no side effects)', {
    parameters: [pathParam('provider', 'e.g. momo')],
    response: generic,
  }),
  pub('post', '/webhooks/:providerCode', 'Webhooks', 'Inbound payment-provider webhook (raw signed body)', {
    parameters: [pathParam('providerCode', 'e.g. sepay')],
    requestBody: generic,
    response: generic,
  }),
  // VNPay sends its IPN as GET — the signature covers the query-param set itself.
  pub('get', '/webhooks/:providerCode', 'Webhooks', 'Inbound provider IPN via signed query params (VNPay)', {
    parameters: [pathParam('providerCode', 'e.g. vnpay')],
    response: generic,
  }),
  pub('get', '/openapi.json', 'Meta', 'This OpenAPI document (cached 1 hour)', {
    response: { type: 'object', description: 'OpenAPI 3.1 document' },
  }),

  // ── Admin: catalog ──────────────────────────────────────────────────────────
  adm('get', '/categories', 'Catalog', 'Category tree', ['catalog.manage']),
  adm('post', '/categories', 'Catalog', 'Create a category', ['catalog.manage']),
  adm('put', '/categories/:id', 'Catalog', 'Update a category', ['catalog.manage'], {
    parameters: [pathParam('id')],
  }),
  adm('post', '/categories/:id/move', 'Catalog', 'Move a category', ['catalog.manage'], {
    parameters: [pathParam('id')],
  }),
  adm('delete', '/categories/:id', 'Catalog', 'Delete a category', ['catalog.manage'], {
    parameters: [pathParam('id')],
  }),
  adm('get', '/availability/locations', 'Catalog', 'Locations the caller may toggle', ['catalog.manage']),
  adm('get', '/availability', 'Catalog', 'Availability list', ['catalog.manage']),
  adm('post', '/availability/toggle', 'Catalog', 'Toggle a product availability', ['catalog.manage']),

  // ── Admin: branches & staff ─────────────────────────────────────────────────
  adm('get', '/admin-units', 'Branches', 'Administrative units (internal view)', ['settings.manage']),
  adm('get', '/branches', 'Branches', 'Branch list', ['settings.manage']),
  adm('post', '/branches', 'Branches', 'Create a branch', ['settings.manage']),
  adm('get', '/branches/:code', 'Branches', 'Branch detail', ['settings.manage'], {
    parameters: [pathParam('code')],
  }),
  adm('patch', '/branches/:code', 'Branches', 'Update a branch', ['settings.manage'], {
    parameters: [pathParam('code')],
  }),
  adm('put', '/branches/:code', 'Branches', 'Update a branch', ['settings.manage'], {
    parameters: [pathParam('code')],
  }),
  adm('post', '/branches/:code/delivery-quote', 'Branches', 'Delivery quote for a branch', ['settings.manage'], {
    parameters: [pathParam('code')],
  }),
  // O12: inbox staff pause/resume ordering and toggle busy mode (screens N3).
  adm('post', '/branches/:code/pause', 'Branches', 'Pause ordering (minutes|until|endOfDay, kinds)', ['order.process'], {
    parameters: [pathParam('code')],
  }),
  adm('post', '/branches/:code/resume', 'Branches', 'Resume ordering (optional kinds)', ['order.process'], {
    parameters: [pathParam('code')],
  }),
  adm('post', '/branches/:code/busy', 'Branches', 'Set busy mode (extraMinutes + minutes)', ['order.process'], {
    parameters: [pathParam('code')],
  }),
  adm('post', '/branches/:code/busy/clear', 'Branches', 'Clear busy mode', ['order.process'], {
    parameters: [pathParam('code')],
  }),
  adm('get', '/staff-scopes', 'Branches', 'Staff location scopes', ['scope.manage']),
  adm('put', '/staff-scopes/:adminUserId', 'Branches', 'Set a staff member scope', ['scope.manage'], {
    parameters: [pathParam('adminUserId')],
  }),

  // ── Admin: orders ───────────────────────────────────────────────────────────
  adm('get', '/orders', 'Orders', 'Order inbox list', ['order.read']),
  adm('get', '/orders/summary', 'Orders', 'Inbox counts', ['order.read']),
  adm('get', '/orders/branches', 'Orders', 'Branches visible to the caller', ['order.read']),
  adm('get', '/orders/delivery-staff', 'Orders', 'Couriers assignable for a branch', ['order.read']),
  adm('get', '/orders/stream', 'Orders', 'SSE order stream', ['order.read']),
  adm('get', '/orders/export', 'Orders', 'CSV export', ['export']),
  adm('get', '/orders/:id', 'Orders', 'Order detail', ['order.read'], { parameters: [pathParam('id')] }),
  adm('post', '/orders/:id/payment-link', 'Orders', 'Issue a payment link', ['order.read'], {
    parameters: [pathParam('id')],
  }),
  adm('post', '/orders/:id/transition', 'Orders', 'Transition the order', ['order.process'], {
    parameters: [pathParam('id')],
  }),
  adm('post', '/orders/:id/notes', 'Orders', 'Add a staff note', ['order.process'], {
    parameters: [pathParam('id')],
  }),
  adm('post', '/orders/:id/cash-handover', 'Orders', 'Record a cash handover', ['payment.record-cash'], {
    parameters: [pathParam('id')],
  }),
  // O13 carrier legs ("Gọi xe"): quote, book, cancel — staff-initiated, idempotent booking.
  adm('post', '/orders/:id/carrier/quote', 'Orders', 'Carrier fee quote for the delivery leg', ['order.process'], {
    parameters: [pathParam('id')],
    requestBody: obj({ serviceId: str }),
  }),
  adm('post', '/orders/:id/carrier/book', 'Orders', 'Book a carrier trip (idempotent)', ['order.process'], {
    parameters: [pathParam('id')],
    requestBody: obj({ serviceId: str, note: str, notifyCustomer: bool }),
  }),
  adm('post', '/orders/:id/carrier/cancel', 'Orders', 'Cancel the booked carrier trip', ['order.process'], {
    parameters: [pathParam('id')],
    requestBody: obj({ reason: str }),
  }),
  adm('post', '/orders/:id/cancel', 'Orders', 'Cancel the order', ['order.cancel'], {
    parameters: [pathParam('id')],
  }),
  adm('get', '/orders/:id/lines/:lineId/cancel-preview', 'Orders', 'Line-cancel preview', ['order.edit-lines'], {
    parameters: [pathParam('id'), pathParam('lineId')],
  }),
  adm('post', '/orders/:id/lines/:lineId/cancel', 'Orders', 'Cancel an order line', ['order.edit-lines'], {
    parameters: [pathParam('id'), pathParam('lineId')],
  }),
  adm('post', '/orders/:id/refunds', 'Orders', 'Open a refund', ['refund.manage'], {
    parameters: [pathParam('id')],
  }),
  adm('post', '/refunds/:id/settle', 'Orders', 'Settle a refund', ['refund.manage'], {
    parameters: [pathParam('id')],
  }),
  adm('post', '/orders/:id/manual-payments', 'Orders', 'Record a manual payment', ['payment.review'], {
    parameters: [pathParam('id')],
  }),

  // ── Admin: O12 print, kitchen display, tables & sessions ───────────────────
  adm('get', '/print/orders/:id', 'Orders', 'Kitchen-ticket / provisional-receipt print payload', ['order.read'], {
    parameters: [pathParam('id')],
  }),
  adm('get', '/print/table-sessions/:id', 'Tables', 'Merged session receipt ("In hóa đơn bàn")', ['table.manage'], {
    parameters: [pathParam('id')],
  }),
  adm('get', '/kitchen', 'Kitchen', 'KDS board (per-station columns)', ['kitchen.read'], {
    parameters: [{ name: 'branch', in: 'query', schema: str }],
  }),
  adm('get', '/kitchen/stream', 'Kitchen', 'KDS-scoped SSE stream', ['kitchen.read'], {
    parameters: [{ name: 'branch', in: 'query', schema: str }],
  }),
  adm('post', '/kitchen/lines/:lineId/prepared', 'Kitchen', 'Mark one line prepared', ['kitchen.read'], {
    parameters: [pathParam('lineId')],
    requestBody: obj({ prepared: bool }, ['prepared']),
  }),
  adm('post', '/kitchen/orders/:id/start', 'Kitchen', 'Mark the order started in the kitchen', ['kitchen.read'], {
    parameters: [pathParam('id')],
  }),
  adm('post', '/kitchen/orders/:id/complete', 'Kitchen', 'Whole order ready (preparing → ready)', ['kitchen.read'], {
    parameters: [pathParam('id')],
  }),
  adm('get', '/tables', 'Tables', 'Dining tables the caller can see', ['table.manage'], {
    parameters: [{ name: 'branch', in: 'query', schema: str }],
  }),
  adm('post', '/tables', 'Tables', 'Create a table (or `{ bulk: { from, to } }` for a range)', ['table.manage'], {
    requestBody: obj({
      locationRef: str,
      code: str,
      name: str,
      area: str,
      seats: int,
      bulk: obj({ prefix: str, from: int, to: int }),
    }),
  }),
  adm('put', '/tables/:id', 'Tables', 'Update name/area/seats/code/active', ['table.manage'], {
    parameters: [pathParam('id')],
    requestBody: obj({ name: str, area: str, seats: int, code: str, active: bool }),
  }),
  adm('post', '/tables/:id/rotate-qr', 'Tables', 'Rotate the QR secret (old link dies at once)', ['table.manage'], {
    parameters: [pathParam('id')],
  }),
  adm('get', '/tables/:id/qr.svg', 'Tables', 'Menu URL as a QR SVG (image/svg+xml)', ['table.manage'], {
    parameters: [pathParam('id')],
  }),
  adm('get', '/table-sessions', 'Tables', 'Sessions with per-order totals/outstanding', ['table.manage'], {
    parameters: [
      { name: 'branch', in: 'query', schema: str },
      { name: 'status', in: 'query', schema: { ...str, enum: ['open', 'closed'] } },
    ],
  }),
  // Close also touches money — hence the extra `payment.record-cash` permission.
  adm('post', '/table-sessions/:id/close', 'Tables', 'Collect outstanding + complete groups + close', ['table.manage', 'payment.record-cash'], {
    parameters: [pathParam('id')],
    requestBody: obj({
      method: { ...str, enum: ['cash', 'transfer-at-counter'] },
      reference: { ...str, description: 'Bank reference for transfer-at-counter' },
    }),
  }),

  // ── Admin: payment review ───────────────────────────────────────────────────
  adm('get', '/payment-reviews', 'Payments', 'Transfer review queue', ['payment.review']),
  adm('get', '/payment-reviews/orders', 'Payments', 'Order search for review', ['payment.review']),
  adm('post', '/payment-reviews/:id/assign', 'Payments', 'Assign a transaction to an order', ['payment.review'], {
    parameters: [pathParam('id')],
  }),
  adm('post', '/payment-reviews/:id/refund-due', 'Payments', 'Mark a refund due', ['payment.review'], {
    parameters: [pathParam('id')],
  }),
  adm('post', '/payment-reviews/:id/reopen', 'Payments', 'Reopen a review', ['payment.review'], {
    parameters: [pathParam('id')],
  }),
  adm('post', '/payment-reviews/:id/ignore', 'Payments', 'Ignore a transaction', ['payment.review'], {
    parameters: [pathParam('id')],
  }),

  // ── Admin: staff drafts ─────────────────────────────────────────────────────
  adm('post', '/drafts/quote', 'Orders', 'Price a phone-order draft', ['order.create'], {
    requestBody: obj(
      { ...((cartBody.properties ?? {}) as Record<string, JsonSchema>) },
      ['branch', 'receiveMethod', 'lines'],
    ),
  }),
  adm('post', '/drafts', 'Orders', 'Create a phone-order draft (consent version is stamped by the server)', ['order.create'], {
    requestBody: obj(
      {
        ...((cartBody.properties ?? {}) as Record<string, JsonSchema>),
        contact: obj({ name: str, phone: str, email: str }, ['phone']),
        consent: obj(
          { accepted: bool, marketingOptIn: bool },
          ['accepted'],
        ),
        customerNote: str,
        idempotencyKey: str,
      },
      ['branch', 'receiveMethod', 'lines', 'contact', 'consent', 'idempotencyKey'],
    ),
  }),
  adm('post', '/drafts/:id/confirm', 'Orders', 'Confirm a draft into an order', ['order.create'], {
    parameters: [pathParam('id')],
  }),
  adm('delete', '/drafts/:id', 'Orders', 'Discard a draft', ['order.create'], {
    parameters: [pathParam('id')],
  }),

  // ── Admin: customers & Decree 13 data rights ─────────────────────────────────
  adm('get', '/customers', 'Customers', 'Directory (phone → HMAC, name/email ilike; scoped)', ['customer.read'], {
    parameters: [
      { name: 'q', in: 'query', schema: str },
      { name: 'status', in: 'query', schema: str, description: 'verified | unverified' },
      { name: 'marketing', in: 'query', schema: str, description: 'yes = marketing consent' },
      { name: 'page', in: 'query', schema: int },
      { name: 'pageSize', in: 'query', schema: int },
    ],
    response: obj({ items: arr(generic), page: int, pageSize: int, total: int }, ['items']),
  }),
  adm('get', '/customers/:id', 'Customers', 'Masked profile + orders + addresses + requests', ['customer.read'], {
    parameters: [pathParam('id', 'Customer documentId')],
    response: obj(
      { customer: generic, orders: arr(generic), addresses: arr(generic), requests: arr(generic) },
      ['customer'],
    ),
  }),
  adm('put', '/customers/:id', 'Customers', 'Edit name + staff note (masked diff logged)', ['customer.manage'], {
    parameters: [pathParam('id', 'Customer documentId')],
    requestBody: obj({ name: str, staffNote: str }),
  }),
  adm('post', '/customers/:id/reveal-phone', 'Customers', 'Show full phone once (change-logged)', ['customer.manage'], {
    parameters: [pathParam('id', 'Customer documentId')],
    response: obj({ phone: { anyOf: [str, { type: 'null' }] } as unknown as JsonSchema }),
  }),
  adm('get', '/customers/:id/export', 'Customers', 'Decree 13 export (branch-scoped)', ['customer.manage'], {
    parameters: [pathParam('id', 'Customer documentId')],
    response: obj(
      { generatedAt: str, profile: generic, addresses: arr(generic), orders: arr(generic) },
      ['generatedAt', 'profile', 'addresses', 'orders'],
    ),
  }),
  adm('get', '/data-requests', 'Customers', 'Data-request queue (filter by status)', ['customer.erase'], {
    parameters: [
      { name: 'status', in: 'query', schema: str },
      { name: 'page', in: 'query', schema: int },
      { name: 'pageSize', in: 'query', schema: int },
    ],
    response: obj({ items: arr(generic), page: int, pageSize: int, total: int }, ['items']),
  }),
  adm('post', '/data-requests', 'Customers', 'File a request by phone (hash only stored)', ['customer.erase'], {
    requestBody: obj({ phone: str, kind: str, note: str }, ['phone', 'kind']),
    response: obj({ request: generic }, ['request']),
  }),
  adm('post', '/data-requests/:id/process', 'Customers', 'Run erasure now (open orders → waiting)', ['customer.erase'], {
    parameters: [pathParam('id', 'Request documentId')],
    response: obj({ request: generic }, ['request']),
  }),
  adm('post', '/data-requests/:id/reject', 'Customers', 'Refuse a request with a reason', ['customer.erase'], {
    parameters: [pathParam('id', 'Request documentId')],
    requestBody: obj({ reason: str }, ['reason']),
    response: obj({ request: generic }, ['request']),
  }),

  // ── Admin: settings ─────────────────────────────────────────────────────────
  adm('get', '/settings', 'Settings', 'Sales settings', ['settings.manage']),
  adm('put', '/settings', 'Settings', 'Update sales settings', ['settings.manage']),
  adm('get', '/settings/alert-rules', 'Settings', 'Alert rules', ['settings.manage']),
  adm('put', '/settings/alert-rules', 'Settings', 'Update alert rules', ['settings.manage']),

  // ── Admin: alerts & ops ─────────────────────────────────────────────────────
  adm('get', '/alerts', 'Ops', 'Alert inbox', ['ops.read']),
  adm('post', '/alerts/:id/acknowledge', 'Ops', 'Acknowledge an alert', ['ops.read'], {
    parameters: [pathParam('id')],
  }),
  adm('get', '/ops/status', 'Ops', 'Operations status board', ['ops.read']),
  adm('post', '/ops/jobs/:name/run', 'Ops', 'Run a catalog job now', ['ops.read'], {
    parameters: [pathParam('name')],
  }),
  adm('post', '/ops/outbox/:id/retry', 'Ops', 'Retry a failed outbox event', ['ops.read'], {
    parameters: [pathParam('id')],
  }),

  // ── Admin: reports & cash ───────────────────────────────────────────────────
  adm('get', '/reports/branches', 'Reports', 'Branches for report filters', ['report.read']),
  adm('get', '/cash-closing', 'Reports', 'Cash-closing summary', ['report.read']),
  adm('get', '/cash-closing/summary', 'Reports', 'Cash-closing summary (alias)', ['report.read']),
  adm('post', '/cash-closing', 'Reports', 'Close the day', ['report.read']),
  adm('post', '/cash-closing/:id/adjust', 'Reports', 'Adjust a closing', ['report.read'], {
    parameters: [pathParam('id')],
  }),
  adm('get', '/reports/sales', 'Reports', 'Sales report by business date', ['report.read']),

  // ── Admin: audit ────────────────────────────────────────────────────────────
  adm('get', '/audit-log', 'Audit', 'Change history', ['audit.read']),
  adm('get', '/audit-log/actors', 'Audit', 'Actors seen in the log', ['audit.read']),
  adm('get', '/audit-log/export', 'Audit', 'CSV export', ['audit.read', 'export']),
  adm('get', '/audit-log/:id', 'Audit', 'Entry detail', ['audit.read'], { parameters: [pathParam('id')] }),

  // ── Admin: outbound webhooks (O10 X1) ───────────────────────────────────────
  adm('get', '/webhooks', 'Webhooks', 'Endpoints + 24h delivery stats', ['webhook.manage'], {
    response: obj({
      results: arr(
        obj({
          id: int,
          url: str,
          description: str,
          events: arr(str),
          active: bool,
          includeCustomer: bool,
          consecutiveFailures: int,
          disabledAt: isoDate,
          disabledReason: str,
          stats24h: obj({ succeeded: int, failed: int }),
        }),
      ),
    }),
  }),
  adm('get', '/webhooks/events', 'Webhooks', 'Public event catalog with sample payloads', ['webhook.manage']),
  adm('get', '/webhooks/:id', 'Webhooks', 'Endpoint detail (never the secret)', ['webhook.manage'], {
    parameters: [pathParam('id')],
  }),
  adm(
    'post',
    '/webhooks',
    'Webhooks',
    'Create an endpoint — the signing secret is returned once',
    ['webhook.manage'],
    {
      requestBody: obj(
        {
          url: { ...str, format: 'uri' },
          description: str,
          events: arr(str),
          includeCustomer: bool,
        },
        ['url', 'events'],
      ),
      response: obj({ endpoint: generic, secret: str }),
    },
  ),
  adm('patch', '/webhooks/:id', 'Webhooks', 'Update URL/description/events/includeCustomer', ['webhook.manage'], {
    parameters: [pathParam('id')],
  }),
  adm('put', '/webhooks/:id', 'Webhooks', 'Update (PUT alias of PATCH)', ['webhook.manage'], {
    parameters: [pathParam('id')],
  }),
  adm('post', '/webhooks/:id/rotate-secret', 'Webhooks', 'Rotate the secret (old one valid 24h)', ['webhook.manage'], {
    parameters: [pathParam('id')],
    response: obj({ endpoint: generic, secret: str }),
  }),
  adm('post', '/webhooks/:id/active', 'Webhooks', 'Enable or disable the endpoint', ['webhook.manage'], {
    parameters: [pathParam('id')],
    requestBody: obj({ active: bool }, ['active']),
  }),
  adm('post', '/webhooks/:id/test', 'Webhooks', 'Send an ordering.ping synchronously', ['webhook.manage'], {
    parameters: [pathParam('id')],
    response: obj({ deliveryId: int, ok: bool, statusCode: int, durationMs: int, error: str }),
  }),
  adm('get', '/webhooks/:id/deliveries', 'Webhooks', 'Delivery log', ['webhook.manage'], {
    parameters: [
      pathParam('id'),
      { name: 'status', in: 'query', schema: { ...str, enum: ['pending', 'succeeded', 'failed'] } },
      { name: 'page', in: 'query', schema: int },
      { name: 'pageSize', in: 'query', schema: int },
    ],
  }),
  adm('post', '/webhook-deliveries/:id/resend', 'Webhooks', 'Re-queue a delivery', ['webhook.manage'], {
    parameters: [pathParam('id', 'delivery id')],
  }),
  // O10 catalog CSV import/export (screens X3).
  adm('get', '/catalog/imports', 'Catalog import', 'Recent catalog CSV import runs', ['catalog.manage']),
  adm(
    'get',
    '/catalog/export',
    'Catalog import',
    'Download products.csv or modifiers.csv',
    ['catalog.manage', 'export'],
    {
      parameters: [
        {
          name: 'kind',
          in: 'query',
          required: true,
          schema: { ...str, enum: ['products', 'modifiers'] },
        },
      ],
      response: str,
    },
  ),
  adm(
    'post',
    '/catalog/import',
    'Catalog import',
    'Upload a catalog CSV (text/csv ≤256KB or application/octet-stream ≤2MB); dryRun defaults to true',
    ['catalog.manage'],
    {
      parameters: [
        {
          name: 'kind',
          in: 'query',
          required: true,
          schema: { ...str, enum: ['products', 'modifiers'] },
        },
        { name: 'dryRun', in: 'query', schema: { ...str, enum: ['true', 'false'] } },
        { name: 'filename', in: 'query', schema: str },
      ],
      requestBody: { ...str, description: 'Raw CSV file bytes (UTF-8, RFC 4180)' },
      response: obj({ import: generic, report: generic }),
    },
  ),
  adm(
    'post',
    '/catalog/import/:id/apply',
    'Catalog import',
    'Apply a dry-run-validated import — 409 CATALOG_IMPORT_STALE when the catalog moved',
    ['catalog.manage'],
    { parameters: [pathParam('id', 'catalog-import documentId')] },
  ),

  // ── Admin: editable email templates (O10 X4) ───────────────────────────────
  // O7 ops extras (documented with O8: O7 predates the O10 OpenAPI gate).
  adm('put', '/availability/daily-limit', 'Catalog', 'Set or clear a per-branch daily portion limit', ['catalog.toggle-availability'], {
    requestBody: obj({ locationRef: str, entityType: str, entityDocumentId: str, dailyLimit: int }),
  }),
  adm('get', '/courier/deliveries', 'Deliveries', "Courier phone page: today's deliveries assigned to me", ['order.process'], {
    parameters: [{ name: 'view', in: 'query', schema: str, description: 'active | done' }],
  }),
  adm('post', '/orders/:id/edit/preview', 'Orders', 'Price a staff edit without saving it', ['order.edit'], {
    parameters: [pathParam('id')],
    requestBody: generic,
  }),
  adm('post', '/orders/:id/edit', 'Orders', 'Apply a staff edit (lines, time, address)', ['order.edit'], {
    parameters: [pathParam('id')],
    requestBody: generic,
  }),
  // O8 promotions (screens K1–K4) and ratings (R1–R2).
  adm('get', '/price-lists', 'Price lists', 'Named override and adjust lists', ['price.manage']),
  adm('post', '/price-lists', 'Price lists', 'Create a price list', ['price.manage'], { requestBody: generic }),
  adm('get', '/price-lists/options', 'Price lists', 'Branches, variants, categories and groups for the editor', ['price.manage'], {
    parameters: [{ name: 'locale', in: 'query', schema: str }],
  }),
  adm('get', '/price-lists/:id', 'Price lists', 'One price list', ['price.manage'], { parameters: [pathParam('id')] }),
  adm('put', '/price-lists/:id', 'Price lists', 'Replace a price list', ['price.manage'], {
    parameters: [pathParam('id')],
    requestBody: generic,
  }),
  adm('post', '/price-lists/:id/active', 'Price lists', 'Switch a price list on or off', ['price.manage'], {
    parameters: [pathParam('id')],
    requestBody: obj({ active: bool }, ['active']),
  }),
  adm('post', '/price-preview', 'Price lists', 'Explain which list wins for a variant and context', ['price.manage'], {
    requestBody: obj({ variantId: str, channel: str, locationRef: str, customerGroup: str, at: isoDate }, ['variantId']),
  }),
  adm('get', '/customer-groups', 'Customer groups', 'Groups that can select a price', ['price.manage']),
  adm('post', '/customer-groups', 'Customer groups', 'Create a customer group', ['price.manage'], { requestBody: generic }),
  adm('get', '/customer-groups/search', 'Customer groups', 'Masked customer search for the member picker', ['price.manage'], {
    parameters: [{ name: 'q', in: 'query', schema: str }],
  }),
  adm('get', '/customer-groups/:id', 'Customer groups', 'One group and its members', ['price.manage'], {
    parameters: [pathParam('id')],
  }),
  adm('put', '/customer-groups/:id', 'Customer groups', 'Update a group (code is immutable)', ['price.manage'], {
    parameters: [pathParam('id')],
    requestBody: generic,
  }),
  adm('post', '/customer-groups/:id/members', 'Customer groups', 'Add or remove members; the log stores counts only', ['price.manage'], {
    parameters: [pathParam('id')],
    requestBody: obj({ add: arr(str), remove: arr(str) }),
  }),
  adm('get', '/promotions', 'Promotions', 'List with running/scheduled/off/expired tabs and search', ['promotion.manage'], {
    parameters: [
      { name: 'status', in: 'query', schema: str },
      { name: 'kind', in: 'query', schema: str },
      { name: 'q', in: 'query', schema: str },
      { name: 'page', in: 'query', schema: int },
    ],
  }),
  adm('post', '/promotions', 'Promotions', 'Create a promotion (optional first `code`)', ['promotion.manage'], {
    requestBody: generic,
  }),
  adm('get', '/promotions/targets', 'Promotions', 'Branches, products and categories for the picker', ['promotion.manage']),
  adm('get', '/promotions/:id', 'Promotions', 'One promotion with stats', ['promotion.manage'], {
    parameters: [pathParam('id')],
  }),
  adm('put', '/promotions/:id', 'Promotions', 'Update conditions (kind and usedCount never change)', ['promotion.manage'], {
    parameters: [pathParam('id')],
    requestBody: generic,
  }),
  adm('post', '/promotions/:id/active', 'Promotions', 'Switch on/off', ['promotion.manage'], {
    parameters: [pathParam('id')],
    requestBody: obj({ active: bool }, ['active']),
  }),
  adm('get', '/promotions/:id/codes/export', 'Promotions', 'Codes as CSV (BOM)', ['promotion.manage', 'export'], {
    parameters: [pathParam('id')],
  }),
  adm('get', '/promotions/:id/codes', 'Promotions', 'Codes page', ['promotion.manage'], {
    parameters: [pathParam('id'), { name: 'q', in: 'query', schema: str }, { name: 'page', in: 'query', schema: int }],
  }),
  adm('post', '/promotions/:id/codes', 'Promotions', 'Add one code or generate up to 5000', ['promotion.manage'], {
    parameters: [pathParam('id')],
    requestBody: obj({
      code: str,
      usageLimit: int,
      generate: obj({ count: int, prefix: str, length: int, usageLimit: int, batch: str }),
    }),
    response: obj({ generated: int, batch: str }),
  }),
  adm('get', '/promotions/:id/redemptions', 'Promotions', 'Orders that used the promotion', ['promotion.manage'], {
    parameters: [pathParam('id'), { name: 'page', in: 'query', schema: int }],
  }),
  adm('post', '/promotion-codes/:id/active', 'Promotions', 'Switch one code on/off', ['promotion.manage'], {
    parameters: [pathParam('id')],
    requestBody: obj({ active: bool }, ['active']),
  }),
  // O9 step 5: gift-card staff surfaces (G1–G3 + physical batches). Responses never carry a
  // plaintext code or hash — `masked`/`last4` at most. The only plaintext surfaces are the
  // one-time issue response when no mail went out, the one-time batch-generate response and
  // the batch CSV export while the seal survives.
  adm('get', '/gift-cards', 'Gift cards', 'List with status tabs, source filter, search and summary cards', ['gift-card.manage'], {
    parameters: [
      { name: 'tab', in: 'query', schema: { ...str, enum: ['active', 'blocked', 'expired', 'zero', 'all'] } },
      { name: 'source', in: 'query', schema: { ...str, enum: ['sold', 'manual'] } },
      { name: 'q', in: 'query', schema: str, description: 'Last-4 or order code. A full card code answers 400 — use POST /search' },
      { name: 'page', in: 'query', schema: int },
    ],
    response: obj({
      items: arr(generic),
      total: int,
      page: int,
      pageSize: int,
      summary: obj({ circulating: money, soldThisMonth: money, redeemedThisMonth: money }),
    }),
  }),
  adm('post', '/gift-cards/search', 'Gift cards', 'Resolve a FULL code from the request body — never the URL', ['gift-card.manage'], {
    requestBody: obj({ code: str }, ['code']),
    response: generic,
  }),
  adm('post', '/gift-cards', 'Gift cards', 'Issue a complimentary card — `code` only when no recipient mail went out', ['gift-card.manage'], {
    requestBody: obj(
      {
        amount: money,
        reason: str,
        recipientEmail: str,
        recipientName: str,
        message: str,
        expiresAt: isoDate,
        locationRef: str,
      },
      ['amount', 'reason'],
    ),
    response: obj({
      card: generic,
      code: { ...str, nullable: true },
      emailSent: bool,
      recipientMasked: { ...str, nullable: true },
    }),
  }),
  adm('get', '/gift-cards/:id', 'Gift cards', 'One card with its append-only ledger, newest first', ['gift-card.manage'], {
    parameters: [pathParam('id'), { name: 'page', in: 'query', schema: int }],
    response: generic,
  }),
  adm('post', '/gift-cards/:id/block', 'Gift cards', 'Block a card — reason is mandatory', ['gift-card.manage'], {
    parameters: [pathParam('id')],
    requestBody: obj({ reason: str }, ['reason']),
  }),
  adm('post', '/gift-cards/:id/unblock', 'Gift cards', 'Unblock a card', ['gift-card.manage'], {
    parameters: [pathParam('id')],
    requestBody: obj({ reason: str }),
  }),
  adm('post', '/gift-cards/:id/extend', 'Gift cards', 'Move the expiry forward — never backward', ['gift-card.manage'], {
    parameters: [pathParam('id')],
    requestBody: obj({ expiresAt: isoDate, reason: str }, ['expiresAt', 'reason']),
  }),
  adm('post', '/gift-cards/:id/adjust', 'Gift cards', 'Signed balance correction — never below zero', ['gift-card.manage', 'gift-card.adjust'], {
    parameters: [pathParam('id')],
    requestBody: obj({ amount: int, reason: str }, ['amount', 'reason']),
  }),
  adm('post', '/gift-cards/:id/resend', 'Gift cards', 'Resend the code mail to the sealed recipient', ['gift-card.manage'], {
    parameters: [pathParam('id')],
    response: obj({ emailSent: bool, recipientMasked: { ...str, nullable: true } }),
  }),
  adm('get', '/gift-card-batches', 'Gift cards', 'Physical preprinted batches with sold/remaining counts', ['gift-card.manage'], {
    parameters: [{ name: 'page', in: 'query', schema: int }],
    response: obj({ items: arr(generic), total: int, page: int, pageSize: int }),
  }),
  adm('post', '/gift-card-batches/import', 'Gift cards', 'Import preprinted codes — all-or-nothing, plaintext body', ['gift-card.manage'], {
    requestBody: obj(
      { denomination: money, codes: arr(str), note: str, locationRef: str },
      ['denomination', 'codes'],
    ),
    response: obj({ batch: generic, imported: int }),
  }),
  adm('post', '/gift-card-batches', 'Gift cards', 'Generate codes for printing — the plaintext list returns once', ['gift-card.manage'], {
    requestBody: obj(
      { denomination: money, count: int, note: str, locationRef: str },
      ['denomination', 'count'],
    ),
    response: obj({ batch: generic, codes: arr(str) }),
  }),
  adm('get', '/gift-card-batches/:id', 'Gift cards', 'Batch detail with a page of masked cards', ['gift-card.manage'], {
    parameters: [pathParam('id'), { name: 'page', in: 'query', schema: int }],
    response: obj({ batch: generic, items: arr(generic), total: int, page: int, pageSize: int }),
  }),
  adm('get', '/gift-card-batches/:id/export', 'Gift cards', 'Batch codes as CSV — the sealed plaintext hand-off', ['gift-card.manage', 'export'], {
    parameters: [pathParam('id')],
  }),
  adm('get', '/loyalty/settings', 'Loyalty', 'Loyalty program settings', ['loyalty.manage'], {
    response: obj({ settings: generic }),
  }),
  adm('put', '/loyalty/settings', 'Loyalty', 'Save loyalty program settings (first enable stamps startsAt and seeds tiers)', ['loyalty.manage'], {
    requestBody: generic,
    response: obj({ settings: generic }),
  }),
  adm('get', '/loyalty/tiers', 'Loyalty', 'Tiers with customer counts', ['loyalty.manage'], {
    response: obj({ items: arr(generic) }),
  }),
  adm('post', '/loyalty/tiers', 'Loyalty', 'Create a tier', ['loyalty.manage'], {
    requestBody: generic,
    response: obj({ item: generic }),
  }),
  adm('get', '/customers/:id/loyalty', 'Loyalty', 'A customer points: balance, tier, lots and ledger (branch-scoped like the profile)', ['customer.read'], {
    parameters: [pathParam('id')],
    response: generic,
  }),
  adm('post', '/customers/:id/loyalty/adjust', 'Loyalty', 'Add or remove points with a required reason (logged)', ['customer.read', 'loyalty.adjust'], {
    parameters: [pathParam('id')],
    requestBody: obj({ points: int, reason: str, expiresAt: isoDate }, ['points', 'reason']),
    response: generic,
  }),
  adm('get', '/reports/loyalty', 'Loyalty', 'Points issued, used, expired and reversed; points in circulation and customers per tier', ['report.read'], {
    parameters: ['from', 'to', 'branch'].map((name) => ({ name, in: 'query' as const, schema: str })),
    response: generic,
  }),
  adm('post', '/loyalty/tiers/recalculate', 'Loyalty', 'Import 12-month order history into tier spend and review tiers (idempotent)', ['loyalty.manage'], {
    response: obj({ orders: int, customers: int }),
  }),
  adm('get', '/loyalty/tiers/:id', 'Loyalty', 'One tier', ['loyalty.manage'], {
    parameters: [pathParam('id')],
    response: obj({ item: generic }),
  }),
  adm('put', '/loyalty/tiers/:id', 'Loyalty', 'Update a tier (code is immutable; switch off instead of delete)', ['loyalty.manage'], {
    parameters: [pathParam('id')],
    requestBody: generic,
    response: obj({ item: generic }),
  }),
  adm('get', '/ratings', 'Ratings', 'Ratings in scope with summary', ['order.read'], {
    parameters: ['branch', 'stars', 'from', 'to', 'hasComment', 'status', 'page'].map((name) => ({
      name,
      in: 'query' as const,
      schema: str,
    })),
  }),
  adm('get', '/ratings/:id', 'Ratings', 'One rating with the order summary', ['order.read'], {
    parameters: [pathParam('id')],
  }),
  adm('post', '/ratings/:id/hide', 'Ratings', 'Hide or show a rating', ['order.read', 'rating.manage'], {
    parameters: [pathParam('id')],
    requestBody: obj({ hidden: bool }),
  }),
  adm('post', '/ratings/:id/note', 'Ratings', 'Internal note (never sent to the customer)', ['order.read', 'rating.manage'], {
    parameters: [pathParam('id')],
    requestBody: obj({ note: str }),
  }),
  adm('get', '/notification-templates', 'Email templates', 'All codes × locales with customized flags', [
    'settings.manage',
  ]),
  adm(
    'get',
    '/notification-templates/:code/:locale',
    'Email templates',
    'Effective subject/body + defaults + allowed variables',
    ['settings.manage'],
    {
      parameters: [pathParam('code', 'template code (e.g. customer.order-ready)'), pathParam('locale', 'vi|en')],
    },
  ),
  adm(
    'put',
    '/notification-templates/:code/:locale',
    'Email templates',
    'Save a subject/body override — 400 TEMPLATE_VARIABLE_UNKNOWN on stray {{vars}}',
    ['settings.manage'],
    {
      parameters: [pathParam('code'), pathParam('locale')],
      requestBody: obj({ subject: str, body: str }, ['subject', 'body']),
    },
  ),
  adm(
    'post',
    '/notification-templates/:code/:locale/preview',
    'Email templates',
    'Render {subject, body} (or the effective template) against sample data',
    ['settings.manage'],
    {
      parameters: [pathParam('code'), pathParam('locale')],
      requestBody: obj({ subject: str, body: str }),
      response: obj({ rendered: obj({ subject: str, text: str, html: str }), variables: arr(generic) }),
    },
  ),
  adm(
    'post',
    '/notification-templates/:code/:locale/test',
    'Email templates',
    'Send the sample render to the signed-in admin mailbox',
    ['settings.manage'],
    { parameters: [pathParam('code'), pathParam('locale')], response: obj({ sent: bool }) },
  ),
  adm(
    'delete',
    '/notification-templates/:code/:locale',
    'Email templates',
    'Delete the override — the template reverts to the built-in copy',
    ['settings.manage'],
    { parameters: [pathParam('code'), pathParam('locale')] },
  ),

  // O13 P3 "Kênh thông báo": per-template channel chain + ZNS mapping + staff test-send.
  adm('get', '/notification-channels', 'Notification channels', 'Channel chain + counters per template', [
    'settings.manage',
  ]),
  adm(
    'put',
    '/notification-channels/:template',
    'Notification channels',
    'Replace the channel chain / ZNS mapping / active flag of a template',
    ['settings.manage'],
    {
      parameters: [pathParam('template', 'e.g. customer.order-placed')],
      requestBody: obj({ channels: arr(str), zns: generic, active: bool }, ['channels']),
    },
  ),
  adm(
    'post',
    '/notification-channels/test',
    'Notification channels',
    'Test-send one template over a chosen channel (writes a test:* delivery row)',
    ['settings.manage'],
    { requestBody: obj({ template: str, channel: str, target: str }, ['template', 'channel', 'target']) },
  ),

  // O13 P1 "Nhà cung cấp": read-only grouped provider overview — masked ids, never secrets.
  adm('get', '/providers', 'Providers', 'Grouped provider cards with env/webhook status', [
    'settings.manage',
  ]),
];
