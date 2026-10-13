# Ordering storefront API (O3), SePay webhook (O4) and self-delivery (O5)

Public routes of the `ordering` plugin for the web app (phase OW). Base path with Salanca's REST prefix:
`/api/v1/ordering`. All routes are `auth: false`; each one rate-limits by the visitor IP, caps JSON bodies
at 32 KB and returns only the fields listed here. Source of truth: `src/plugins/ordering/server/src/
controllers/storefront.ts`, `domain/storefront/{parse,serialize}.ts`, contracts §11 and §21.

**OpenAPI (O10):** the public contract is also served as OpenAPI 3.1 at
`GET /api/v1/ordering/openapi.json` (public, cached 1 hour). The staff-facing document is generated
into [`ordering-admin-openapi.json`](ordering-admin-openapi.json) by `pnpm run ordering:openapi` —
regenerate it whenever `routes/index.ts` changes; `scripts/ordering/openapi.mjs` in `check:ordering`
fails on an undocumented route.

## Calling rules

- **Server-side calls from salanca-web** must send `x-salanca-intake-secret: <FORM_INTAKE_SHARED_SECRET>`
  and `x-salanca-visitor-ip: <visitor IP>`; otherwise every visitor shares the web server's rate-limit
  bucket. Browser calls need neither.
- **Order token**: returned once by `POST /orders` (and again on an idempotent replay). Send it only as
  the `X-Order-Token` header. A token in the URL query is refused (`ORDER_TOKEN_INVALID`). The link in
  emails is `<web>/don-hang#t=<token>`: read it from the fragment, call the API with the header, then remove
  the fragment with `history.replaceState`; keep it in `sessionStorage` for reloads only.
- **Idempotency-Key** header (8–128 of `A-Z a-z 0-9 _ : . -`) is required on `POST /orders`. Create one key
  when the checkout page opens and reuse it for retries; the same key returns the same order and token.
- **Money** is integer VND. **Times** are UTC ISO strings; show them in the branch `timezone`.
- **Errors**: `{ "error": { "code", "message", "details"?, "requestId" } }` with the HTTP status below.

| Code | Status | When |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | bad input; `details.field` names it (`contact.phone`, `lines.0.quantity`, `Idempotency-Key`…) |
| `CONSENT_REQUIRED` | 400 | `consent.accepted` not `true` or policy version not current |
| `CAPTCHA_FAILED` | 400 | captcha token missing or rejected |
| `LOCATION_UNAVAILABLE` | 400 | branch inactive or not selling online |
| `FULFILLMENT_UNAVAILABLE` | 400 | the branch does not offer pickup |
| `DELIVERY_UNAVAILABLE` | 400 | the branch does not deliver, or the address is outside every delivery zone / below a zone minimum |
| `SLOT_TOO_EARLY` | 400 | slot earlier than now + lead time; `details.earliest` |
| `SLOT_UNAVAILABLE` | 400 | not a slot of the branch (closed, misaligned, beyond max days, ASAP-only/scheduled-only) |
| `SLOT_FULL` | 409 | the slot reached its capacity |
| `ASAP_UNAVAILABLE` | 400 | closed now or not ready before closing; pick a slot |
| `MIN_ORDER_NOT_MET` | 400 | `details.minOrderAmount`, `details.subtotal` |
| `SELLABLE_NOT_FOUND` / `SELLABLE_UNAVAILABLE` / `LINE_INVALID` | 404 / 400 / 400 | `details.lineIndex` |
| `PRICE_CHANGED` | 409 | `expectedCartHash` no longer matches; show the new quote |
| `IDEMPOTENCY_PAYLOAD_MISMATCH` / `IDEMPOTENCY_IN_PROGRESS` | 409 | key reused with another body / still running |
| `ORDER_TOKEN_INVALID` | 401 | missing, malformed or unknown token |
| `ORDER_LOOKUP_FAILED` | 404 | lookup did not match (same error for unknown code and wrong phone) |
| `CANCEL_NOT_ALLOWED` | 409 | the order is past the customer-cancel window |
| `RATE_LIMITED` | 429 | `Retry-After` header in seconds |
| `PAYLOAD_TOO_LARGE` | 413 | body above 32 KB |

## Routes

### `GET /branches`

Active branches that sell online. `items[]`: `code`, `name { vi, en }`, `address`, `phone`, `email`,
`timezone`, `receiveMethods: [{ kind: 'pickup' | 'delivery', orderTiming: 'asap' | 'scheduled' | 'both' }]`.

