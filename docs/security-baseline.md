# Security Baseline

## Dependency audit at bootstrap

Date: 2026-07-18

Rechecked on 2026-07-19 against `https://registry.npmjs.org`; counts are unchanged.
The machine's configured AWS CodeArtifact registry does not expose npm's audit endpoint,
so audit runs must pass the public registry explicitly until that registry policy changes.

The official Strapi 5.50.2 scaffold reported:

- 0 critical vulnerabilities.
- 1 high vulnerability.
- 12 moderate vulnerabilities.
- 7 low vulnerabilities.

The high advisory is reported against transitive Vite development/build tooling. npm's automatic `fixAvailable` recommendation points to Strapi 4.26.2, which is a major downgrade and is not an acceptable fix for this new Strapi 5 project.

No `npm audit fix --force` was run. Forcing dependency rewrites would trade a visible transitive advisory for an unreviewed framework downgrade or broken dependency graph.

## Required follow-up

- Re-run `npm audit` before the first staging deployment.
- Check whether a newer stable Strapi patch resolves the Vite advisory.
- Upgrade Strapi only through a dedicated reviewed change using the official upgrade tool.
- Keep the Admin/build surface private to trusted operators until the dependency is resolved or explicitly risk-accepted.
- Do not expose the development server publicly.

## Existing controls

- PostgreSQL is required; SQLite fallback is rejected.
- Secrets are stored in ignored environment files.
- Public API permissions remain deny-by-default.
- Production CORS and media storage remain blocked decisions before staging.

## Ordering public catalog API (O2)

The `ordering` plugin exposes three public read-only routes (`auth:false`) for storefront
consumption: `GET /api/v1/ordering/catalog/categories`, `/catalog/products`,
`/catalog/products/:slug`.

- Read-only: only GET routes; serializer returns whitelisted fields (names, slugs,
  prices, availability) — internal ids, ranks, `isInternal` categories and inactive /
  non-`sellOnline` products are filtered out before serialization.
- Rate limit: in-process per client IP; 429 beyond the configured window. The client IP comes
  from `resolveClientIp` (plugin `clientIp` config): the visitor IP forwarded by salanca-web in
  `x-salanca-visitor-ip` is trusted only when `x-salanca-intake-secret` matches
  `FORM_INTAKE_SHARED_SECRET` (constant-time compare, junk IPs ignored); otherwise the socket IP
  (`X-Forwarded-For` only with `TRUST_PROXY=true`). Same model as form intake. **Open for OW:**
  salanca-web must send both headers on its server-side calls to `/api/v1/ordering/*`, or all
  visitors share the web server's bucket.
- Response size: short `Cache-Control: public, max-age=30` when the request has no live customer
  session. A resolved `X-Customer-Token` prices that profile's groups and answers
  `Cache-Control: private, no-store`, so a group price is never stored in a shared cache. A missing or
  dead token stays on the public price. The catalog does not infer a group from a phone number.
  Product list is paginated — no unbounded dump endpoint.
- Admin routes (`/ordering/categories*`, `/ordering/availability*`) require
  `admin::isAuthenticatedAdmin` plus `plugin::ordering.catalog.manage` /
  `catalog.toggle-availability`, and staff scope is enforced per `locationRef` —
  unauthenticated requests return 401 before the handler runs.

## Ordering storefront API (O3)

Public routes (`auth:false`, under `/api/v1/ordering`): `GET /branches`, `GET /config`, `GET /slots`,
`POST /quote`, `POST /orders`, `GET /orders`, `GET /orders/payment`, `POST /orders/cancel`,
`POST /orders/lookup`.

- Rate limits: in-process fixed windows per trusted client IP (`storefront.rateLimits`: read 120/min,
  quote 60/min, create and cancel 10 per 10 min). Single instance only (contracts §21.9).
- Body: JSON only, capped at 32 KB (413 above); only allowlisted fields are read — client amounts,
  adjustments, fees, statuses and origins are ignored, the server prices every cart.
- `POST /orders`: `Idempotency-Key` header required; captcha through the configured `CaptchaProvider`
  (Turnstile when `TURNSTILE_SECRET_KEY` is set; fails closed); consent `{ policyVersion, accepted: true }`
  required (`CONSENT_REQUIRED`); phone normalized to E.164 (Vietnamese numbers only).
- Order token: 32 random bytes, sent once in the create response (and again on an idempotent replay);
  stored as SHA-256 on the order and AES-256-GCM sealed on the idempotency row
  (`ORDERING_ENCRYPTION_KEY`, rows expire after `idempotency.ttlHours`). Accepted **only** in the
  `X-Order-Token` header — a token in the query string is refused (`ORDER_TOKEN_INVALID`) so it never reaches
  access logs. Customer links put it in the URL fragment (`#t=`).
