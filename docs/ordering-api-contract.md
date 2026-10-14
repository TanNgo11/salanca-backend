# Ordering storefront API (O3), SePay webhook (O4), self-delivery (O5), ops extras (O7), promotions and ratings (O8), gift cards (O9), restaurant ops (O12)

O7 adds `specialHours` on `GET /config` (pickup, and delivery when that method is on), `dailyLimit` /
`sold-out-today` on the public catalog, and `ITEM_SOLD_OUT` from quote and create.

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
| `ITEM_SOLD_OUT` | 409 | the business day's portion limit is short. `details`: `entityType`, `entityDocumentId`, `locationRef`, `remaining`, `businessDate`, `sellableUid`, and when present `variantUid` / `modifierUid` |
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
`timezone`, `receiveMethods: [{ kind: 'pickup' | 'delivery' | 'dine-in', orderTiming: 'asap' | 'scheduled' | 'both' }]`.

### `GET /config?branch=<code>`

`{ currency, consentPolicyVersion, captcha: { provider } | null, branch }`. Without `?branch=`, `branch` is
null. With a branch that sells online: `code`, `timezone`, `pickup` (null when pickup is off), and
`delivery` when delivery is enabled. Both blocks share one shape: `orderTiming`, `leadTimeMinutes`,
`slotLengthMinutes`, `maxAdvanceDays`, `bookableFrom`, `bookableTo` (local dates), `minOrderAmount`,
`paymentTiming`, `paymentMethods`, `customerCancelBeforeMinutes`, `openNow`, `asapReadyAt`, `specialHours`.
`specialHours` is today through the next 13 local days (`date`, `closed`, `ranges: [{ start, end }]`,
optional `note`), sorted by date. A row replaces that date's regular hours and holidays. A range may cross
midnight (`22:00`–`02:00`). Quote and create already accept `kind: 'delivery'` against the branch's delivery
settings.

**Pause, busy and dine-in (O12).** `branch.pause` maps each receive kind (`pickup`, `delivery`, `dineIn`)
to `null` or `{ until, by?, reason? }` — a live pause makes quote and create of that kind fail with
`409 LOCATION_PAUSED` (`details.kind`, `details.resumeAt`). `branch.busy` is `null` or `{ extraMinutes,
until }` — it only pushes `leadTimeMinutes`/`asapReadyAt` out, ordering stays open. `branch.dineIn` is the
third receive block (same shape plus `sessionPayment: 'per-order' | 'at-close'`); it is `null` when dine-in
is off. `branch.fees[]` lists the configured service/packaging fees (`code`, `label`, `kind`, `amount` or
`percent`, `receiveKinds`, `minSubtotal`) — matching fees appear as `adjustments[]` of kind `fee` in the
quote and order totals, priced by the server.

### `GET /slots?branch=<code>&date=YYYY-MM-DD`

`items[]`: `startsAt`, `endsAt`, `localStart` (`HH:mm` branch time), `available`, `reason`
(`too-early` | `full`). Pickup only for now — it uses the branch pickup schedule, including a `specialHours`
row for that date (a closed special day has no bookable slots). Quote and create re-check delivery slots
against the delivery schedule themselves.

### `GET /catalog/products`

Public list (`?locale=&category=&location=&cursor=&limit=`) and `GET /catalog/products/:slug`. `branch` is
accepted as an alias of `location`. Optional `date=YYYY-MM-DD` is the business date the portion count uses;
omitted, the count is the branch's business date today. When that branch has a daily portion limit, the
product, variant, or option includes `dailyLimit: { remaining, date }`. `remaining: 0` sets the product's
`available` to false and `unavailableReason` to `sold-out-today` (a sold-out variant or option is
`available: false`). No branch in the query means no portion overlay. Pausing a product with the "Đang bán"
switch is separate and still uses `reasons` / `resumesAt`.

**Price context (O14).** Optional `receiveKind` is `pickup`, `delivery` or `dine-in` (`staff` and any other
value → `400 VALIDATION_ERROR`). Omitted means no channel, so only channel-free prices match. Optional `at`
(ISO) is the catalog clock; omitted, the server uses now. The branch timezone is the location's; with no
branch the clock is `Asia/Ho_Chi_Minh`. A request that resolves `X-Customer-Token` is priced with that
profile's active groups and answers `Cache-Control: private, no-store`. A missing or dead token stays
`Cache-Control: public, max-age=30` and pays the regular price — the phone is never used to guess a group.

**Allergens and dietary tags (O12).** Products carry `allergens[]` / `dietaryTags[]` (localized
`{ code, label }` rows resolved per `locale`) and `kitchenStation` (the resolved station label).
Optional `excludeAllergens=gluten,peanut` drops products carrying any listed allergen code;
`dietary=vegan,halal` keeps only products carrying every listed tag. Unknown codes are ignored.