### `GET /config?branch=<code>`

`{ currency, consentPolicyVersion, captcha: { provider } | null, branch }`. `branch.pickup` (null when
pickup is off): `orderTiming`, `leadTimeMinutes`, `slotLengthMinutes`, `maxAdvanceDays`, `bookableFrom`,
`bookableTo` (local dates), `minOrderAmount`, `paymentTiming`, `paymentMethods`, `customerCancelBeforeMinutes`,
`openNow`, `asapReadyAt`. No `branch.delivery` block yet — the delivery checkout UI belongs to OW; quote
and create already accept `kind: 'delivery'` against the branch's delivery settings.

### `GET /slots?branch=<code>&date=YYYY-MM-DD`

`items[]`: `startsAt`, `endsAt`, `localStart` (`HH:mm` branch time), `available`, `reason`
(`too-early` | `full`). Pickup only for now — it always uses the branch pickup lead time; quote/create
re-check delivery slots against the delivery schedule themselves.

### `POST /quote`

```json
{
  "branch": "Q1",
  "locale": "vi",
  "lines": [{ "sellableUid": "<product id>", "quantity": 2, "selected": [{ "groupUid": "g", "optionUid": "o" }], "note": "ít hành" }],
  "receiveMethod": { "kind": "pickup", "slot": { "startsAt": "2026-10-12T05:00:00.000Z" } },
  "payment": { "providerCode": "cash" }
}
```

For delivery send `receiveMethod.kind: 'delivery'`, `providerCode: 'self-delivery'` and an `address`:
`{ "communeCode": "XT01002", "line1": "12 Đường Bí Mật", "recipientName": "…", "phone": "0901…" }`
(`wardCode` is accepted as an alias for older payloads). Commune codes come from the administrative-unit
catalog; an unknown code or a required field fails `VALIDATION_ERROR` with `details.field`
(`address.communeCode`, `address.line1`…). No `slot` means ASAP. Any amount, adjustment or fee in the
body is ignored — the delivery fee always comes from the matched zone, not the request. Response:
`cartHash`, `lines[] { index, sellableUid, title, quantity, unitAmount, optionAmount, lineTotalAmount }`,
`adjustments[]`, `totals { subtotal, adjustmentTotal, fulfillmentTotal, taxTotal, grandTotal, … }`
(the delivery fee is inside `fulfillmentTotal`), `payment.providerCode`,
`timing { mode, slot?, requestedReadyAt }`.

### `POST /orders` (`Idempotency-Key` header)

Quote body plus:

```json
{
  "contact": { "name": "Ngọc", "phone": "0901 234 567", "email": "optional@example.com" },
  "consent": { "policyVersion": "v1", "accepted": true, "marketingOptIn": false },
  "customerNote": "≤ 500 ký tự",
  "expectedCartHash": "<from the quote>",
  "captchaToken": "<Turnstile token>"
}
```

Phone: Vietnamese numbers only (`0…`, `+84…`, `84…`), stored as E.164. `201` (new) or `200` (replay):
`{ order: <token view>, token, replayed }`.

### `GET /orders` (`X-Order-Token`)

Token view: `code`, `status`, `paymentStatus`, `fulfillmentStatus`, `placedAt`, `businessDate`, `locale`,
`branch { code, name, phone, address }`, `receive { kind, mode, slot, estimatedReadyAt }` (`kind` is
`pickup` or `delivery`; the delivery address is never echoed to the browser — the customer reads it in
the confirmation email),
`contact { name }`, `customerNote`, `lines[] { title, quantity, canceledQuantity, options[] { name, quantity },
note, lineTotalAmount }`, `totals { currency, subtotal, adjustment, fulfillment, tax, total, paid, refunded, due }`,
`steps { current, history[] { status, at } }` (public steps only), `canCancel`.

### `GET /orders/payment` (`X-Order-Token`)

`{ payment: { code, paymentStatus, currency, total, due, paymentTiming, methods, presentation } }`.
`presentation` is `null` for cash, when nothing is due, when no group is `awaiting-payment`, or when
the payment window has already passed. SePay fills it while the window is open:

```json
{
  "qr": "https://qr.sepay.vn/img?...",
  "bankAccount": { "bankCode": "MBBank", "bankName": "MB Bank", "accountNumber": "…", "accountName": "…" },
  "memo": "SLCSLC-000124",
  "expiresAt": "2026-10-11T08:15:00.000Z"
}
```

