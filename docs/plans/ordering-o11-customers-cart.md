# O11 — Khách hàng, giỏ hàng, quyền dữ liệu: kế hoạch thực hiện

Status: Implemented — chờ UAT thủ công + merge về `feat/ordering`
Owner: tan_ngo (duyệt), AI thực hiện
Last updated: 2026-10-14
Related phase: [`phases/phase-ordering-11-customers-cart.md`](../phases/phase-ordering-11-customers-cart.md)

Đặc tả màn hình: [`ordering-o11-screens.md`](ordering-o11-screens.md) (C1–C3 Admin, W1–W4 phía khách, reference U11).
Mockup: [`mockups/ordering-o11-customers-cart.html`](mockups/ordering-o11-customers-cart.html).

## Goal

Hồ sơ khách + OTP, sổ địa chỉ, giỏ server, đặt lại đơn, nhắc giỏ bỏ dở, quyền xem/xuất/xóa dữ liệu.

## Non-goals

- Mật khẩu, mạng xã hội, tích điểm, wishlist, gộp hồ sơ khác số. Nhóm khách và giá theo nhóm: O14.

## Current evidence

- Đơn lưu liên hệ trong `order.contactSnapshot { name, phone (E.164), email? }` và địa chỉ trong `receiveMethod.address`
  + `fulfillment.addressSnapshot`; `consentSnapshot { policyVersion, … }`; chuẩn hóa số `shared/contact/phone.ts`.
- Tra cứu đơn công khai bằng mã + số điện thoại (`storefront.lookup`, so sha256 hằng thời gian); token đơn
  `X-Order-Token` (niêm phong trong idempotency, `token-cipher`).
- `services/order.ts` `quote`/`createOrder` (idempotency `order.create`); O8 thêm `promotionCode`, O9 `giftCardCode`.
- Notification: email provider, mẫu (O10 sửa được), outbox `availableAt` để gửi trễ.
- Rate limit `controllers/storefront-guard.ts`; captcha `verifyCaptcha`.
- Không có bảng khách; Salanca app có `users-permissions` nhưng plugin không được phụ thuộc code/app.

## Decisions and assumptions

- Decision: khách là bảng riêng của plugin (`customer`), **không** dùng `users-permissions` (plugin dùng chung, không
  phụ thuộc cấu hình người dùng của app).
- Decision: định danh = số điện thoại E.164 (duy nhất). Email tùy chọn, xác minh qua OTP email.
- Decision: đăng nhập OTP 6 số; kênh = email ngay; `sms`/`zalo` khi O13 có provider (cấu hình `customers.otpChannels`).
  Mã lưu `HMAC(encryptionKey, code + challengeId)`; hạn 5 phút; 5 lần thử; gửi tối đa 3 lần/10 phút/định danh và
  10 lần/giờ/IP; captcha khi gửi.
- Decision: phiên = token 32 byte ngẫu nhiên, header `X-Customer-Token`; lưu sha256; hạn trượt 30 ngày; tối đa 10 phiên.
- Decision: đơn gắn khách bằng `order.customer` (relation) khi tạo đơn: theo phiên nếu có, không thì theo số điện thoại
  (tạo hồ sơ "chưa xác minh" nếu chưa có). Backfill đơn cũ trong migration theo `contact_snapshot->>'phone'`.
- Decision: giỏ server là **tùy chọn** cho web: API quote/create cũ giữ nguyên; giỏ là lớp phía trên gọi lại
  `prepareOrder`/`createOrder`.
- Decision: xóa dữ liệu = **ẩn danh** đơn đã đóng + xóa hồ sơ/địa chỉ/giỏ/phiên/OTP; đơn còn mở thì yêu cầu ở trạng
  thái `waiting` tới khi đơn đóng (job xử lý). Giữ: mã đơn, chi nhánh, thời gian, món, số tiền, payment/refund (sổ
  sách); payload thanh toán thô đã có retention O6. Ẩn danh: `contactSnapshot = { name: 'Khách đã xóa', phone: null,
  phoneHash: HMAC }`, địa chỉ → chỉ giữ tỉnh/xã (cho báo cáo vùng), ghi chú khách → null, đánh giá O8 → xóa comment.
- Decision: quyền mới `customer.read` (xem hồ sơ trong scope — khách có đơn ở chi nhánh trong scope; `allLocations`
  xem hết), `customer.manage` (sửa, xuất dữ liệu), `customer.erase` (xử lý yêu cầu xóa).
