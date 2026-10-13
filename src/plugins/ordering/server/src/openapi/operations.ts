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
  { sku: str, quantity: int, choices: arr(obj({ group: str, option: str })) },
  ['sku', 'quantity'],
);

const cartBody = obj(
  {
    locationRef: str,
    receiveMethod: obj({
      kind: { ...str, enum: ['pickup', 'delivery'] },
      locationRef: str,
      address: obj({ street: str, ward: str, district: str, province: str, note: str }),
    }),
    scheduledAt: isoDate,
    lines: arr(cartLine),
    adjustments: arr(obj({ kind: str, code: str, label: str, amount: num })),
    note: str,
  },
  ['locationRef', 'receiveMethod', 'lines'],
);

export const OPERATIONS: Operation[] = [
  // ── Public content API ──────────────────────────────────────────────────────
  pub('get', '/catalog/categories', 'Catalog', 'Category tree for the storefront', {
    parameters: [
      { name: 'location', in: 'query', schema: str, description: 'Branch code (filters the tree)' },
      { name: 'locale', in: 'query', schema: str, description: 'vi | en' },
    ],
  }),
  pub('get', '/catalog/products', 'Catalog', 'Product page within a category', {
    parameters: [
      { name: 'category', in: 'query', schema: str },
      { name: 'cursor', in: 'query', schema: str },
      { name: 'limit', in: 'query', schema: int },
      { name: 'locale', in: 'query', schema: str },
    ],
  }),
  pub('get', '/catalog/products/:slug', 'Catalog', 'One product with variants and option groups', {
    parameters: [pathParam('slug', 'VI slug'), { name: 'locale', in: 'query', schema: str }],
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
  pub('post', '/quote', 'Orders', 'Price a cart without creating an order', {
    requestBody: cartBody,
    response: obj({
      subtotal: money,
      total: money,
      fulfillmentAmount: money,
      discounts: arr(generic),
      lines: arr(generic),
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
        consent: obj({ policyVersion: str }),
        note: str,
        captchaToken: str,
      },
      ['locationRef', 'receiveMethod', 'lines', 'contact', 'consent'],
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
        captchaToken: str,
        idempotencyKey: str,
      },
      ['consent'],
    ),
    response: obj({ order: generic, token: str, replayed: bool }, ['order', 'token', 'replayed']),
  }),
  pub('post', '/webhooks/:providerCode', 'Webhooks', 'Inbound payment-provider webhook (raw signed body)', {
    parameters: [pathParam('providerCode', 'e.g. sepay')],
    requestBody: generic,
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
  adm('post', '/drafts/quote', 'Orders', 'Price a phone-order draft', ['order.create']),
  adm('post', '/drafts', 'Orders', 'Create a phone-order draft', ['order.create']),
  adm('post', '/drafts/:id/confirm', 'Orders', 'Confirm a draft into an order', ['order.create'], {
    parameters: [pathParam('id')],
  }),
  adm('delete', '/drafts/:id', 'Orders', 'Discard a draft', ['order.create'], {
    parameters: [pathParam('id')],
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
];
