# Ordering / sales — E2E case checklist

Feature inventory comes from `src/plugins/ordering/server` (178 admin operations in
`docs/ordering-admin-openapi.json` plus the public routes in `docs/ordering-api-contract.md`), the 33
admin pages in `admin/src/pages`, the `docs/ordering-*.md` guides, and the 99 `scripts/ordering/*.mjs`
integration scripts, which serve as the feature list.

Status: ✅ covered · 🟡 partial (some cases only, API-only, or tolerant assertion) · ❌ not covered · ⛔ known gap (reason given) · 🐞 bug regression (guards a bug found by the first E2E run; it fails while the bug exists)

Bug state on branch `feat/ordering-notify-release` (2026-10-16): BUG-01…08, 10, 12, 13, 14, 15 and the erase confirmation are fixed and committed (BUG-03/04 together with the R1a notification work they patch), so their regressions should now pass (not yet re-run against a live server). **BUG-09** is `fixme`: the fix plan closed it as an open product decision (browser time vs store time). **BUG-11** was never reproduced and only runs with `E2E_ADMIN_DEV=1` on a `strapi develop` server. See `docs/plans/ordering-e2e-fixes-2026-10-16.md`.

Spec files are in `e2e/specs/`; the `01-`…`99-` prefixes are shortened below.

## 1. Storefront (public API `/api/v1/ordering`)

| Feature (source) | Cases | Spec | Status |
|---|---|---|---|
| Branches / config (storefront.mjs) | branches list; config currency/timezone/fees/consent version; unknown branch → error | 10, 08 | ✅ |
| Catalog / categories / product detail (catalog-api, catalog-json, catalog-slug) | products carry variants/allergens/availability; detail by slug; unknown slug 404; `locale=en` | 10 | ✅ |
| Allergens / dietary tags (allergens.mjs) | fields present on every product | 10 | 🟡 Only checks the fields are present. Allergen content is not asserted (the seed has none). |
| Variants (variant-order.mjs) | different variant → different price | 10 | 🟡 Skipped if the seed has no product whose variants differ in price |
| Pickup slots (pickup-slots.mjs) | today's slots; past date; beyond maxAdvanceDays refused | 10 | ✅ |
| Special hours (special-hours.mjs) | — | — | ❌ Needs a branch special-hours fixture. Config exposes `specialHours: []` only. |
| Quote validation | empty lines, unknown sellable, qty 0 / −1, unknown branch, invalid promo code | 10 | ✅ |
| Fees (fees.mjs) | dine-in quote includes the 5% service fee | 10 | ✅ |
| Create order (create-order.mjs) | happy path (helper used everywhere); missing Idempotency-Key; consent missing or wrong version; stale cart hash; invalid phone | 10, 01 | ✅ |
| Idempotency & race (idempotency.mjs) | same key replays the same order; 4 parallel same-key POSTs → 1 order; same key with a different body → 4xx | 10, 08 | ✅ |
| Order token view / payment view | token view, payment view, forged token rejected | 10, 01 | ✅ |
| Lookup (lookup-drafts.mjs) | code+phone → status only, no PII; wrong phone → ORDER_LOOKUP_FAILED | 10 | ✅ |
| Customer cancel | cancel; cancel twice refused; cancel after the shop accepted refused | 10, 01 | ✅ |
| Rating (rating.mjs) | rate after completion; rating before completion refused; stars out of range; GET rating | 10, 01 | ✅ |
| Guest cart (cart.mjs) | create; add / patch / delete line; foreign line 404; contact patch; re-quote; no token → 404 | 10 | ✅ |
| Cart checkout (cart-checkout.mjs, review-cart-merge.mjs) | checkout without key → 400; checkout; replay same key; other key → 410; dead cart → 410 | 10 | ✅ Covered for guest carts. ⛔ Logged-in cart merge needs an OTP session. |
| Cart promotion (cart-promotion.mjs, promotion-money.mjs, promotion-race.mjs) | code discount applies in quote; disabled code no longer applies | 11 | 🟡 Wrong-code guessing guard and race not covered |
| Cart reminder job (cart-reminder.mjs) | — | — | ⛔ The job emails opt-in customers. The suite never triggers real email sends. |
| Customer auth / OTP (customer-auth.mjs, review-otp-race.mjs) | wrong challenge → OTP_INVALID; every `/me*` → 401 without a token; forged token 401; logout no-op | 10 | 🟡 Requesting an OTP sends an email, so the happy path (verify, `/me`, addresses, reorder, `/me/loyalty`) is ⛔. BUG-03 covers the OTP race script. |
| Customer data rights self-service (data-rights.mjs) | `/me/erase` and `/me/data-export` require auth | 10 | 🟡 The happy path needs OTP (⛔) |
| Gift card balance (gift-card-*.mjs) | balance of an issued card; unknown code → GIFT_CARD_INVALID | 10 | ✅ |
| Gift card as payment (gift-card-payment.mjs) | quote `dueAfterGiftCard` < total; order debits the card | 10 | ✅ |
| Gift card sale (gift-card-sale.mjs, gift-card-counter.mjs) | — | — | ❌ Ordering the gift-card product and its issue-on-payment are not covered (needs a paid flow plus email delivery of the code) |
| Dine-in (dine-in.mjs) | resolve the table token; bad token → TABLE_NOT_FOUND; session close in UI | 10, 02 | ✅ |
| Delivery quote (delivery-quote.mjs) | quote with an address | 08 | ⛔ Skipped: the administrative-unit catalog is missing in dev (`unknown-commune`). It only exists in `ORDERING_TEST_BUILTINS` mode. |
| Wallets: MoMo / VNPay / payment session (momo.mjs, vnpay.mjs, wallet-status.mjs) | — | — | ⛔ Live payment providers. The suite never calls them. |
| SePay inbound webhook (sepay-webhook, sepay-match, sepay-reconcile, sepay-expiry, sepay-alerts) | provider unconfigured → must be 4xx | 99 (🐞 BUG-14) | ⛔ Matching and reconciliation need `SEPAY_WEBHOOK_SECRET` + `SEPAY_ACCOUNTS` (unset locally) |
| Pause / busy (pause.mjs) | pause pickup blocks quotes; resume; busy adds minutes to config | 10 | ✅ |
| Sold-out toggle / daily stock (catalog-availability.mjs, daily-stock.mjs) | sold-out blocks the quote; daily limit 1 → qty 5 refused | 10 | ✅ Concurrency (last unit) is not covered. |
| Public OpenAPI (openapi.mjs) | openapi.json served | 08 | ✅ |
| Intake secret / per-IP rate limit (storefront-guard) | no secret → never 5xx | 10 | 🟡 |

