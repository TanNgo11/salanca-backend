# O11 — Khách hàng, giỏ hàng, quyền dữ liệu: kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt), AI thực hiện
Last updated: 2026-10-12
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

- Chưa bắt đầu.