`POST /quote` and `POST /orders` answer `409 ITEM_SOLD_OUT` when the requested quantity is above `remaining`
for the receive business date (ASAP uses the order's business date; a slot uses the business date of
`slot.startsAt`).

### `POST /quote`

```json
{
  "branch": "Q1",
  "locale": "vi",
  "lines": [{ "sellableUid": "<product id>", "variantUid": "<optional variant id>", "quantity": 2, "selected": [{ "groupUid": "g", "optionUid": "o" }], "note": "ít hành" }],
  "receiveMethod": { "kind": "pickup", "slot": { "startsAt": "2026-10-12T05:00:00.000Z" } },
  "payment": { "providerCode": "cash" }
}
```

`variantUid` picks a non-default variant of the item (size, card denomination…); the server prices that variant and
the order line snapshots its `sku`, `variantUid` and title (`Món · Biến thể`). Omit it for the default variant.
A `variantUid` that is not a variant of `sellableUid` fails `400 VALIDATION_ERROR` (`details.field` =
`lines.N.variantUid`); a tạm hết variant fails `SELLABLE_UNAVAILABLE` (`details.lineIndex`, `reason: variant-unavailable`) —
the server never falls back to the default price.

For delivery send `receiveMethod.kind: 'delivery'`, `providerCode: 'self-delivery'` and an `address`:
`{ "communeCode": "XT01002", "line1": "12 Đường Bí Mật", "recipientName": "…", "phone": "0901…" }`
(`wardCode` is accepted as an alias for older payloads). Commune codes come from the administrative-unit
catalog; an unknown code or a required field fails `VALIDATION_ERROR` with `details.field`
(`address.communeCode`, `address.line1`…). For dine-in (O12) send `receiveMethod.kind: 'dine-in'`,
`locationRef` and `tableToken` — the QR secret as resolved by `POST /tables/resolve`; a bad or foreign-branch token
fails `404 TABLE_NOT_FOUND`. No `slot` means ASAP. Any amount, adjustment or fee in the
body is ignored — the delivery fee always comes from the matched zone, not the request. Response:
`cartHash`, `lines[] { index, sellableUid, title, quantity, unitAmount, optionAmount, lineTotalAmount }`,
`adjustments[]`, `totals { subtotal, adjustmentTotal, fulfillmentTotal, taxTotal, grandTotal, … }`
(the delivery fee is inside `fulfillmentTotal`), `payment.providerCode`,
`timing { mode, slot?, requestedReadyAt }`.

**Promotions (O8).** Send `promotionCode` (case-insensitive, 4–32 of `A-Z 0-9 -`); the server decides
every discount. The quote adds `promotions[] { code, label, amount, target }` (applied, `amount` ≤ 0),
`rejectedPromotions[] { code, reason }` and `pendingPromotions[] { code, label, condition }`, and
`totals.discountTotal`. Automatic promotions apply without a code. Reasons: `invalid`, `not-started`,
`ended`, `code-used`, `usage-limit`, `min-subtotal`, `location`, `receive-kind`, `time`, `products`,
`fulfillment`, `not-best` (a better offer was chosen). **The quote never reads the phone**: first-order
and per-customer promotions appear in `pendingPromotions` at full price and are decided at create, so
the created order's total can only be lower than the quote (show "Ưu đãi đơn đầu — kiểm khi đặt").
A signed-in quote (`X-Customer-Token`) uses the same customer groups as create, so the merchandise price
matches. Promotions run after the price list: a 10% code on a happy-hour item discounts 10% of the
happy-hour price. The price clock is `placedAt` when the caller sends it, otherwise now — not the pickup slot.
Wrong codes are counted per IP: after 3 a quote with a code needs `captchaToken`
(`CAPTCHA_FAILED` otherwise), after `rateLimits.promotionCode.max` (20 / 10 min) → `429 RATE_LIMITED`.
Eligibility misses on a real code are not counted.

### `POST /tables/resolve` — O12

Public resolve for a scanned table QR. Body `{ "token": "<secret>" }` — the QR secret from the printed link
(`…/ban?t=<token>`, a web page URL; the web page reads it and calls this route). The secret is never in
the API path or query (access logs record the URL): a `token`/`t`/`orderToken`/… query key answers
`400 VALIDATION_ERROR`, and the old `GET /tables/:token` no longer exists. The server only stores its sha256. `200` answers `{ item: { branch, branchName,
table: { code, name, area, seats }, menuUrl, status } }` where `status` is `open` when the table already
has a live session, else `available`. Unknown, rotated, disabled and cross-branch secrets all answer the
same `404 TABLE_NOT_FOUND` — probing learns nothing. `Cache-Control: no-store`.

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