- Owner decision required: thời hạn giữ hồ sơ khách không hoạt động (đề xuất 24 tháng rồi ẩn danh) — chờ pháp lý;
  code để cấu hình `customers.inactiveErasureMonths` (mặc định tắt).
- Assumption: nhắc giỏ bỏ dở là tiếp thị → cần đồng ý tiếp thị riêng (không dùng đồng ý xử lý đơn).

## Invariants

- Không lộ hồ sơ có tồn tại hay không qua OTP/tra cứu.
- Token phiên, mã OTP chỉ lưu hash; không log số điện thoại/email.
- Khách chỉ thấy dữ liệu của chính mình; Admin thấy theo scope.
- Ẩn danh không đổi bất kỳ số tiền, sổ payment/refund, báo cáo hay chốt tiền.
- Giỏ không bao giờ là nguồn sự thật về giá: mọi lần đọc giỏ và checkout đều tính lại ở server.

## Data model

| Bảng | Field |
| --- | --- |
| `customer` | `phone` (E.164, unique, null khi đã xóa), `phoneHash` (HMAC, unique), `email?`, `emailVerifiedAt?`, `name?`, `status` active\|unverified\|erased, `marketingConsent` JSON `{ granted, at, source, policyVersion }`, `orderCount`, `totalSpent`, `lastOrderAt?`, `erasedAt?` |
| `customer-address` | `customer`, `label`, `recipientName`, `phone`, `provinceCode/Name`, `communeCode/Name`, `line1`, `note?`, `isDefault` |
| `customer-session` | `customer`, `tokenHash` (unique), `createdAt`, `lastSeenAt`, `expiresAt`, `userAgent?` (rút gọn), `revokedAt?` |
| `customer-otp` | `challengeId` (uuid), `channel` email\|sms\|zalo, `targetHash`, `codeHash`, `attempts`, `expiresAt`, `consumedAt?` |
| `cart` | `tokenHash` (unique, cho khách vãng lai), `customer?`, `locationRef?`, `receiveMethod` JSON, `lines` JSON `[{ id, sellableUid, variantUid?, options, quantity, note? }]` (≤ 50), `promotionCode?`, `giftCardCodeSealed?`, `contact` JSON?, `status` active\|converted\|expired, `order?`, `lastActivityAt`, `expiresAt`, `reminderSentAt?` |
| `data-request` | `customer?`, `phoneHash`, `kind` export\|erase, `source` customer\|staff, `status` received\|waiting\|done\|rejected, `requestedAt`, `doneAt?`, `handledBy?`, `note?`, `result` JSON (số đơn ẩn danh…) |
| `order.customer` (mới) | relation manyToOne `customer` (nullable) |

Migration `0009-o11-customers.ts`: unique index trên; index `cart(last_activity_at)` cho nhắc giỏ; backfill
`customer` từ đơn (theo số điện thoại, status `unverified`), gắn `order.customer`, tính `orderCount/totalSpent`.

## API

Công khai (`/api/v1/ordering`, header `X-Customer-Token` khi đã đăng nhập):

| Method | Path | Body | Trả về / lỗi |
| --- | --- | --- | --- |
| POST | `/auth/otp` | `{ channel, target (email\|phone), captchaToken }` | `{ challengeId }` luôn 200 (không lộ tồn tại); `RATE_LIMITED` |
| POST | `/auth/verify` | `{ challengeId, code }` | `{ token, customer }`; `OTP_INVALID` 400 (`details.attemptsLeft`), `OTP_EXPIRED` 400 |
| POST | `/auth/logout` | — | 204 |
| GET/PUT | `/me` | `{ name, email?, marketingConsent? }` | hồ sơ (đổi email cần OTP email) |
| GET/POST/PUT/DELETE | `/me/addresses[/:id]` | địa chỉ O5 | danh sách / địa chỉ |
| GET | `/me/orders?page=` | — | đơn của tôi (dùng `lookupOrderView` rút gọn) |
| POST | `/me/orders/:code/reorder` | — | `{ cart, unavailable: [{ title, reason }] }` |
| GET | `/me/data-export` | — | JSON (hồ sơ, địa chỉ, đơn đã ẩn PII người khác) |
| POST | `/me/erase` | `{ confirm: true }` | `data-request` `received` + đăng xuất mọi phiên |
| POST | `/carts` | `{ locationRef?, receiveMethod? }` | `{ cartToken?, cart, quote }` |
| GET | `/carts/current` | header `X-Cart-Token` hoặc phiên | `{ cart, quote, issues: [{ lineId, code, message }] }` |
| PATCH | `/carts/current` | `{ locationRef?, receiveMethod?, contact?, promotionCode?, giftCardCode? }` | như GET |
| POST/PATCH/DELETE | `/carts/current/lines[/:lineId]` | dòng | như GET |
| POST | `/carts/current/checkout` | `{ consent, captchaToken, payment, idempotencyKey }` | như `POST /orders` (token đơn) |