`memo` is `SEPAY_MEMO_TEMPLATE` with `{orderCode}` replaced (default template `SLC{orderCode}`, so order
`SLC-000124` expects the transfer content to contain `SLCSLC-000124`). `qr` is a SePay image URL in
production. Tests embed an SVG data URL and never call SePay. The account number is the branch account
from `SEPAY_ACCOUNTS` (a branch-specific account wins over one with `locationRefs: "all"`).

A staff payment link is a second bearer. `POST /ordering/orders/:id/payment-link` (admin, `order.read`)
returns `{ url, expiresAt, replayed }`. The url is `notifications.orderLinkTemplate` with `#t=` replaced
by `#p=`. That token is accepted only by this GET. `GET /orders` and `POST /orders/cancel` still require
the order token and reject the payment token with 401 `ORDER_TOKEN_INVALID`. While the link is unexpired,
a second create returns the same url. A new link extends the order's payment deadline to at least
`expiresAt`. The order detail returns `paymentLink: { expiresAt } | null` and never the token.

### `POST /orders/cancel` (`X-Order-Token`)

Body `{ "reason"?: "≤ 200" }`. Allowed while every live step is customer-cancellable (waiting for the
branch, or waiting for payment) and, for a scheduled slot, until `customerCancelBeforeMinutes` before
it. Returns the token view.

### `POST /orders/lookup`

`{ code, phone, captchaToken }` → `{ order }` status-only view: `code`, `status`, `paymentStatus`,
`fulfillmentStatus`, `placedAt`, `branch { code, name }`, `receive`, `totals { currency, total }`, `steps`.
No name, phone, email, note or actions. Limits: per IP and 5 tries per order code per 15 minutes.

## Order steps (pickup, pay on pickup)

`placed` → `awaiting-acceptance` → `preparing` → `ready` → `delivered`; or `rejected` / `canceled`.
Prepay and accept-then-pay add `awaiting-payment`. A SePay transfer that matches the order moves that
step on: prepay to `awaiting-acceptance`, accept-then-pay to `preparing`.

## Order steps (delivery)

Delivery orders run their own workflows (`delivery-prepay`, `delivery-accept-then-pay`,
`delivery-pay-on-pickup`) with the same public steps up to `ready`. From `ready` staff dispatch the
courier: `ready` → `out-for-delivery` → `delivered`, or `out-for-delivery` → `failed` → back to `ready`
for another attempt. Cash orders stay `unpaid` until the courier collects at the door. `GET
/orders/payment` answers delivery orders with the branch's delivery `paymentTiming`/`methods`, so an
`awaiting-payment` delivery order still shows the SePay presentation. Customer emails use delivery
wording ("Giao lúc" not "Giờ lấy") for `out-for-delivery`, `delivered`, `failed` and a retry back to
`ready`.

## SePay webhook

### `POST /webhooks/sepay`

SePay calls this. It is not a storefront route: no order token, no `Idempotency-Key`, no captcha, and
it is not covered by the storefront rate limits. The signature is the authentication. Give SePay:

`https://<cms domain>/api/v1/ordering/webhooks/sepay`