`consent.policyVersion` must equal `consentPolicyVersion` from `GET /config`: the version in force is the Admin
setting (Settings → Bán hàng, key `consentPolicyVersion` in `ordering-settings`) or, when unset, the plugin config
`consent.policyVersion`. After an admin changes it, an order sent with the old version fails
`CONSENT_REQUIRED` (`details.expected`) until the client re-reads `/config` and the customer accepts again.
Staff drafts (`POST /drafts`) take only `consent.accepted`; the server stamps the version in force.

Phone: Vietnamese numbers only (`0…`, `+84…`, `84…`), stored as E.164. `201` (new) or `200` (replay):
`{ order: <token view>, token, replayed }`.

With `promotionCode`, a code that does not apply fails the create (nothing is created):
`400 PROMOTION_INVALID` (unknown, switched off, bad format), `400 PROMOTION_EXPIRED`
(`details.reason` `not-started`|`ended`), `400 PROMOTION_NOT_ELIGIBLE` (`details.reason` as above;
`min-subtotal` adds `details.minSubtotal`, `missing`), `409 PROMOTION_EXHAUSTED` (`usage-limit`|`code-used`).
An automatic promotion that ran out between quote and create is dropped silently and the order is
priced without it. `expectedCartHash` is compared with the quote's phone-free pricing.

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

### `GET /orders/rating` (`X-Order-Token`) — O8

`{ rateable, reason?, tags[] { code, label, sentiment }, rating | null }`. `reason`: `not-completed`
(the order is not completed yet) or `window-closed` (more than `ratingWindowDays`, default 7, since it
completed). `rating { stars, tags, comment, ratedAt, editableUntil, editable }`. Show positive tags for
≥ 4 stars and negative ones for ≤ 3. The invite email links to the order page with `&rate=1` after the
`#t=` token (or `#rate`).

### `POST /orders/rating` (`X-Order-Token`) — O8

`{ stars: 1–5, tags?: string[] (configured codes, ≤ 10), comment?: ≤ 1000 }` → `{ rating }`. The first
submit creates it; later submits edit it until `editableUntil` (`ratingEditHours`, default 24), then
`409 RATING_LOCKED`. Not completed or past the window → `409 RATING_NOT_AVAILABLE` with
`details.reason`. Rate-limited per IP (`rateLimits.rating`).

### `POST /orders/lookup`

`{ code, phone, captchaToken }` → `{ order }` status-only view: `code`, `status`, `paymentStatus`,
`fulfillmentStatus`, `placedAt`, `branch { code, name }`, `receive`, `totals { currency, total }`, `steps`.
No name, phone, email, note or actions. Limits: per IP and 5 tries per order code per 15 minutes.

## Gift cards (O9)

**Buying a card.** A `catalog-product` with `productType: 'gift-card'` is sold through
`receiveMethod.kind: 'digital'` on quote/create:

```json
{
  "receiveMethod": { "kind": "digital", "recipientEmail": "giftee@example.com", "recipientName": "Lan", "message": "…" },
  "payment": { "providerCode": "sepay" }
}
```

`recipientEmail` is required at create (not at quote); `contact.email` defaults to it when empty.
Card orders run the `gift-card` workflow (`awaiting-payment` → `issued`) and require an online
provider — cards are minted only after the payment captures; the recipient email gets the code(s),
the purchaser gets a codeless confirmation. Staff counter sales pass `physicalCodes` (scanned
preprinted stock) — those activate instead of minting. Every scan is checked at create: one card per
unit, no card twice, face value equal to the unit sold, and not held by another live order
(`400 VALIDATION_ERROR` / `400 GIFT_CARD_INVALID`). The order stores the resolved card ids
(`receiveMethod.physicalCardIds`), never the codes. A promotion applies to a card cart only when it
declares `digital` and targets the card products or category — order-wide promotions and staff manual
discounts never do; a card cannot pay for a card (`400 GIFT_CARD_NOT_ALLOWED`).

**Refunds on a card sale.** Issued card value is never refunded to cash: on a card-sale order with
issued cards a refund may only take money above the cards' face value (an overpaid transfer);
anything more answers `400 GIFT_CARD_NOT_ALLOWED` with `details.reason: 'card-sale-refund'` and
`details.refundable`. Before the cards are issued a cancel refunds in full.

**Paying with a card.** `payment.giftCardCode` (on `/quote`, `/orders` and cart checkout) applies the
card first, the provider settles the remainder. Quote answers `giftCard { applied, balanceAfter,
dueAfterGiftCard }` — or `{ reason: 'invalid' | 'insufficient' | 'not-allowed' }`. Invalid, blocked
and expired codes collapse to the same `invalid` answer — no existence oracle. A wrong code at
create fails `400 GIFT_CARD_INVALID`; `POST /orders` and cart checkout share the per-IP wrong-code
budget below and answer `429 RATE_LIMITED` once it is spent. An invalid quote result carries
`last4: null` whether or not the card exists. The token order view gains
`giftCards[] { last4, applied, remaining }`; refunds and cancels return the value to the card.

