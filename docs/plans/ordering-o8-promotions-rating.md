# O8 — Khuyến mãi và đánh giá đơn: kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt), AI thực hiện
Last updated: 2026-10-12
Related phase: [`phases/phase-ordering-8-promotions-rating.md`](../phases/phase-ordering-8-promotions-rating.md)

Đặc tả màn hình: [`ordering-o8-screens.md`](ordering-o8-screens.md) (K1–K4, R1–R2, reference mục U8). Mockup:
[`mockups/ordering-o8-promotions-rating.html`](mockups/ordering-o8-promotions-rating.html).

## Goal

Khuyến mãi (mã + tự động) tính ở server, chia xuống dòng, giới hạn lượt an toàn khi đặt song song; đánh giá
đơn bằng token đơn, báo quản lý khi xấu. Xem spec cho phạm vi.

## Non-goals

- Thẻ quà tặng (O9), tích điểm, giới thiệu bạn bè, mua X tặng Y, combo giá, đánh giá công khai/từng món.

## Current evidence

- `domain/pricing/pipeline.ts`: `PricingAdjustmentInput { kind: discount|fee|rounding, code, label,
  amount|percent, taxable, priority, sourceRef, ruleSnapshot }`; percent áp trên subtotal; mọi adjustment
  chia cho **tất cả** dòng (`allocation.ts`, largest remainder); `fulfillmentAmount` là số riêng, không có
  adjustment trên phí. Kết quả lưu `order-adjustment` + `adjustment-allocation`; dòng có `discountAmount`.
- Hoàn theo phân bổ: `domain/refund-amount.ts`, `services/line-cancel.ts`.
- `services/order.ts` `prepareOrder` (quote + create dùng chung), `createOrder` (idempotency, transaction);
  `domain/storefront/parse.ts` (input công khai); `controllers/storefront.ts` (`verifyCaptcha` cho
  `order-create`, `order-lookup`; quote không captcha); `controllers/storefront-guard.ts` (rate limit theo IP,
  429 `RATE_LIMITED`).
- `order-line.categoriesSnapshot` (JSON `[{ ref, title }]`), `sellableUid`, `variantUid` — đủ để xét điều kiện
  món/danh mục từ snapshot.
- Số điện thoại khách: `order.contactSnapshot.phone` (E.164, không mã hóa). Tra cứu đơn so `sha256` (storefront
  `lookup`).
- Token đơn: `X-Order-Token` (`storefront.aggregateByToken`), dùng cho xem/hủy/thanh toán.
- Alert O6: `services/alert.ts` (`open` với `locationRef`), `alert-rules.ts` (danh sách mã cố định
  `domain/alert-codes.ts`), người nhận theo action + scope (`alert-recipients.ts`).
- Outbox có `availableAt` (gửi trễ được). Notification `deliver` dedupe theo (event, template, người nhận).
- Báo cáo O6 `services/reports.ts` đọc sổ payment/refund + snapshot dòng.

## Decisions and assumptions

- Decision: khuyến mãi là module trong plugin (`services/promotion.ts`), xuất adjustment `kind: 'discount'`
  với `sourceRef = promotion:<id>`, `code = <mã hoặc promotion slug>`, `ruleSnapshot` = điều kiện + giá trị lúc áp.
- Decision: pipeline thêm `target: { kind: 'order' } | { kind: 'lines'; lineIndexes: number[] } | { kind: 'fulfillment' }`
  cho adjustment. Mặc định `order` (hành vi cũ).
- Decision: percent làm tròn **xuống** đồng; trần `maxDiscount`; không vượt subtotal của dòng mục tiêu (hoặc phí giao).
- Decision: chọn khuyến mãi: lấy mọi ứng viên đạt điều kiện → phương án A = tổng các khuyến mãi `stackable`
  (kể cả mã nếu mã stackable); phương án B = từng khuyến mãi không stackable đứng một mình → chọn phương án giảm
  nhiều nhất; hòa thì ưu tiên phương án có mã khách nhập, rồi `priority` cao, rồi id nhỏ. Mã không được chọn →
  `rejected: [{ code, reason: 'not-best' }]` (quote báo khách).