## 2. Admin — orders & operations

| Feature | Cases | Spec | Status |
|---|---|---|---|
| Orders inbox (admin-orders.mjs) | accept (detail page); branch picker; tabs; search 🐞 BUG-15 | 01, 99 | 🟡 Accepting from the inbox row is blocked by BUG-15 on a busy DB |
| Lifecycle / transitions (transition.mjs) | preparing → ready → cash handover → completed; invalid target; transition after cancel; completed straight from awaiting refused | 01, 11 | ✅ |
| Cancel with reason | dialog requires a reason (≥ 6 options); API without a reason → 4xx | 01, 11 | ✅ |
| Internal notes | persists after reload | 01 | ✅ |
| Staff draft orders (lookup-drafts.mjs) | draft quote; consent required; draft → confirm; delete draft | 11 | ✅ "Tạo đơn hộ" UI not covered |
| Order edit (order-edit.mjs) | preview, edit (add line), stale revision refused | 11 | ✅ |
| Line cancel (sepay-link / admin-orders) | preview; cancel 1; over-quantity refused | 11 | ✅ |
| Refunds (payment-refund.mjs) | UI cash refund; over-amount refused; settle a pending refund | 01, 11 | ✅ |
| Manual bank transfer (sepay-manual.mjs) | UI from the order menu; UI from Payment Review; empty reference / zero amount refused | 01, 03, 11 | ✅ |
| Payment link (sepay-link.mjs) | no 5xx | 11 | 🟡 Real link generation needs SePay configured (⛔) |
| Payment review (sepay-review.mjs) | manual record; reopen | 03 | 🟡 Reopen is skipped when no closed review exists (needs webhook traffic) |
| Kitchen / KDS (kds.mjs) | API start/complete; line prepared; page loads | 02, 11 | ✅ UI board 🐞 BUG-01 |
| KDS / orders SSE streams (stream.mjs) | — | — | ❌ The SSE endpoints are not asserted; the OpenAPI sweep skips streams. |
| Print (print.mjs) | print order payload contains the code | 11 | 🟡 Table-session print is not covered |
| Export CSV (order-export.mjs) | today's CSV contains the new order | 11 | ✅ |
| Cash closing (cash-closing.mjs) | close or adjust in the UI (reason required); duplicate → CASH_CLOSING_EXISTS; list | 03, 11 | ✅ Difference after close 🐞 BUG-06 |
| Courier / delivery assignment (courier.mjs, delivery-assignment.mjs) | courier deliveries endpoint answers; role menu | 11, 07 | ⛔ No delivery order can be created locally (commune catalog missing) |
| Carrier / Ahamove (ahamove.mjs) | carrier quote → no 5xx | 11 | ⛔ Live carrier API. Booking and cancel are not called. |
| Tables & QR (dine-in.mjs) | create, toggle active, rotate QR (UI); qr.svg via the OpenAPI sweep | 02 | ✅ |
| Table sessions | dine-in order on a new table, close with cash (UI) | 02 | ✅ |