### `POST /gift-cards/balance`

`{ code, captchaToken? }` → `{ card: { last4, status, balance, currency, expiresAt } }` — no code,
no holder data. Unknown, malformed, inactive and blocked codes all answer `400 GIFT_CARD_INVALID`.
Wrong codes are counted per IP like promotion codes: captcha after 3 misses
(`CAPTCHA_FAILED`), `429 RATE_LIMITED` at `rateLimits.giftCard.max` (20 / 10 min), and attempts
while limited still count toward the `gift-card-probing` ops alert (20 opens, 60 escalates).

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

## Order steps (dine-in, O12)

Dine-in orders run `dine-in-pay-later` / `dine-in-prepay` / `dine-in-accept-then-pay` by the branch's
`dineIn.paymentTiming` when `dineIn.sessionPayment` is `per-order`. With `at-close` (the default) every
dine-in order runs `dine-in-pay-later` whatever `paymentTiming` says, and `payment.providerCode` may be
omitted — the table pays once, at session close. The tail differs from pickup: `ready` → `served` (dishes at the table) →
`completed`, where `completed` is stamped when staff close the table session, not by the guest.
The first order on a table opens its **table session**; further scans on the same QR join it, so one
table can carry several orders at once. A session closes only from the admin "Thanh toán & đóng bàn"
action, which collects each order's outstanding balance (cash capture or a witnessed counter transfer)
and moves every `served` group to `completed`; an order still in the kitchen blocks the close.
Sessions still open when the branch's business day rolls over raise a `table-session-open` ops alert —
nothing is collected or closed automatically. The stored order carries `tableId`/`tableCode` in
`receiveMethod`, never the QR secret; rotating a table's QR or disabling the table stops new orders at
once but does not disturb the open session.

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

Checkout locks and reloads the cart: concurrent different-key requests produce at most one order;
the cart conversion and order creation commit together. A converted cart only replays a key tied
to its linked order. Promotion-code guessing guards apply to create, read, patch, line mutations and reorder,
including a code stored before any lines were added. Send `captchaToken` in the request body when
required; GET and DELETE cart routes accept this transient captcha proof in their query.

`POST /carts { locationRef, receiveMethod, contact?, marketingOptIn? }` → `{ cartToken, cart, quote,
issues }` (the guest token comes back once here). `GET /carts/current`, `PATCH /carts/current`
(`receiveMethod`/`contact`/`marketingOptIn`/`promotionCode` — `null` clears it; a new code counts toward the
per-IP wrong-code guard of `POST /quote`, so send `captchaToken` once it asks), `POST /carts/current/lines { sellableUid, quantity,
selected?, note? }`, `PATCH`/`DELETE /carts/current/lines/:lineId`, `POST /carts/current/checkout`
(`Idempotency-Key` required — the converted cart replays the same response on the same key). Every read
re-quotes: `quote.totals.grandTotal` is current money, `cartHash` tracks content, `issues[]`
(`SELLABLE_NOT_FOUND`, `PRICE_CHANGED`…) explains dropped/re-priced lines. Carts expire after
`carts.expiryDays` (default 7 days; rows are deleted `expiredDeleteDays` later) and cap at
`carts.maxLines` (50) lines (`CART_LIMIT` over). The `cart-reminder` job emails marketing opt-in
customers once a cart idles past `carts.reminderIdleHours` (default 2h), on branches with
`cartReminderEnabled`.

### O11 review corrections (2026-10-13)

- OTP verification serializes on the challenge row in PostgreSQL: concurrent successful
  submissions issue one session; concurrent wrong codes consume the configured attempt limit.
- A first guest order creates an unverified customer by normalized phone when no profile exists.
  Concurrent orders share that profile; checkout never verifies an identity or resurrects an
  erased profile. An existing authenticated customer still takes precedence.
- Staff data requests use the same customer scope for phone and customerId creation, list/count,
  process and reject. Out-of-scope identifiers return 404. A staff member without a location
  scope cannot list or mutate the queue. Requests without a currently visible customer, including
  erased customers whose orders were detached, remain accessible to all-location managers only.
- With O8 installed, erasure clears each affected order rating's `comment`, `staffNote` and
  `staffNoteBy`; stars/tags remain. `promotion-redemption.customerKey` and accounting fields
  remain unchanged to preserve per-customer use limits. See the O11 Completion record for the
  retention decision. Cart quotes also omit phone history; carts carry `promotionCode` (decided at
  checkout like `POST /orders`). OTP-aware quotes remain deferred.