Lỗi mới: `OTP_INVALID`, `OTP_EXPIRED`, `CUSTOMER_AUTH_REQUIRED` 401, `CART_NOT_FOUND` 404, `CART_EXPIRED` 410,
`CART_LIMIT` 400 (> 50 dòng), `DATA_REQUEST_PENDING` 409.

Admin (`/ordering`):

| Method | Path | Quyền | Mô tả |
| --- | --- | --- | --- |
| GET | `/customers?q=&page=` | `customer.read` | tìm SĐT (chuẩn hóa → hash), tên, email; lọc scope |
| GET | `/customers/:id` | `customer.read` | hồ sơ (SĐT che giữa, xem đủ có ghi log), đơn, địa chỉ, đồng ý, yêu cầu |
| PUT | `/customers/:id` | `customer.manage` | tên, ghi chú nội bộ |
| GET | `/customers/:id/export` | `customer.manage` | JSON (change-log `customer.export`) |
| GET | `/data-requests?status=` | `customer.erase` | hàng yêu cầu |
| POST | `/data-requests` | `customer.erase` | quán tạo yêu cầu thay khách (`{ phone, kind, note }`) |
| POST | `/data-requests/:id/process` | `customer.erase` | xử lý (ẩn danh); đơn mở → `waiting` |
| POST | `/data-requests/:id/reject` | `customer.erase` | `{ reason }` (ví dụ nghĩa vụ lưu trữ) |

## Implementation steps

1. **Bảng, quyền, backfill**
   - Files: 6 content type + `order.customer`, migration `0009` (backfill theo lô 500), `register.ts` (3 action),
     `types/generated`.
   - Verification: `scripts/ordering/customers.mjs` (mới): backfill gắn đúng, chạy lại migration không nhân đôi.
2. **OTP + phiên**
   - Files: `domain/customers/otp.ts` (sinh mã `crypto.randomInt`, HMAC, so hằng thời gian), `services/customer-auth.ts`,
     mẫu email `customer.otp` (VI/EN, sửa được qua O10), routes `/auth/*`, middleware đọc `X-Customer-Token` →
     `ctx.state.customer`.
   - Verification: `scripts/ordering/customer-auth.mjs` đủ ca OTP/phiên trong spec.
3. **Hồ sơ, địa chỉ, đơn của tôi, gắn đơn**
   - Files: `services/customer.ts`, routes `/me*`; `createOrder` gắn `order.customer` (phiên hoặc theo SĐT), cập nhật
     `orderCount/totalSpent/lastOrderAt` khi đơn `completed` (outbox consumer); CORS thêm header `X-Customer-Token`,
     `X-Cart-Token` (như `X-Order-Token` O3).
   - Verification: `customers.mjs` mở rộng: khách A đọc đơn B → 404; đơn vãng lai cùng SĐT tự gắn.
4. **Giỏ server**
   - Files: `services/cart.ts` (tạo, sửa dòng, gộp khi đăng nhập, `view` = gọi `order.quote` với nội dung giỏ + issues
     theo dòng, checkout = `createOrder` + `status converted`), routes `/carts*`, job `cart-expiry` (đánh dấu hết hạn,
     xóa sau 30 ngày).
   - Verification: `scripts/ordering/cart.mjs`, `cart-checkout.mjs`: đủ ca trong spec; giá thay đổi giữa hai lần đọc giỏ
     → báo giá mới; checkout idempotent.
5. **Đặt lại + nhắc giỏ**
   - Files: `services/cart.ts` `fromOrder`; job `cart-reminder` (mỗi 15 phút: giỏ có dòng, có liên hệ, khách đồng ý tiếp
     thị, không hoạt động 2 giờ, chưa nhắc) → mẫu `customer.cart-reminder`; cấu hình theo chi nhánh `cartReminderEnabled`.
   - Verification: script: không đồng ý → không gửi; gửi một lần; đặt lại giữ món còn bán.