## 3. Admin — marketing

| Feature | Cases | Spec | Status |
|---|---|---|---|
| Promotions admin (promotions-admin.mjs) | UI create + edit; percent > 100 refused; duplicate code case-insensitive; generate codes; > 5000 refused; export codes; redemptions; disable code / promo | 04, 11 | ✅ Preview timezone 🐞 BUG-09 |
| Gift cards admin (gift-card-admin, ledger, report) | UI issue (code shown once); block / unblock; reason required; search; extend; adjust; batches + export | 04, 11 | ✅ `resend` ⛔ (sends email). Batch CSV import not covered. |
| Loyalty settings / tiers (loyalty-admin, loyalty-tiers) | UI tier create + edit (+ cleanup); settings validation; recalc; report | 04, 11 | ✅ English errors 🐞 BUG-08 |
| Loyalty earn / redeem / expiry / race (loyalty-earn, redeem, expiry, race) | unverified guest earns 0; manual adjust ± on an active customer | 04 | 🟡 Earn/redeem need an OTP-verified customer (⛔ email). Expiry is job-driven. |
| Customer groups (price-lists.mjs) | UI create + edit; member search | 04, 11 | ✅ |
| Price lists (price-lists.mjs) | UI create with an item; options; price preview | 04, 11 | ✅ Generic error 🐞 BUG-08 |

## 4. Admin — customers, privacy, feedback, alerts

| Feature | Cases | Spec | Status |
|---|---|---|---|
| Customers (customers.mjs) | list/search; profile; staff edit; reveal phone (audited); export | 11 | ✅ `totalSpent` 🐞 BUG-02. The Customers UI page is only covered by the OpenAPI sweep. |
| Data requests (data-rights.mjs, review-erasure-race.mjs, data-request-overdue.mjs) | export processed; erase waits while an order is open, then reject with a reason; validation | 06, 11 | ✅ Erase is two-step in the UI and needs `confirm: true` on the API (`@ux-erase-confirm`); the erase UI flow in 06 clicks both steps. Overdue alert and erasure race are not covered. |
| Consent policy (consent-policy.mjs) | wrong version refused; draft consent required | 10, 11 | ✅ |
| Retention (retention.mjs) | — | — | ❌ Job-driven over long time windows |
| Ratings (rating.mjs) | UI note + hide; tag label 🐞 BUG-12 | 06 | ✅ |
| Alerts engine / SLA (alerts-engine.mjs, sla-alerts.mjs) | acknowledge in the UI; alert-rules round-trip; evaluate job runs | 06, 11 | 🟡 Rule firing on SLA breach is not asserted (needs time travel) |
| Audit log (audit-log.mjs, audit-coverage.mjs) | list / actors / detail / export; reveal-phone audited | 11 | ✅ The AuditLog UI page only has a GET sweep. |

## 5. Admin — configuration, roles, ops