- Decision: lượt dùng giữ khi tạo đơn (`reserved`), thành `applied` khi đơn `completed`, `released` khi đơn về
  terminal `canceled`. `usedCount` = số redemption `reserved|applied`.
- Decision: định danh khách = `HMAC-SHA256(encryptionKey, phoneE164)` (không lưu số thô trong redemption;
  không dùng sha256 trần vì dò được từ danh bạ). "Đơn đầu tiên" = không có đơn nào khác (trừ `draft`,
  `canceled`) có cùng số điện thoại — truy vấn `contact_snapshot->>'phone'` có index biểu thức (migration).
- Decision (2026-10-12): hủy bớt món và sửa đơn giữ khuyến mãi đã áp; sửa đơn tính lại số giảm theo
  `ruleSnapshot` trên dòng còn lại nhưng không bỏ khuyến mãi khi dưới điều kiện (`warnings: ['promotion-kept']`).
- Decision: quote công khai nhận `promotionCode`; sau **3** lần mã sai/IP/10 phút thì quote có mã bắt buộc
  `captchaToken` (`CAPTCHA_FAILED` nếu thiếu); sau **20** lần → `RATE_LIMITED`.
- Decision: đánh giá: `stars` 1–5, `tags` từ danh sách cấu hình, `comment` ≤ 1000; mở khi đơn `completed`,
  trong `ratingWindowDays` (7); sửa trong `ratingEditHours` (24). Email mời trễ `ratingInviteDelayMinutes` (60).
- Decision (2026-10-12): `stars ≤ 2` mở alert `low-rating` (dedupe `low-rating:<orderId>`, `locationRef`,
  người nhận `report.read` trong scope).
- Decision: quyền mới `promotion.manage` (tạo/sửa/tắt/xem thống kê khuyến mãi), `rating.manage` (ẩn, ghi chú);
  xem đánh giá: `order.read` trong scope.
- Assumption: kế toán chấp nhận giảm giá là adjustment trước thuế (`taxable: true` → thuế tính trên giá sau
  giảm). Kiểm khi có quyết định VAT.

## Invariants

- Client chỉ gửi mã; số giảm do server tính. Quote và create cùng input, cùng giờ → cùng kết quả.
- `usedCount ≤ usageLimit` mọi lúc, kể cả nhiều process (khóa dòng promotion + mã theo thứ tự id).
- Σ allocation của một adjustment = số giảm; adjustment `fulfillment` không có allocation dòng.
- Tổng đơn = Σ dòng (sau giảm) + phí giao (sau giảm phí) + phí khác + thuế + làm tròn.
- Lỗi mã không tiết lộ mã có tồn tại không khi mã bị tắt/không có (`PROMOTION_INVALID` chung).
- Không log số điện thoại, nội dung đánh giá, mã đầy đủ (log 4 ký tự cuối).

## Data model

| Bảng | Field |
| --- | --- |
| `promotion` | `name` (JSON `{vi,en}`), `internalNote`, `kind` code\|auto, `discountType` percent\|amount\|free-delivery\|delivery-amount, `value` int (percent 1–100; amount VND), `maxDiscount` int?, `target` JSON `{ kind: 'order'\|'products'\|'categories', refs: string[] }`, `minSubtotal` int (0), `locationRefs` JSON string[] \| null (= mọi chi nhánh), `receiveKinds` JSON (`pickup`,`delivery`), `startsAt`, `endsAt?` (datetime), `weekdays` JSON (mon..sun, rỗng = mọi ngày), `timeRanges` JSON `[{start,end}]` (giờ chi nhánh), `firstOrderOnly` bool, `usageLimit` int?, `perCustomerLimit` int?, `stackable` bool, `priority` int, `active` bool, `usedCount` int, `createdBy` |
| `promotion-code` | `promotion` (manyToOne), `code` (chữ hoa A–Z 0–9 `-`, 4–32, unique), `usageLimit` int? (1 = dùng một lần), `usedCount` int, `active` bool, `batch` string? |
| `promotion-redemption` | `promotion`, `promotionCode?`, `order`, `customerKey` (HMAC hex), `discountAmount` int, `status` reserved\|applied\|released, `reservedAt`, `appliedAt?`, `releasedAt?`, `releaseReason?` |
| `order-rating` | `order` (oneToOne, unique), `locationRef`, `stars` 1–5, `tags` JSON string[], `comment` text ≤ 1000, `locale`, `status` visible\|hidden, `staffNote`, `staffNoteBy`, `ratedAt`, `updatedAt`, `editableUntil` |
| settings (`ordering-settings`) | `ratingTags: [{ code, label: {vi,en}, sentiment: positive\|negative }]`, `ratingWindowDays`, `ratingEditHours`, `ratingInviteDelayMinutes`, `ratingInviteEnabled` |
| retention config | `ratingCommentDays` (365) — job retention O6 xóa `comment` cũ |

