# Core gaps — kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt), AI thực hiện
Last updated: 2026-10-14
Nhánh: `TanNgo11/ordering-core-gaps` (tách từ `feat/ordering` `f32ba2f`), merge về `feat/ordering`.

## Goal

Đóng các lỗ hổng nhỏ còn lại của core plugin sau O1–O15 — những mục **không chờ quyết định** của chủ dự án:
token bàn trong log, chọn biến thể món, thẻ tổng thanh toán, bán thẻ quà tặng tại quầy trên Admin, webhook
khuyến mãi/đánh giá, sửa `consent.policyVersion` trong Admin, cảnh báo yêu cầu dữ liệu trễ hạn.

## Non-goals

- Tip, hóa đơn điện tử/VAT, thời hạn lưu dữ liệu (chờ kế toán/pháp lý/chủ dự án).
- O16 (tích điểm) và OP (CI, Playwright, đóng gói, retail) — có plan riêng
  [`ordering-o16-loyalty.md`](ordering-o16-loyalty.md), [`ordering-op-platform.md`](ordering-op-platform.md), chờ chốt tham số.
- Chạy nhiều instance (Redis/pub-sub), vùng giao theo bán kính, GHN, quote theo OTP.

## Current evidence (đọc code 2026-10-14)

- **Token bàn trong log:** route công khai `GET /tables/:token` (`routes/index.ts:54`, `controllers/table.ts:140-145`).
  Logger app (`src/middlewares/http-log`, `@tanngo11/log`) ghi `http_path = ctx.url`, chỉ bỏ query string. Các token khác
  đi qua header `X-Order-Token`; query token bị từ chối (`TOKEN_QUERY_KEYS`, `controllers/storefront.ts:39`).
- **Biến thể:** biến thể là `catalog-variant` con của món; địa chỉ = `sellableUid` (documentId món) + `variantUid`. Catalog API
  đã trả `variants[]`, `prepareOrder` + giỏ hàng + sửa đơn đã nhận `variantUid`. Thiếu: `domain/storefront/parse.ts:22-27,
  85-104` bỏ `variantUid` (nên `/quote`, `/orders`, draft nhân viên luôn lấy biến thể mặc định); `unitAmountOf` (adapter
  :592-614) lặng lẽ rơi về giá mặc định khi uid sai, không chặn biến thể `available: false`; snapshot dòng dùng `sku` của
  biến thể mặc định (`order.ts:1417`), khuyến mãi nhận `variantUid` mặc định (`order.ts:820`).
- **Thẻ tổng thanh toán:** `OrderDetailPage.tsx:474+` liệt kê payment, không có thẻ tổng. API đã trả
  `totals {total, paid, refunded, due}` (`admin-orders.ts:673-683`). Nhãn "Cần thu/Đã thu/Đã hoàn/Còn thiếu" có sẵn (`o3.ts`).
- **Bán thẻ tại quầy:** `CreateOrderPage.tsx:213-226` cố định `receiveMethod.kind: 'pickup'`, consent `'v1'` (:260).
  Draft API đã nhận `digital` (`recipientEmail`, `recipientName`, `message`, `physicalCodes`) và server đã kiểm quét (O9 review
  fixes). Mệnh giá thẻ là biến thể (`product-types/gift-card.ts:10-14`) → phụ thuộc bước biến thể.
- **Webhook:** `domain/webhooks/events.ts` có 12 event; nhóm `promotion`, `rating` đã khai báo + nhãn Admin nhưng không có
  spec. Giữ chỗ khuyến mãi: `promotion.ts:433` (trong transaction tạo đơn); đánh giá: `rating.ts:278` (`submitByToken`).
  Fanout tự đăng ký theo `PUBLIC_EVENT_TYPES` (`register.ts:329-338`).
- **`consent.policyVersion`:** chỉ ở config plugin (`config/index.ts:33`, mặc định `'v1'`), đọc ở `order.ts:1022`,
  `controllers/storefront.ts:178`, `storefront.ts:425`, `cart.ts:559,764`, `customer.ts:204`. Mẫu lưu runtime: `ordering-settings`
  (plugin store, zod, change-log) + màn `pages/Settings` tab chung.
- **Yêu cầu dữ liệu trễ hạn:** `deadlineHours` (mặc định 72) chỉ tô đỏ ở UI (`DataRequests/index.tsx:222-244`). Job
  `data-request-waiting` không cảnh báo. Mẫu cảnh báo mở/tự đóng: `jobs/table-session-autoclose.ts:59-90`. Danh sách mã cảnh báo
  ở Admin (`pages/Settings/index.tsx:43-57`) thiếu cả `notification-daily-limit`, `table-session-open`.