- Responses use allowlist serializers: the token view has the customer's name but not phone/email; the
  lookup view has no personal data. `Cache-Control: no-store` on order routes.
- `POST /orders/lookup` (code + phone, contracts §21.2): captcha required; rate limited per IP (20 / 15 min)
  **and** per order code (5 / 15 min, the 6th try is 429); phones compared as E.164 hashes with
  `timingSafeEqual`; an unknown code, a draft and a wrong phone return the same `ORDER_LOOKUP_FAILED` after the
  same work. The status-only view opens no action (no cancel, no payment QR).

## Ordering SePay webhook and payment link (O4)

Public `POST /api/v1/ordering/webhooks/sepay` is `auth: false`. It is not a users-permissions route and
it is not covered by the storefront rate limits. Authentication is HMAC-SHA256 of
`{X-SePay-Timestamp}.{raw body}` in `X-SePay-Signature: sha256=<hex>`, skew at most 300 seconds. A bad
signature is 401 `{ "success": false }`. A payload that does not match the contract is 400
`{ "success": false }`. After the raw event is stored, every other case is 200 `{ "success": true }`.

`SEPAY_WEBHOOK_SECRET` and `SEPAY_API_TOKEN` come only from the environment. They are not shown in
Admin and are not written to logs. Logs do not include the sender name, the full account number, or
the raw transfer content.

The global JSON body limit is 256 KB, and `strapi::body` keeps the raw body (`includeUnparsed: true`)
when `ORDERING_ENABLED=true`. Storefront routes are separately capped at 32 KB. The webhook is not
under that 32 KB cap.

Cloudflare must not cache or challenge `/api/v1/ordering/webhooks/sepay`. Reconciliation calls
`GET https://userapi.sepay.vn/v2/transactions` with the bearer token and refuses redirects.

A staff payment link is a second bearer (fragment `#p=`). It is accepted only by `GET /orders/payment`.
It does not open the order view or cancel. The plaintext is sealed with `ORDERING_ENCRYPTION_KEY`; the
store keeps the SHA-256. Creating a new link can extend the payment window. The customer's original
order token is unchanged.

## Ordering ops và dữ liệu cá nhân (O6)

Job `retention` (mặc định 03:30 hằng ngày, `plugin::ordering.retention`) giới hạn thời hạn lưu: sau
`paymentPayloadDays` (mặc định 180 ngày) `payment-event.raw_payload` bị thu gọn còn allowlist
`RETAINED_PAYLOAD_KEYS` — giữ id, số tiền và `referenceCode` để đối soát, bỏ `content`,
`accountNumber`, `description`, `sender*` — kèm dấu `redactedAt`; outbox `delivered`/`failed` và alert
`resolved` bị xóa sau 30/90/90 ngày. Các mặc định chờ pháp lý xác nhận.

`GET /ordering/orders/export` xuất CSV có tên, số điện thoại, email, địa chỉ khách — chỉ cấp cho
quyền `export`, giới hạn 92 ngày và 10.000 đơn mỗi lần. Admin cảnh báo rõ trước khi tải. Ba quyền
mới cần kiểm khi phân vai trò: `export` (PII hàng loạt), `ops.read` (trang vận hành + "Chạy ngay"
job + retry outbox) và `report.read` (báo cáo + chốt tiền + email cảnh báo tài chính).

Log chỉ ghi số đếm (số dòng export, số bản ghi đã redact/xóa); trang vận hành và Admin không hiển thị
raw payload webhook hay PII khách ngoài luồng đơn.

Hạ tầng trước route webhook: Cloudflare phải bypass cache và skip challenge cho
`POST /api/v1/ordering/webhooks/sepay` (prefix theo `API_REST_PREFIX`), không bật Bot Fight
Mode trên path đó — chi tiết checklist trong [`ordering-ops-runbook.md`](ordering-ops-runbook.md).

## Ordering outbound integrations (O10)

Webhook endpoints are operator-registered outbound HTTP targets — the plugin's first
*data-leaving-the-system* surface besides SePay callbacks.

- **SSRF.** Endpoint URLs must be `https:` (`http:` only under the dev flag
  `plugin::ordering.webhooks.allowHttp`). `domain/url-guard` resolves DNS at send time and rejects
  loopback/private/link-local/CGNAT/multicast IPv4+IPv6 answers — including hostnames that resolve to
  an internal address; the request is pinned to the checked IP (DNS-rebinding safe). Redirects are
  never followed. Dev exemptions live in `plugin::ordering.webhooks.allowHosts`.