Migration `0006-o8-promotions-rating.ts`: unique `upper(code)`; index redemption (promotion_id, customer_key,
status); index `order_rating(order_id)` unique; index biểu thức
`plugins_ordering_order ((contact_snapshot->>'phone'))`; `CHECK (used_count >= 0)`.

## API

Công khai (`/api/v1/ordering`):

| Method | Path | Body / query | Trả về / lỗi |
| --- | --- | --- | --- |
| POST | `/quote` (đã có) | thêm `promotionCode?`, `captchaToken?` | thêm `promotions: [{ code, label, amount, target }]`, `rejectedPromotions: [{ code, reason }]`, `totals.discountTotal` |
| POST | `/orders` (đã có) | thêm `promotionCode?` | như quote; lỗi `PROMOTION_*` |
| GET | `/orders/rating` | header `X-Order-Token` | `{ rateable, reason?, tags, rating? }` |
| POST | `/orders/rating` | `{ stars, tags?, comment? }` + token | `{ rating }`; `RATING_NOT_AVAILABLE` 409, `RATING_LOCKED` 409 |

Admin (`/ordering`):

| Method | Path | Quyền | Mô tả |
| --- | --- | --- | --- |
| GET | `/promotions?status=&kind=&q=&page=` | `promotion.manage` | danh sách + `usedCount`, `discountTotal` |
| POST | `/promotions` | `promotion.manage` | tạo; change-log `promotion.create` |
| GET/PUT | `/promotions/:id` | `promotion.manage` | xem/sửa (không sửa `kind`; sửa điều kiện chỉ áp đơn mới) |
| POST | `/promotions/:id/active` | `promotion.manage` | `{ active }` |
| GET | `/promotions/:id/codes?page=&q=` | `promotion.manage` | danh sách mã |
| POST | `/promotions/:id/codes` | `promotion.manage` | `{ code }` một mã hoặc `{ generate: { count ≤ 5000, prefix, length 8–16, usageLimit } }` |
| GET | `/promotions/:id/codes/export` | `promotion.manage` + `export` | CSV mã |
| POST | `/promotion-codes/:id/active` | `promotion.manage` | tắt/bật mã |
| GET | `/promotions/:id/redemptions?page=` | `promotion.manage` | đơn đã dùng (mã đơn, ngày, số giảm, trạng thái) |
| GET | `/ratings?branch=&stars=&from=&to=&hasComment=&status=&page=` | `order.read` | lọc theo scope |
| POST | `/ratings/:id/hide` · `/ratings/:id/note` | `rating.manage` | ẩn/hiện; ghi chú nội bộ; change-log |
| GET | `/reports/sales` (đã có) | `report.read` | thêm `summary.discount`, groupBy `promotion`; `ratings: { average, count, distribution }` |

Mã lỗi mới (`domain/errors.ts`, `translations/o8.ts`):