6. **Quyền dữ liệu**
   - Files: `services/data-rights.ts` (`export(customerId)`, `erase(requestId)` theo lô, idempotent; ẩn danh order,
     fulfillment, timeline payload công khai, notification-delivery (xóa email đã hash? giữ hash), rating comment, cart,
     session, otp, address; webhook `customer.erased` không PII), job `data-request-waiting` (đơn đã đóng → xử lý),
     routes công khai `/me/data-export`, `/me/erase`, Admin `/data-requests*`.
   - Verification: `scripts/ordering/data-rights.mjs`: ẩn danh đúng field; báo cáo O6 và chốt tiền trước/sau bằng nhau;
     đơn mở → waiting → đóng → xử lý; chạy lại không lỗi; xuất chỉ dữ liệu của khách đó.
7. **Admin khách hàng (C1–C3)**
   - Files: `admin/src/pages/Customers/`, `admin/src/pages/DataRequests/`, nhóm menu **Vận hành** (Khách hàng) và
     **Cấu hình** (Yêu cầu dữ liệu), chi tiết đơn S4 link sang khách, `translations/o11.ts`.
   - Verification: script HTTP: scope (khách chỉ có đơn ở Q3 → nhân viên Q1 không thấy, 404); xem SĐT đầy đủ ghi
     change-log.
8. **Tài liệu, gate**
   - Files: API contract (auth, giỏ, /me), staff guide (tra khách, xử lý yêu cầu xóa), security baseline (OTP, phiên,
     dữ liệu cá nhân), `docs/ordering-integrations.md` (sự kiện `customer.*`), screens "Đã đổi khi code", STATUS,
     Completion record.
   - Verification: gate đầy đủ, `check:ordering` 2 lượt.

## Data and rollback

- Migration `0009` thêm bảng, cột relation trên `order`, backfill. Rollback: `customers.enabled=false`,
  `carts.enabled=false`; bảng giữ lại; đơn vẫn có `contactSnapshot` như cũ.

## Verification

- Automated: lint, typecheck, test, `check:ordering` 2 lượt, `check:phase3` tắt/bật, smoke, build tắt/bật.
- Manual UAT: theo spec.

## Documentation impact

- Spec/screens/mockup O11, reference U11, API contract, staff guide, security baseline, integrations, STATUS, roadmap.

## Risks and blockers

- Pháp lý chưa chốt thời hạn giữ dữ liệu/nội dung đồng ý → tính năng có cờ tắt mặc định cho phần tự động ẩn danh.
- OTP qua email chậm/spam folder → khuyến nghị bật SMS/Zalo (O13) trước khi mở đăng nhập cho khách thật.

Ước lượng thô: 3 tuần (1: 2 ngày; 2–3: 4 ngày; 4–5: 4–5 ngày; 6: 3 ngày; 7: 3 ngày; 8: 1–2 ngày).

## Completion record

Triển khai trên branch `feat/ordering-o11`, 7 commit:

- `0a32a0b` — Step 1: content types `customer`, `customer-address`, `customer-session`, `customer-otp`,
  `customer-cart`, `data-request`; migration backfill `phoneHash` từ đơn cũ; cấu hình `customers`,
  `carts`, `dataRights`; `hashing`/`normalizeVietnamesePhone` mở rộng.
- `16ef7b6` — Step 2: OTP email 6 số (TTL 5', ≤5 lần thử, ≤3 gửi/10' theo đích, ≤10 gửi/giờ theo IP),
  phiên khách 30 ngày (≤10 phiên), `X-Customer-Token`, mẫu `customer.otp`.
- `b036a1b` — Step 3: `/me` hồ sơ, sổ địa chỉ (≤10), `/me/orders`, đặt đơn tự gắn khách, merge giỏ
  khi đăng nhập.
- `0bb6cae` — Step 4: `/carts` server-side (guest `X-Cart-Token` + customer), quote lại server-side
  lúc checkout, idempotent qua `order.create`, `cart-expiry` job (7 ngày idle, dọn 30 ngày).