## Decisions and assumptions

- Decision: token bàn chuyển sang **`POST /tables/resolve` body `{ token }`**; bỏ `GET /tables/:token` (site chưa live, không giữ
  đường cũ — theo quyết định "không redirect trước go-live"). Từ chối token trong query như storefront. Link QR khách mở
  (`menuUrlTemplate`) vẫn mang token — đó là trang web, không phải API backend; web đọc rồi gọi POST.
- Decision: `variantUid` sai hoặc không thuộc món → `400 VALIDATION_ERROR` (`lines.N.variantUid`); biến thể hết →
  `SELLABLE_UNAVAILABLE` như món hết. Thiếu `variantUid` → biến thể mặc định (giữ hành vi cũ).
- Decision: snapshot dòng lưu `sku`, `variantUid`, tên biến thể của biến thể đã chọn; tiêu đề dòng = "Món · Biến thể" khi không
  phải mặc định.
- Decision: event `promotion.redeemed` phát lúc **giữ chỗ trong transaction tạo đơn** (đơn đã tồn tại, có `orderId`); đơn bị hủy
  không phát event ngược (subscriber nghe `order.transitioned`). Payload: `orderId`, `orderCode`, `promotionId`, `code` (mã đã
  nhập, không phải bí mật), `discountAmount`, `locationRef`.
- Decision: event `rating.created` khi khách gửi đánh giá lần đầu; **không** gửi `comment` (văn bản tự do, có thể chứa PII).
  Payload: `orderId`, `orderCode`, `ratingId`, `stars`, `tags`, `locationRef`. Sửa đánh giá không phát event.
- Decision: `consentPolicyVersion` lưu trong `ordering-settings` (plugin store); giá trị config là mặc định khi store trống. Đổi
  phiên bản ghi change-log. Mọi chỗ đọc đi qua một helper `effectivePolicyVersion()`.
- Decision: cảnh báo `data-request-overdue` (warning) mở theo từng yêu cầu `received|waiting` quá `deadlineHours`, tự đóng khi yêu
  cầu xong/bị từ chối. Chạy trong job `data-request-waiting` (đã có cron 35 phút). Người nhận: `ops.read`.
- Assumption: web đặt món (OW) chưa gọi `GET /tables/:token` ở production — đổi API không cần tương thích ngược.

## Invariants

- Không token bí mật nào nằm trong path hoặc query của API công khai.
- Giá dòng luôn là giá của biến thể đã lưu trên dòng; không bao giờ rơi về giá mặc định khi uid sai.
- Webhook không mang PII ngoài allowlist `fields` của spec.
- Đơn tạo từ Admin dùng đúng `policyVersion` hiện hành, không chuỗi cứng.

## Implementation steps

1. **Token bàn ra khỏi path**
   - Files: `routes/index.ts`, `controllers/table.ts` (`resolve` đọc body, từ chối query token), `openapi/operations.ts`,
     `scripts/ordering/dine-in.mjs`, `docs/ordering-api-contract.md` (mục dine-in), `uat-server.mjs` nếu gọi route cũ.
   - Verification: `dine-in.mjs` — POST token đúng 200, sai 404, token trong query 400, `GET /tables/<token>` 404/405; log
     request không chứa token (bắt logger trong script hoặc kiểm `ctx.url` ở middleware test).
2. **Chọn biến thể khi đặt**
   - Files: `domain/storefront/parse.ts` (+ `parse.test.ts`), `providers/ordering-catalog/adapter.ts` (`unitAmountOf` /
     resolver trả lỗi thay vì fallback), `services/order.ts` (kiểm biến thể trong `prepareOrder`; snapshot `sku`/tên; promotion
     line dùng `variantUid` đã chọn), `test-catalog` nếu cần biến thể giả.
   - Verification: unit parse; script mới hoặc mở rộng `catalog-api.mjs`/`create-order.mjs`: quote + create với biến thể không
     mặc định → giá + sku đúng; uid lạ → 400; biến thể hết → `SELLABLE_UNAVAILABLE`; cart vẫn pass (`cart.mjs`,
     `cart-checkout.mjs`); đỏ trên code cũ.
3. **Thẻ tổng thanh toán (S4)**
   - Files: `admin/src/pages/Orders/OrderDetailPage.tsx` (4 dòng Cần thu / Đã thu / Đã hoàn / Còn thiếu đầu khối Thanh toán + ghi
     chú "đang chờ hoàn" khi có refund pending), `translations/o3.ts` nếu thiếu nhãn.
   - Verification: `typecheck:admin`, `o3.test.ts` (chuỗi có trong translations), `strapi build`. Không UAT trình duyệt.