| Code | HTTP | `details.reason` |
| --- | --- | --- |
| `PROMOTION_INVALID` | 400 | — (không có, đã tắt, sai định dạng) |
| `PROMOTION_EXPIRED` | 400 | `not-started` \| `ended` |
| `PROMOTION_NOT_ELIGIBLE` | 400 | `min-subtotal` (`details.minSubtotal`, `missing`) \| `location` \| `receive-kind` \| `time` \| `products` \| `first-order` \| `per-customer` |
| `PROMOTION_EXHAUSTED` | 409 | `usage-limit` \| `code-used` |
| `RATING_NOT_AVAILABLE` | 409 | `not-completed` \| `window-closed` \| `disabled` |
| `RATING_LOCKED` | 409 | — |
| `PROMOTION_NOT_FOUND`, `RATING_NOT_FOUND` | 404 | — (Admin) |

## Implementation steps

1. **Pipeline nhận `target`**
   - Files: `domain/pricing/pipeline.ts`, `allocation.ts`, test.
   - Làm: `target.lines` → percent tính trên Σ base của các dòng đó, allocation chỉ chia vào các dòng đó (largest
     remainder, khóa theo index); `target.fulfillment` → giảm `fulfillmentAmount` (không âm), không allocation;
     kiểm `discount ≤ base mục tiêu`; output `PricedAdjustment.target`.
   - Verification: `pipeline.test.ts` ca mới; `pipeline.property.test.ts` thêm sinh ngẫu nhiên `target` giữ bất biến
     tổng và Σ allocation; `pnpm run test`.
2. **Dữ liệu + quyền**
   - Files: 4 content type, migration `0006`, `register.ts` (`promotion.manage`, `rating.manage`), `persisted-tables`,
     `types/generated`; `domain/promotions/schema.ts` (zod cho Admin input: percent 1–100, `endsAt > startsAt`,
     `timeRanges` hợp lệ, `target.refs` khác rỗng khi kind ≠ order, free-delivery bỏ `value`).
   - Verification: `scripts/ordering/schema.mjs`; unit test schema.
3. **Hàm thuần `evaluate`**
   - Files: `domain/promotions/evaluate.ts`:

     ```ts
     evaluate(input: {
       now: Date; timezone: string; locationRef: string; receiveKind: 'pickup'|'delivery';
       lines: Array<{ index: number; sellableUid: string; variantUid?: string; categoryRefs: string[]; base: number }>;
       fulfillmentAmount: number; subtotal: number;
       candidates: PromotionSnapshot[];          // đã lọc active + có thể dùng (lượt kiểm ở service)
       code?: string; customer: { isFirstOrder: boolean; usedByPromotion: Record<number, number> };
     }): { applied: AppliedPromotion[]; rejected: Array<{ code: string; reason: string }> }
     ```

     điều kiện theo thứ tự: thời gian → chi nhánh → cách nhận → ngày/khung giờ → đơn đầu → món/danh mục (có dòng
     khớp) → tạm tính tối thiểu (tính trên subtotal cả đơn) → lượt mỗi khách; tính số giảm; chọn phương án.
   - Verification: `evaluate.test.ts` ≥ 30 ca (mỗi điều kiện đạt/không, cộng dồn, hòa, trần, percent làm tròn,
     free-delivery khi phí 0 → không áp, khung giờ qua nửa đêm).