- **Signatures.** `X-Ordering-Signature: t=<unix>,v1=<hex>` where `v1` is hex HMAC-SHA256 of
  `"{t}.{raw body}"` with the per-endpoint secret. Secrets are generated as `whsec_…`, shown exactly
  once at create/rotate, stored encrypted with `ORDERING_ENCRYPTION_KEY`, and never returned by
  list/get. Rotation overlaps old+new signatures for 24 hours. Receivers should reject skew > 5 min.
- **PII minimization.** Default payloads carry ids, order code, branch ref, status and amounts only.
  `includeCustomer` (name/phone/email/address) is a separate flag gated behind `webhook.manage`,
  requires an in-UI confirmation, and is recorded in the admin change log.
- **Abuse controls.** 10 s timeout per attempt; retry schedule 1m/5m/15m/30m then 1h/2h/4h/8h/12h/24h
  (10 attempts); 50 consecutive failures auto-disable the endpoint and open a
  `webhook-endpoint-disabled` alert. Delivery logs keep status/attempts/next-attempt/trimmed error —
  never the receiver's response body. URL query strings are stripped from logs and listings.
- **CSV.** Import accepts `text/csv`/octet-stream bodies ≤ 2 MB and ≤ 5000 rows; validate-then-apply
  inside one transaction, guarded by a catalog version hash (`CATALOG_IMPORT_STALE`). Export cells
  starting with `= + - @` are neutralized (formula-injection guard). Import needs `catalog.manage`;
  export additionally needs `export`.
- **Email templates.** Admin-editable copies render through a restricted markdown (paragraphs, bold,
  `- ` lists, `https:`-only links — `javascript:`/other schemes are stripped to label text). Variables
  are allowlisted per template (`TEMPLATE_VARIABLE_UNKNOWN` on save/preview); all interpolated values
  are HTML-escaped. A broken custom template falls back to the built-in copy and opens a
  `notification-template-broken` alert — the email still goes out.
- **OpenAPI.** `GET /api/v1/ordering/openapi.json` is public `auth: false` and read-only (document,
  not data); cached 1 hour.

## Ordering customers, carts và quyền dữ liệu cá nhân (O11)

Ba quyền mới: `customer.read` (danh bạ + chi tiết che), `customer.manage` (sửa tên/ghi chú, hiện số,
xuất JSON) và `customer.erase` (hàng đợi yêu cầu dữ liệu). `customer.erase` và `export` là hai quyền
nhạy nhất — chỉ cấp cho vai trò quản lý/kế toán.

- **OTP đăng nhập** (`/auth/otp`, `/auth/verify`): mã 6 số, TTL 5 phút (`customers.otp.codeMinutes`),
  tối đa 5 lần thử (`maxAttempts`), giới hạn gửi 3 mã/mục tiêu/10 phút và 10 mã/IP/giờ. Câu trả lời
  giống nhau dù địa chỉ có tồn tại hay không — route không bao giờ xác nhận tài khoản tồn tại. Mã OTP
  lưu dạng băm; đích gửi (email/SĐT) lưu **sealed** AES-256-GCM (`ORDERING_ENCRYPTION_KEY`), không lưu
  thô. Captcha bắt buộc như các route storefront khác.
  Xác minh khóa dòng OTP trong transaction PostgreSQL: mã chỉ dùng một lần, các lần thử sai
  đồng thời vẫn được cộng đủ và commit; tạo phiên thành công cùng transaction.
- **Phiên khách** (`X-Customer-Token`): token ngẫu nhiên, lưu SHA-256; mặc định 30 ngày
  (`customers.sessionDays`), tối đa 10 phiên/khách (`maxSessions` — phiên cũ nhất bị thu hồi khi vượt).
  `/me/erase` thu hồi toàn bộ phiên ngay lập tức.
- **SĐT theo HMAC**: hồ sơ lưu SĐT E.164 + `phoneHash` (HMAC-SHA256, khóa từ `ORDERING_ENCRYPTION_KEY`).
  Tìm kiếm SĐT trong admin và khớp đơn khách vãng lai đều đi qua hash — không quét số thô; request
  xóa do nhân viên tạo cũng chỉ lưu hash, số thô không bao giờ chạm DB.
- **Danh bạ nhân viên che**: list/detail trả `phoneMasked`/`emailMasked` (kể cả SĐT trong sổ địa chỉ).
  Cách duy nhất xem số đầy đủ là `POST /customers/:id/reveal-phone` — trả số một lần và ghi
  `customer.reveal-phone` vào change-log append-only. Sửa hồ sơ ghi `customer.update` với trước/sau
  đã mask. Nhân viên theo chi nhánh chỉ thấy khách có đơn tại chi nhánh đó — ngoài phạm vi trả 404,
  không xác nhận tồn tại (áp dụng cả cho `POST /data-requests` bằng `customerId` hoặc SĐT).
  Danh sách, tổng số, xử lý và từ chối yêu cầu dữ liệu đều lọc cùng scope. Yêu cầu không còn
  khách có đơn trong scope (kể cả sau ẩn danh) chỉ quản lý `allLocations` xem/xử lý được.