4. **Bán thẻ quà tặng tại quầy (G4)**
   - Files: `admin/src/pages/Orders/CreateOrderPage.tsx` (chọn cách nhận: Tự lấy / Thẻ quà tặng; với thẻ: email + tên người nhận,
     lời nhắn, danh sách quét mã — mỗi dòng một mã, đếm khớp tổng số thẻ; chọn mệnh giá = biến thể; chỉ tiền mặt; không trộn món
     ăn với thẻ), `translations/o9.ts`, đọc `policyVersion` từ `/ordering/settings` (bước 6).
   - Phụ thuộc: bước 2, bước 6.
   - Verification: `typecheck:admin`, `o3.test.ts`, `strapi build`; `gift-card-sale.mjs` đã phủ API (draft digital + scan).
5. **Webhook `promotion.redeemed`, `rating.created`**
   - Files: `domain/webhooks/events.ts` (2 spec + sample), `events.test.ts`, `services/order.ts` hoặc `promotion.ts` (enqueue
     trong transaction, `uniqueKey` `promotion.redeemed:<orderId>:<promotionId>`), `services/rating.ts` (enqueue khi tạo mới),
     `docs/ordering-integrations.md`, openapi nếu liệt kê event.
   - Verification: unit events; `review-webhook-fanout.mjs` hoặc script webhook O10: đơn có mã → 1 delivery `promotion.redeemed`
     có đủ field, không thừa; đánh giá → `rating.created` không có comment; sửa đánh giá không phát lần 2.
6. **`consent.policyVersion` trong Admin**
   - Files: `services/ordering-settings.ts` (field + `effectivePolicyVersion()`), 6 chỗ đọc ở trên, `pages/Settings/index.tsx`
     (ô văn bản, cảnh báo "khách phải đồng ý lại phiên bản mới"), translations, `CreateOrderPage.tsx`.
   - Verification: script settings (mở rộng `promotions-admin.mjs`/`admin-orders.mjs` hoặc script mới): đổi phiên bản →
     `/config` trả giá trị mới, đơn gửi phiên bản cũ bị từ chối, change-log có dòng; store trống → dùng config.
7. **Cảnh báo yêu cầu dữ liệu trễ hạn**
   - Files: `domain/alert-codes.ts`, `services/alert-rules.ts` (rule mặc định), `jobs/data-request-waiting.ts` (mở/đóng theo
     `dedupeKey data-request-overdue:<documentId>`), `admin/src/pages/Settings/index.tsx` (thêm 3 mã đang thiếu:
     `data-request-overdue`, `notification-daily-limit`, `table-session-open`), translations.
   - Verification: `data-rights.mjs`: yêu cầu lùi `requestedAt` quá hạn → chạy job → 1 alert; chạy lại không trùng; xong yêu cầu →
     alert resolve. `alerts-engine.mjs` pass.
8. **Tài liệu + gate**
   - Files: `docs/ordering-api-contract.md`, `docs/ordering-staff-guide.md` (bán thẻ tại quầy, đổi phiên bản đồng ý),
     `docs/STATUS.md`, Completion record của file này, `openapi.mjs --write`.
   - Verification (targeted gates): `lint`, `typecheck`, `typecheck:admin`, `vitest run src/plugins/ordering`,
     `build:ordering`, script của từng bước + bị ảnh hưởng (`dine-in`, `create-order`, `storefront`, `cart`, `cart-checkout`,
     `catalog-api`, `promotions`, `rating`, `data-rights`, `alerts-engine`, `audit-coverage`, `gift-card-sale`),
     `ORDERING_ENABLED=true pnpm exec strapi build`. DB test `salanca_ordering_gaps`. Mỗi lỗi có test đỏ trên code cũ.

Thứ tự: 1 → 2 → 6 → 3 → 4 → 5 → 7 → 8. Mỗi bước một commit.

## Data and rollback

- Không migration, không content type mới. `ordering-settings` thêm field tùy chọn (store JSON).
- Rollback: revert commit; settings field thừa bị bỏ qua.

## Risks

- Đổi route bàn phá web đặt món nếu OW đã gọi `GET /tables/:token` — kiểm repo web trước khi merge (chỉ đọc).
- Biến thể: dữ liệu catalog thật có món mà `variantUid` mặc định khác `sellable.variant` → kiểm `catalog-*.mjs`.
- Webhook mới làm subscriber cũ nhận event lạ chỉ khi họ chọn "tất cả" — ghi trong docs integrations.

## Ước lượng

~3–4 ngày: bước 1 (0,5), 2 (1), 3 (0,25), 4 (0,75), 5 (0,5), 6 (0,5), 7 (0,5), 8 (0,5).

## Completion record

- Chưa bắt đầu.