4. **Service + nối vào quote/create/hủy**
   - Files: `services/promotion.ts`:
     - `candidates(locationRef, now, code?)` (active, trong thời gian; mã chữ hoa);
     - `customerContext(phoneE164)` (HMAC; đếm redemption theo promotion; đơn đầu);
     - `reserveInTransaction(trx, orderId, applied, customerKey)`: khóa `promotion` rồi `promotion-code` theo id
       (`FOR UPDATE`), kiểm `usedCount < usageLimit`, mã `usedCount < usageLimit`, per-customer lại lần nữa trong
       khóa → insert redemption `reserved`, tăng `usedCount`; thiếu → `PROMOTION_EXHAUSTED`;
     - `releaseForOrder(trx, orderId, reason)`, `markApplied(orderId)` (khi `completed`).
     `services/order.ts` `prepareOrder`: sau khi có dòng + phí → `evaluate` → adjustment cho pipeline; quote trả
     `promotions`/`rejectedPromotions`; create gọi `reserveInTransaction` sau khi tạo đơn. Mã khách nhập không áp
     được ở create → lỗi `PROMOTION_*` (không tạo đơn); khuyến mãi tự động hết lượt ở create → bỏ qua, tính lại
     (tổng có thể khác quote; response trả tổng thật). `transition.ts` terminal `canceled` → release; `completed` →
     applied. `order-edit.ts` (O7): giữ adjustment, tính lại số giảm từ `ruleSnapshot` trên dòng còn lại.
     `parse.ts` + controller quote: đếm mã sai theo IP (bucket `promotion-code`), ngưỡng captcha/429.
   - Verification: `scripts/ordering/promotions.mjs` (mới): quote = create; mỗi kiểu giảm; món/danh mục; tự động +
     mã; per-customer (2 đơn cùng số → lần 2 `per-customer`); đơn đầu; hủy trả lượt; hủy bớt món hoàn đúng; sửa đơn
     giữ khuyến mãi; mã sai 3 lần → cần captcha, 20 lần → 429. `scripts/ordering/promotion-race.mjs` (mới, 2
     process + barrier như outbox): `usageLimit 1` → đúng một đơn có giảm.
5. **Admin khuyến mãi**
   - Files: `controllers/promotions.ts`, routes, `admin/src/pages/Promotions/` (K1 danh sách, K2 form, K3 mã, K4
     thống kê), menu con nhóm mới **Khuyến mãi** (ẩn khi không có quyền), `translations/o8.ts`; sinh mã bằng
     `crypto.randomInt` trên bảng chữ không nhầm (bỏ 0/O/1/I/L), kiểm trùng; xuất CSV dùng `domain/csv.ts` (O6).
   - Verification: script HTTP: thiếu quyền 403; sinh 500 mã không trùng; xuất CSV có BOM; tắt mã → quote
     `PROMOTION_INVALID`; sửa promotion không đổi đơn cũ (adjustment giữ `ruleSnapshot`).
6. **Báo cáo, CSV đơn**
   - Files: `services/reports.ts` (`summary.discount` = Σ adjustment discount của đơn bán theo businessDate;
     groupBy `promotion`), `order-export.ts` thêm cột "Khuyến mãi" (mã/tên + số giảm); Admin Reports thêm thẻ
     "Giảm giá" và nhóm theo khuyến mãi.
   - Verification: `scripts/ordering/reports.mjs` mở rộng: tổng giảm khớp Σ adjustment; CSV có cột mới.
7. **Đánh giá — dữ liệu, API công khai, email**
   - Files: `services/rating.ts` (`viewByToken`, `submit`, `listForStaff`, `hide`, `note`); routes công khai
     (`publicRoute`, rate limit bucket `rating`); outbox consumer: khi group → `completed` và `ratingInviteEnabled`
     và có email → enqueue `rating.invite` với `availableAt = now + delay` → template `customer.rating-invite`
     (VI/EN, link `orderLinkTemplate` + `#rate`); alert code `low-rating` trong `domain/alert-codes.ts` +
     `alert-rules` mặc định (`threshold: 2` = số sao tối đa, `recipients: ['report.read']`); retention xóa
     `comment` sau `ratingCommentDays`.
   - Verification: `scripts/ordering/rating.mjs` (mới): đủ ca trong spec; email mời gửi một lần (replay outbox);
     2 sao → alert mở với `locationRef`, người nhận đúng scope; 5 sao → không alert; sửa trong 24 giờ đổi
     số sao (3 → 1 mở alert); retention xóa comment cũ.
8. **Admin đánh giá + báo cáo**
   - Files: `admin/src/pages/Ratings/` (R1 danh sách, R2 chi tiết), nhóm **Vận hành**; chi tiết đơn S4 hiện đánh
     giá; Reports thêm thẻ "Đánh giá TB"; Settings (S9) khối "Đánh giá" (bật mời, thời hạn, nhãn).
   - Verification: script HTTP: ngoài scope 404; thiếu `rating.manage` không ẩn được (403); báo cáo TB đúng.