- **Xuất/xóa (Nghị định 13)**: `/me/data-export` chỉ dữ liệu của chính phiên đó, ref nhân viên bị gỡ.
  Xóa: ẩn danh tên/SĐT/email/địa chỉ/ghi chú trên **đơn đã đóng** (giữ tiền, mã bưu chính, báo cáo O6
  không đổi), xóa hồ sơ/địa chỉ/giỏ/phiên/OTP; đơn đang mở → request `waiting`, job
  `data-request-waiting` xử lý khi đơn đóng; idempotent; webhook `customer.erased` chỉ mang
  `customerHash`, không PII.
  Khi có O8, xóa cả comment và ghi chú nội bộ của đánh giá, giữ số sao/nhãn cho báo cáo.
  `promotion-redemption.customerKey` được giữ dưới dạng HMAC có khóa để bảo toàn giới hạn lượt
  theo khách và dữ liệu đối chiếu khuyến mãi; đây là định danh giả, không phải dữ liệu đã mất mọi
  khả năng liên kết. Lý do và regression được ghi trong Completion record O11.
  Xóa hồ sơ cũng xóa mọi dòng `customer-group-member` của khách đó. Job `customer-group-refresh` không
  thêm lại khách đã xóa.
- **Giỏ server** (`X-Cart-Token`): token khách vãng lai ngẫu nhiên, lưu SHA-256 — sở hữu giỏ giống
  order token, không lộ trong URL/log. Giá luôn re-quote phía server; `cartHash` chỉ theo dõi nội dung.
- `X-Customer-Token` và `X-Cart-Token` nằm trong CORS allowlist của `/api/v1/ordering` — không route
  nào chấp nhận token qua query string.

## Ordering promotions and ratings (O8)

- **Code guessing.** Codes are 4–32 characters; generated ones use `crypto.randomInt` over an alphabet
  without 0/O/1/I/L. Per IP, after 3 wrong codes (unknown, switched off, not started, ended, used up) a
  quote with a code needs a captcha, and the `rateLimits.promotionCode` limit (20 / 10 min) answers 429.
  Eligibility misses on a real code are not counted. Create always needs a captcha. Codes are logged by
  their last 4 characters only (change log, app logs).
- **No phone-history oracle.** The public quote takes no phone: first-order and per-customer promotions
  are listed as pending and decided at create, which is captcha-gated and rate-limited, so a stranger
  cannot ask the quote whether a number has ordered before. A redemption stores
  `HMAC-SHA256(ORDERING_ENCRYPTION_KEY, phone E.164)`, never the number.
- **Use limits.** Reservation locks the promotion then the code rows in id order (`FOR UPDATE`) inside the
  order transaction; `usedCount` has a `CHECK (≥ 0)`; first-order-only is one use per phone under the
  same lock. `promotion-race.mjs` proves one use goes to exactly one of two processes.
- **Ratings.** Rated through the order token only; comments (customer text) never reach logs, alerts,
  webhooks or the change log (staff notes are logged as "changed", not their text) and are cleared after
  `retention.ratingCommentDays` (365); the stars stay for reports.

## Form intake rate limiting

Contact and reservation intake are rate limited in-process per client IP (default 5 per 10 minutes).
The web app posts server-to-server, so Strapi only sees the web server's IP unless both sides share
`FORM_INTAKE_SHARED_SECRET`: salanca-web then forwards the visitor IP in `x-salanca-visitor-ip`, trusted
only when `x-salanca-intake-secret` matches (constant-time compare; a wrong secret falls back to the socket
IP and never errors). Set `TRUST_PROXY=true` when Strapi sits behind a reverse proxy. Production boot logs a
warning when the secret is missing (limit degrades to one site-wide bucket).

## Audit (2026-10-04)

Run with the public registry: `pnpm audit --prod --registry=https://registry.npmjs.org`.

- salanca-web: Next 16.3.6 clears the three Next RCE advisories; `sharp` 0.35.4, `postcss`,
  `browserslist` and `baseline-browser-mapping` are pinned via `pnpm-workspace.yaml` overrides. Prod audit is clean.
- salanca-backend: direct `sharp` (media-processing pipeline) is 0.35.4.
- Remaining highs (axios, undici, vite, nodemailer, brace-expansion, fast-uri, ...) are transitive through
  `@strapi/*` (including `@strapi/upload`'s own `sharp`). Waiting on a dedicated Strapi upgrade; do not
  override them individually.