- `a88fe3e` — Step 5: `POST /me/orders/:id/reorder` (giỏ mới, dòng lỗi kèm `issues`), nhắc giỏ bỏ dở
  (idle 2h, cron 15', cờ `cartReminderEnabled` per-branch, chỉ khi opt-in tiếp thị), mẫu
  `customer.cart-reminder`.
- `e4dc10a` — Step 6: `/me/data-export`, `/me/erase`, hàng đợi `data-request` (received→waiting→done/
  rejected, hạn 72h), staff tạo yêu cầu (chỉ lưu hash), xử lý khi đơn đóng, ẩn danh đơn + giỏ + phiên
  + OTP + địa chỉ, outbox `customer.erased` (chỉ `customerHash`), báo cáo/kết ca giữ nguyên sau xóa.
- `3e7cc0c` — Step 7: Admin C1 danh bạ (tìm SĐT/tên/email, lọc trạng thái + opt-in, mask, scope chi
  nhánh, phân trang), C2 chi tiết (stats, đơn gần, địa chỉ mask, sửa tên/ghi chú → `customer.update`,
  reveal → `customer.reveal-phone`, export, tạo yêu cầu xóa), C3 hàng đợi (4 tab, hạn từ
  `deadlineHours`, quá hạn tô đỏ, xử lý/từ chối/tạo), nav + RBAC `customer.*`, link S4→C2.

### Lệnh đã chạy — kết quả

- `pnpm run build:ordering` — PASS (mỗi step).
- `npm run typecheck` — PASS.
- `npm run lint` — PASS.
- `npm run test` — PASS 166 file / 1222 test (vitest).
- `npm run build` — PASS (server TS + admin bundle).
- `scripts/ordering/customer-auth.mjs` — PASS (OTP gửi/đúng/sai/hết lượt, phiên, rate-limit IP+đích).
- `scripts/ordering/customers.mjs` — PASS (hồ sơ, địa chỉ, đơn của tôi, link đơn).
- `scripts/ordering/cart.mjs` — PASS (token, dedupe, cap 50, merge, expiry).
- `scripts/ordering/cart-checkout.mjs` — PASS (checkout idempotent, replay 200, key khác → 410).
- `scripts/ordering/cart-reminder.mjs` — PASS (idle→gửi 1 lần, cờ branch, opt-in, retry lỗi SMTP).
- `scripts/ordering/data-rights.mjs` — PASS (export đúng của mình; xóa waiting khi còn đơn mở, tự hoàn
  tất khi đơn đóng; idempotent; staff request không lưu SĐT thô; reject một lần; scope export; báo cáo
  không đổi sau xóa; `customer.erased` payload không PII).
- `scripts/ordering/admin-customers.mjs` — PASS (list+mask+scope+phân trang; detail stats; update →
  `customer.update`; reveal một lần → `customer.reveal-phone`; export; tạo request theo `customerId`
  trong scope / 404 ngoài scope; queue 4 tab + process/reject; quyền 403 khi thiếu `customer.*`).
- `scripts/ordering/schema.mjs`, `openapi.mjs`, `email-templates.mjs` (16 mẫu), `notifications.mjs` —
  PASS.
- `pnpm run check:ordering` — **61/61 script PASS, hai lượt liên tiếp** (mỗi lượt gồm
  `build:ordering` + `run-all.mjs` gồm build admin + schema + toàn bộ integration gate).
- `docs/ordering-admin-openapi.json` regen bằng `pnpm run ordering:openapi` (78 paths, gồm
  `/ordering/customers*` + `/ordering/data-requests*`).

### Sửa phát sinh trong gate cuối

- `_harness.mjs` `purgeStaleTestIdentities`: mở rộng dọn user `*@example.test` + role `UAT ordering *`
  — một super-admin `o0-uat@example.test` sót từ run UAT cũ trên `salanca_ordering_test` nhận mọi
  alert `ops.read`/`report.read` làm `alerts-engine.mjs` và `cash-closing.mjs` fail (3 mail thay 2).
- `o3.test.ts`: gộp pack `o11Messages` vào tập `known`, thêm `pages/Customers`, `pages/DataRequests`
  vào O3_DIRS — coverage key i18n cho cả màn O11.
- `data-rights.ts` `listRequests` trả `deadlineHours` (từ `dataRights.deadlineHours`, mặc định 72) để
  UI C3 tính hạn thay vì hardcode; `DataRequests/index.tsx` dùng giá trị server.

### Còn lại

- UAT thủ công trên `npm start` + một tab Admin: C1 tìm/lọc/phân trang; C2 sửa, reveal, export, dialog
  xóa; C3 4 tab + tạo/xử lý/từ chối + hàng quá hạn đỏ; link S4→C2; vai trò thiếu quyền; scope chi
  nhánh bằng mắt.
- Merge `origin/feat/ordering` vào `feat/ordering-o11`, rồi hợp về `feat/ordering`; push hai branch.

### Review fixes và tích hợp O8 — 2026-10-13

Phạm vi bổ sung được chủ dự án yêu cầu trong phiên review local. Commit local `fdf87ad` giải quyết
merge O7 đang dở và ba lỗi O11; tiếp tục tích hợp `origin/feat/ordering` tại `1de85e1` (đã có O8).
Các kết quả lịch sử phía trên không thay thế gate của bản đã tích hợp này.

- OTP: khóa dòng challenge trong transaction PostgreSQL trước khi đọc/kiểm tra. Lần thử sai được
  commit rồi mới trả lỗi; tiêu thụ mã và tạo phiên thành công cùng transaction. Regression: 8 lần
  xác minh đồng thời chỉ tạo 1 phiên; 8 lần sai ghi đủ 5 lần rồi chặn cả mã đúng.
- Scope: tạo yêu cầu bằng SĐT hoặc customerId đều kiểm phạm vi; list/count/process/reject dùng cùng
  điều kiện chi nhánh. Không có scope thì không được truy cập hàng đợi. Yêu cầu không còn khách có
  đơn trong scope (sau ẩn danh) chỉ quản lý allLocations xem được.
- Khách vãng lai: tạo hồ sơ unverified khi số E.164 chưa có; advisory lock theo phoneHash trong
  transaction đặt đơn ngăn tạo trùng khi đồng thời. Không khôi phục hồ sơ erased và không coi SĐT
  nhập lúc checkout là danh tính đã xác minh.
- Merge lấy đủ routes, register, errors, i18n, test dịch, audit (có nhóm promotion), alert codes,
  schema và các script của O7/O8/O11. Giữ `0007-o11-customers` và `0008-o8-promotions-rating`.
  Danh mục email là **18 mẫu**, gồm `customer.rating-invite`, `customer.otp`, `customer.cart-reminder`.
- Xóa dữ liệu O8: xóa `order-rating.comment`, `staffNote`, `staffNoteBy` của đơn được ẩn danh;
  giữ sao, nhãn, trạng thái và thời gian đánh giá để báo cáo không đổi. Gỡ liên kết đơn, ẩn danh
  địa chỉ/timeline và xóa ghi chú đánh giá cùng transaction: lỗi giữa chừng không làm mất đường
  tìm dữ liệu để chạy lại.
- **Quyết định customerKey:** giữ nguyên `promotion-redemption.customerKey` và các cột số tiền,
  trạng thái, thời gian của redemption. Đây là HMAC có khóa (dữ liệu định danh giả, không phải
  SĐT thô). Lý do: duy trì giới hạn lượt theo khách và đối chiếu khuyến mãi; xóa hoặc đổi khóa sẽ
  làm số đã dùng được xem như chưa dùng sau khi xóa tài khoản. Không ghi thêm bảng ánh xạ về SĐT.
  Test so toàn bộ redemption trước/sau ẩn danh và sau chạy lại bằng nhau; báo cáo bán hàng giữ nguyên.
- Quote công khai và quote giỏ không dùng lịch sử SĐT; ưu đãi theo số tiếp tục ở pendingPromotions,
  quyết khi tạo đơn. Quote theo danh tính OTP để sau. **Chủ dự án chọn để promotionCode trong giỏ
  sang đợt sau**; bản này không thêm field giỏ hay giao diện áp mã.
- Không đổi dependency. Audit public npm registry báo 6 critical / 38 high / 61 moderate / 6 low
  trong cây dependency hiện tại; gate audit không đạt, chưa sửa framework/dependency trong phạm vi này.

Gate của bản tích hợp (targeted, `salanca_ordering_o11`, 2026-10-13): lint, typecheck sạch; vitest plugin
61 file / 632 test; `build:ordering` sạch; `ts:generate-types` không đổi types; `ORDERING_ENABLED=true strapi
build` OK sau khi sửa chuỗi i18n gộp lẫn `||` với `??` (esbuild từ chối). Script PASS: `customers`,
`customer-auth`, `admin-customers`, `cart`, `cart-checkout`, `cart-reminder`, `data-rights`, `promotions`,
`promotion-money`, `promotion-race`, `promotions-admin`, `rating`, `email-templates`, `audit-coverage`,
`audit-log`, `schema`, `openapi --write` (94 path), `reports`, `retention`, `order-edit`, `cash-closing`,
`storefront`, `create-order`, `idempotency`, `notifications`, `alerts-engine`, `webhooks-out`,
`lookup-drafts`, `order-export`, `courier`, `daily-stock`, `payment-refund`, `transition`,
`check-admin-imports`, `check-dist-imports`. Không chạy full `check:ordering`, phase3 hay smoke CMS.
Chưa UAT trình duyệt.