9. **Tài liệu, UAT seed, gate**
   - Files: `docs/ordering-api-contract.md` (`promotionCode`, `promotions`, lỗi, rating), staff guide (tạo khuyến
     mãi, sinh mã, xem đánh giá), `docs/security-baseline.md` (đoán mã, dữ liệu đánh giá), screens O8 "Đã đổi khi
     code", `uat-server.mjs` (khuyến mãi mẫu, đơn đã xong để đánh giá), `run-all.mjs`, STATUS, Completion record.
   - Verification: gate đầy đủ, `check:ordering` 2 lượt.

## Data and rollback

- Migration `0006`: bảng/index mới; index biểu thức trên `order` tạo `CONCURRENTLY` không được trong transaction —
  dùng `CREATE INDEX IF NOT EXISTS` thường (bảng đơn còn nhỏ lúc làm O8; ghi chú cho production lớn).
- Rollback: tắt khuyến mãi; ẩn trang bằng quyền. Adjustment đã áp giữ nguyên.

## Verification

- Automated: như O7 (lint, typecheck, test, `check:ordering` 2 lượt, `check:phase3` tắt/bật, smoke, build tắt/bật).
- Manual UAT: theo spec.
- Evidence: Completion record + `docs/STATUS.md`.

## Documentation impact

- Spec/screens/mockup O8, reference U8, API contract, staff guide, security baseline, STATUS, roadmap.

## Risks and blockers

- Chọn phương án cộng dồn sai làm lệch kỳ vọng của quán: hiện rõ trong quote (`rejectedPromotions` lý do
  `not-best`) và trong chi tiết đơn.
- Đổi pipeline chạm mọi đơn: property test phải chạy trước khi nối service.
- Quyết định VAT có thể đổi `taxable` của giảm giá.

Ước lượng thô: 2–3 tuần (1: 2 ngày; 2–4: 5–6 ngày; 5–6: 3–4 ngày; 7–8: 3–4 ngày; 9: 2 ngày).

## Completion record

Trạng thái: **implemented, targeted gates passed, chờ UAT giao diện** (2026-10-13). Nhánh `feat/ordering-o8`.

| Bước | Commit | Nội dung |
| --- | --- | --- |
| 1 | `80a4b95` | Pipeline nhận `target` (cả đơn / dòng / phí giao) + property test |
| 2 | `646a9cc` | 4 content type, migration `0008-o8-promotions-rating`, quyền `promotion.manage`, `rating.manage` |
| 3 | `03e1b17` | `evaluate` thuần, 31 ca |
| 4 | `590fcc6`, `0088b09`, `d759a61` | Áp khuyến mãi ở quote/create, giữ/trả lượt; review: bộ đếm đoán mã, loại khuyến mãi lấy từ dòng đã khóa, mã bị tắt giữa chừng báo lỗi; `promotion-race.mjs`, chặn đoán mã qua HTTP, đơn đầu tối đa 1 lượt/số dưới khóa |
| 6 | `60dc9c3` | Báo cáo `summary.discount`, nhóm `promotion`; cột "Khuyến mãi" trong CSV đơn |
| 7 | `6c4749e` | Đánh giá: API công khai, `completedAt`, email mời, alert `low-rating`, retention comment, báo cáo TB; **quote bỏ số điện thoại** |
| 5 | `d678e08` | API Admin khuyến mãi (K1–K4), sinh mã, CSV, redemptions, nhóm audit `promotion` |
| 5, 8 | `925a9cc`, `9dba30d` | Màn K1–K4, R1–R2, thêm vào S4/Báo cáo/Cài đặt/Tạo đơn hộ; sửa `Dialog.Title` (không có trong design-system 2.2.3) ở 3 trang cũ |
| 9 | commit chứa dòng này | OpenAPI (cả 4 route O7 còn thiếu), tài liệu, seed UAT |