Headers:

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-SePay-Timestamp` | Unix seconds |
| `X-SePay-Signature` | `sha256=` + hex HMAC-SHA256 of `{timestamp}.{raw body}` using `SEPAY_WEBHOOK_SECRET` |

The HMAC is over the exact request bytes, not a re-serialized JSON value. A timestamp more than 300
seconds off, or a signature that does not match, is **401** `{ "success": false }`. A body that is not
the payload below is **400** `{ "success": false }`. Anything else, after the raw event is stored, is
**200** `{ "success": true }` — including a duplicate `id`, an outbound transfer, and money that does
not match an order. SePay retries any other response.

```json
{
  "id": 96001,
  "gateway": "MBBank",
  "transactionDate": "2026-10-11 14:00:00",
  "accountNumber": "0123456789",
  "content": "SLCSLC-000124",
  "transferType": "in",
  "transferAmount": 195000,
  "referenceCode": "FT96001"
}
```

`id` is an integer (or a digit string) and is the idempotency key. The same `id` does not capture
twice. `transferType: "out"` is stored and ignored. `content` is what matching reads; SePay's own
`code` field is not. `transferAmount` is integer VND (a trailing `.00` is rounded). The account number
must belong to the order's branch.

Do not log the raw body, the sender name, or the full account number. The secret is env-only.

## Customer auth, profile and cart (O11)

All routes below live under `/api/v1/ordering` and share the storefront rules above (secret header
for server-side calls, captcha where noted, allowlist responses). Two bearer headers are new:

| Header | When |
| --- | --- |
| `X-Customer-Token` | required on `/me*` and `/auth/logout`; optional on `/carts*` and `POST /orders` (links the cart/order to the profile). Never in a URL. |
| `X-Cart-Token` | returned once by `POST /carts`; required on later `/carts*` calls for a guest cart. Logged-in calls may use `X-Customer-Token` instead. |

New error codes: `OTP_INVALID` 400 (`details.attemptsLeft` on a wrong code), `OTP_EXPIRED` 400,
`CUSTOMER_AUTH_REQUIRED` 401 (missing/expired `X-Customer-Token`), `CUSTOMER_NOT_FOUND` 404,
`CART_NOT_FOUND` 404, `CART_EXPIRED` 410 (checked-out/merged/expired cart or a different-key checkout
on a converted cart), `CART_LIMIT` 400 (over 50 lines or over the per-branch cart cap), `DATA_REQUEST_PENDING` 409.

### `POST /auth/otp`

`{ channel: 'email', target: '<email>', captchaToken }` → `{ challengeId, expiresAt }`. The response is
always the same whether the address exists or not — it never confirms an account. 6-digit code,
5-minute TTL (`customers.otp.codeMinutes`), 5 verify attempts, send limits 3 per target per 10 minutes
and 10 per client IP per hour. SMS/Zalo channels arrive with O13.

### `POST /auth/verify`

`{ challengeId, code }` → `{ token, customer: { id, name, email, status } }`. A wrong code is
`OTP_INVALID` with `attemptsLeft`; a burned challenge is `OTP_EXPIRED`. First-time targets create the
profile. `POST /auth/logout` with `X-Customer-Token` revokes the session (204).

### `GET /me` / `PUT /me`

Profile view: `id, name, email, phone, status, marketingConsent, orderCount, totalSpent, lastOrderAt,
createdAt`. `PUT /me { name?, marketingConsent? }` — email is accepted only unchanged; phone comes
from orders, not this route.

### `/me/addresses`

`GET` list → `items[] { id, label, recipientName, phone, line1, communeCode, communeName, provinceCode,
provinceName, note, isDefault }`. `POST /me/addresses` / `PUT /me/addresses/:id` (address fields,
`isDefault: true` demotes the others) / `DELETE /me/addresses/:id`. Max 10 per customer
(`VALIDATION_ERROR` over).

### `GET /me/orders` / `GET /me/orders/:code`

Own order history (`items[]` of the public order view) and one order by code — `CUSTOMER_NOT_FOUND`
for a foreign code, never 403. `POST /me/orders/:code/reorder` → a **new** cart holding the still-sellable
lines plus `issues[]` for what was dropped (`{ sellableUid, reason }`); delivery details carry over, timing does not.

### `GET /me/data-export` / `POST /me/erase`

Decree 13 self-service: export is the profile + addresses + orders JSON (staff refs stripped). Erase
needs `{ confirm: true }` → `202 { request }`; it revokes every session, anonymizes closed orders,
and parks in `waiting` while an order is open — the `data-request-waiting` job finishes it after close.

### `/carts*`

`POST /carts { locationRef, receiveMethod, contact?, marketingOptIn? }` → `{ cartToken, cart, quote,
issues }` (the guest token comes back once here). `GET /carts/current`, `PATCH /carts/current`
(`receiveMethod`/`contact`/`marketingOptIn`), `POST /carts/current/lines { sellableUid, quantity,
selected?, note? }`, `PATCH`/`DELETE /carts/current/lines/:lineId`, `POST /carts/current/checkout`
(`Idempotency-Key` required — the converted cart replays the same response on the same key). Every read
re-quotes: `quote.totals.grandTotal` is current money, `cartHash` tracks content, `issues[]`
(`SELLABLE_NOT_FOUND`, `PRICE_CHANGED`…) explains dropped/re-priced lines. Carts expire after
`carts.expiryDays` (default 7 days; rows are deleted `expiredDeleteDays` later) and cap at
`carts.maxLines` (50) lines (`CART_LIMIT` over). The `cart-reminder` job emails marketing opt-in
customers once a cart idles past `carts.reminderIdleHours` (default 2h), on branches with
`cartReminderEnabled`.