| Feature | Cases | Spec | Status |
|---|---|---|---|
| Categories (catalog-categories.mjs) | UI CRUD with child; move; delete with linked products needs confirm | 05, 11 | ✅ 403 page 🐞 BUG-07 |
| Catalog CSV import/export (catalog-csv.mjs) | export; imports list | 11 | 🟡 Upload + apply is not covered (multipart upload is not wired in the fixtures) |
| Catalog adapter / extension (catalog-adapter, catalog-extension) | — | — | ❌ Internal extension API. vitest covers it, not E2E. |
| Branches (branches.mjs) | UI create + edit + tabs; branch delivery-quote | 05 | ✅ / ⛔ delivery quote (commune catalog) |
| Sales settings | UI field + reject reason persist; API round-trip | 05, 11 | ✅ |
| Staff scopes (scope.mjs) | UI add Q3 then revert; grant escalation refused; branch scope | 05, 07 | ✅ |
| Roles / permissions | API matrix; UI menu per role (accountant); Categories and Availability show "no permission" for accountant; giao-q1 has no Bếp link while a manager has it (kitchen menu follows `kitchen.read`) | 07 | ✅ |
| Ops status / jobs (ops-status.mjs, jobs.mjs, auto-reject.mjs) | status; run payment-expiry / auto-reject / data-request-waiting / alerts-evaluate; unknown job 404 | 11 | 🟡 Auto-reject effect on an old order is not asserted (needs aging) |
| Outbox (outbox-two-process.mjs) | — | — | ⛔ Two-process locking cannot be driven from a browser suite. Retry needs a failed entry. |
| Outgoing webhooks (webhooks-admin, webhooks-out, webhook-new-events, review-webhook-fanout) | list; events; invalid URL; private target refused | 11 | ⛔ Delivery and test need a reachable public endpoint (box DNS resolves example.com to 198.18.0.1) |
| Notifications: log / templates / channels (notification-log, email-templates, notifications, notify-*) | log + summary + technical; template get / preview / invalid save; channels list | 11 | ⛔ `…/test` and channel test send real messages |
| SMS / Zalo ZNS (sms.mjs, zalo-zns.mjs) | — | — | ⛔ Live providers |
| Providers page | React key warning | 99 (🐞 BUG-11) | 🟡 |
| Reports (reports.mjs) | sales requires `from`; sales; branches; loyalty report | 11 | ✅ The Reports UI page only has a GET sweep. |
| Admin OpenAPI (openapi.mjs) | every GET → no 5xx; required params 🐞 BUG-10 | 08, 99 | ✅ |
| Unknown admin route | 🐞 BUG-13 | 99 | 🐞 |
| i18n (vi / en) | storefront `locale=en`; admin UI runs in vi-VN | 10, all UI | 🟡 No full English admin run. Mixed-language findings are in the report. |
| Build / registry / schema scripts (admin-build, build-server, check-*-imports, registry-boot, schema, disable-survives) | — | — | ❌ Build-time checks. They belong to CI scripts, not a browser E2E suite. BUG-04 runs the registry unit test. |

## 6. Bug regressions (`99-bugs.spec.ts`; each fails while its bug exists)

| Tag | What it asserts |
|---|---|
| @bug-01 | Kitchen board shows a preparing order |
| @bug-02 | Customer `totalSpent` is a numeric sum |
| @bug-03 @slow | `review-otp-race.mjs` finishes |
| @bug-04 @slow | `registry.test.ts` passes |
| @bug-05 @slow | `uat-server.mjs` boots (throwaway DB) |
| @bug-06 | Cash-closing difference updates after more cash is collected (API `liveDifferenceAmount` + the UI cell and its "Lúc chốt" line) |
| @bug-07 | 403 shows "no permission" (Categories as lan-q1) |
| @bug-08 | Price-list and loyalty-tier errors are specific and in Vietnamese |
| @bug-09 | Promotion preview uses store time even in a UTC browser |
| @bug-10 | OpenAPI required params (reports, cash-closing) + loyalty settings request body + GET→PUT round-trip |
| @bug-11 | No React key warning on Providers |
| @bug-12 | Rating tag shows its label, not `late` |
| @bug-13 | Unknown ordering route shows not-found |
| @bug-14 | Webhook for an unregistered provider → 4xx, not 500 (**new**, found by this suite) |
| @bug-15 | Orders inbox search submits `q=` and filters (**new**, found by this suite) |
| @ux-erase-confirm | Erase is not the default type; the red warning names the phone; "Quay lại" erases nothing; "Xóa vĩnh viễn" erases; the API refuses `kind: erase` without `confirm: true` (400, field `confirm`) |