Lệch kế hoạch:

- Migration tên `0008-o8-promotions-rating` (kế hoạch ghi `0006`).
- **Quote không nhận số điện thoại** (chủ dự án yêu cầu 2026-10-13): khuyến mãi "đơn đầu" và "mỗi khách N lần"
  trả trong `pendingPromotions` với giá chưa giảm, create mới kiểm theo số. Tổng thật chỉ có thể thấp hơn quote.
  `expectedCartHash` so với giá không phụ thuộc số điện thoại. Kế hoạch cũ cho quote đọc lịch sử số → ai cũng
  dò được một số đã từng đặt hay chưa.
- Đơn đầu chỉ 1 lượt/số kiểm dưới khóa dòng khuyến mãi (hai đơn "đầu tiên" cùng lúc không cùng được giảm).
- Thêm cột `order.completedAt` (hạn đánh giá tính từ đây); email mời gắn vào chuyển trạng thái đơn → `completed`
  (một lần mỗi đơn, không theo group).
- Thêm `GET /promotions/targets` (chi nhánh, món, danh mục từ catalog adapter) cho ô chọn ở K2 — người có
  `promotion.manage` không nhất thiết có quyền catalog.
- Nhóm audit mới `promotion`; `rating.hide`, `rating.note` thuộc nhóm `order`. Ghi chú nội bộ chỉ log "có/không".
- Alert `low-rating` mức `warning`, không theo đếm (`threshold` = số sao tối đa).
- Giỏ hàng (O11) chưa nhận `promotionCode`; thẻ quà tặng O9 chưa có. Cách ghi giảm giá trên hóa đơn điện tử chờ
  quyết định VAT (giảm giá hiện `taxable: true`, trước thuế).

Gate (có chọn lọc, `ORDERING_TEST_DATABASE=salanca_ordering_o8`, 2026-10-13):

- `pnpm run lint` sạch; `pnpm run typecheck` sạch; `pnpm exec vitest run src/plugins/ordering` 620/620.
- `pnpm run build:ordering` sạch; `ORDERING_ENABLED=true pnpm exec strapi build` OK.
- Script mới PASS: `promotions`, `promotion-race`, `promotion-money` (sửa đơn giữ và tính lại khuyến mãi,
  hủy món có giảm theo dòng hoàn đúng phần ròng, miễn phí giao rồi hủy món), `promotions-admin`, `rating`.
- Script bị ảnh hưởng PASS, chạy lại sau bước cuối (hook hoàn tất đơn): `order-edit`, `daily-stock`,
  `payment-refund`, `lookup-drafts`, `idempotency`, `courier`, `cash-closing`, `transition`, `admin-orders`,
  `delivery-assignment`, `sepay-manual`, `sepay-refund`, `sepay-expiry`, `sepay-match`, `special-hours`,
  `webhooks-out`, `check-admin-imports`, `check-dist-imports`. Chạy trong lúc làm (sau bước liên quan):
  `schema`, `create-order`, `storefront`, `reports`, `order-export`, `retention`, `email-templates`,
  `notifications`, `alerts-engine`, `audit-coverage`, `openapi --write`.
- Ghi chú: đánh giá ẩn vẫn tính vào điểm trung bình (R1, báo cáo). Đơn hoàn tất trước O8 không có
  `completedAt` nên không đánh giá được (chưa go-live, không cần bù).
- `tsc` riêng cho admin (scratch config): file O8 không có lỗi; 35 lỗi kiểu cũ ở các trang trước O8 còn nguyên.
- Chưa chạy: `check:ordering` ×2, `check:phase3`, smoke, Chrome UAT (chủ dự án tự UAT). UAT: `node
  scripts/ordering/uat-server.mjs` (cổng 1355, DB `salanca_ordering_o8_uat`) — có GIAM10, 20 mã TET, miễn phí
  giao từ 200.000đ, đơn đầu giảm 15.000đ, một đơn 2★ và một đơn hoàn tất chưa đánh giá.
