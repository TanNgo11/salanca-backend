# O12 — Tính năng nhà hàng: kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt), AI thực hiện
Last updated: 2026-10-12
Related phase: [`phases/phase-ordering-12-restaurant.md`](../phases/phase-ordering-12-restaurant.md)

Đặc tả màn hình: [`ordering-o12-screens.md`](ordering-o12-screens.md) (N1–N7, reference U12). Mockup:
[`mockups/ordering-o12-restaurant.html`](mockups/ordering-o12-restaurant.html).

## Goal

In phiếu, màn hình bếp, tạm dừng/quán đông, tự từ chối, phí dịch vụ/đóng gói, tip, dị ứng, đặt món tại bàn.

## Non-goals

- Driver ESC/POS, in LAN, sơ đồ bàn, ghép/tách bàn, chia hóa đơn, POS đầy đủ.

## Current evidence

- Pipeline (`domain/pricing/pipeline.ts`): adjustment `kind: 'fee'` (amount|percent, taxable, priority) đã chạy được;
  `fulfillmentAmount` riêng. O8 thêm `target`.
- Workflow (`domain/workflow/definitions.ts`): pickup-* và delivery-* theo `receiveMethod.kind` + `paymentTiming`;
  `transitionGroup` khóa group; terminal `canceled` qua `refundHeld` (hoàn mọi payment còn giữ).
- `services/order.ts` `prepareOrder`: kiểm `branch.onlineOrdering` cho storefront (`LOCATION_UNAVAILABLE`);
  `scheduling.resolveTiming` + `asapReadyAt` (`leadTimeMinutes`).
- Job sla-check (`jobs/sla-check.ts`) quét group `awaiting-acceptance` mỗi phút — mẫu cho auto-reject.
- SSE `GET /ordering/orders/stream` + inbox provider O3 (âm báo đơn mới) — dùng cho KDS.
- Chốt tiền O6 (`cash-closing.ts`) gom payment `cash` theo `actor_ref`; báo cáo O6.
- Catalog product: `metadata` JSON, `fulfillmentKinds`; custom field `localized-text`; Admin form món O2.
- Đơn tạo hộ O3 (`origin.kind = 'staff-draft'`), `cash-handover`.

## Decisions and assumptions

- Decision: in = trang Admin riêng `/plugins/ordering/print/:orderId?doc=kitchen|receipt&width=58|80` không có khung Admin
  (CSS `@page { size: 80mm auto; margin: 0 }`), gọi `window.print()` khi `autoprint=1`. Tự in: inbox provider O3 khi nhận
  đơn mở tab in ẩn (iframe) nếu chi nhánh bật `printing.autoKitchenTicket` và máy là "máy in quầy" (cờ lưu
  `localStorage` theo trình duyệt — chỉ là tiện ích máy, không phải dữ liệu).
- Decision: KDS đọc từ SSE + `GET /ordering/kitchen?branch=&station=`; trạng thái món = `order-line.preparedAt`
  (mới, nullable); trạm = `catalog-category.kitchenStation` (mới, string) kế thừa xuống món.
- Decision: tạm dừng lưu trên branch: `orderingPause: { pickup?: { until, reason }, delivery?: {...} }`,
  `busyMode: { extraMinutes, until }` — không qua `PUT /branches` (quyền `settings.manage`) mà qua route riêng quyền
  `order.process` (nhân viên ca cần bấm được); change-log.
- Decision: tự từ chối là job `auto-reject` (mỗi phút, khóa job), dùng `transitionGroup` → `rejected` với `reasonCode:
  'no-response'` + `refundHeld`; cấu hình `autoRejectAfterMinutes` (null = tắt) theo cách nhận; chỉ group
  `awaiting-acceptance`. Email khách dùng mẫu từ chối có lý do.
- Decision: phí = `branch.fees: [{ code, label {vi,en}, kind: 'service'|'packaging', amount?|percent?, receiveKinds,
  taxable, minSubtotal? }]` → adjustment `fee` (`sourceRef = fee:<code>`); phí % tính trên subtotal sau giảm giá món.
- Decision: tip = `order.tipAmount` (mới, bigint ≥ 0) + `tipPercent?`; tổng = … + tip; tip không vào base giảm giá/phí %;
  không chịu thuế (giả định, chờ kế toán); hoàn: hủy đơn hoàn cả tip; hủy bớt món không đổi tip. Cấu hình
  `tips: { enabled, presets: [5,10,15], allowCustom, receiveKinds }`. Chốt tiền: cột `tipAmount` theo người thu (đơn
  giao: người giao).
- Decision: dị ứng = `catalog-product.allergens` JSON string[] (mã từ danh mục cố định 14 nhóm theo EU FIC + `custom:<tên>`),
  `dietaryTags` JSON string[] (`vegetarian`, `vegan`, `spicy`, `sugar-free`, `gluten-free`, …); hiển thị VI/EN từ bảng mã.
- Decision: tại bàn = `receiveMethod.kind = 'dine-in'` `{ tableToken }` → server đổi thành `{ tableId, tableCode }`;
  workflow `dine-in-pay-later` (`awaiting-acceptance → preparing → served (success-pending) …`) và `dine-in-prepay`;
  `table-session` mở khi đơn đầu tiên của bàn được tạo, đóng khi quán bấm "Thanh toán & đóng bàn" (tạo payment
  cash/transfer cho phần còn nợ của từng đơn, chuyển group sang `completed`). Một bàn chỉ một phiên mở.
- Decision: quyền mới `kitchen.read` (KDS), `table.manage` (bàn, QR, đóng phiên); tạm dừng/quán đông dùng `order.process`.
- Owner decision required: tip có chịu thuế/ghi doanh thu không, và tip chuyển khoản thuộc ai (quán hay nhân viên) — chờ
  kế toán; code để cờ `tips.taxable=false` và báo cáo tách tip.
- Assumption: máy in nhiệt chạy driver Windows/Android nhận lệnh in trình duyệt (UAT với máy thật của quán).

## Invariants

- Tổng = Σ dòng sau giảm + phí (fee) + phí giao + thuế + tip + làm tròn; quote = create.
- Đơn chỉ bị tự từ chối khi vẫn `awaiting-acceptance` lúc khóa group (không từ chối đơn vừa được nhận).
- Phiếu bếp không có SĐT/địa chỉ đầy đủ; hóa đơn tạm che SĐT.
- Token QR bàn không đoán được (≥ 128 bit), xoay được; bàn tắt → QR vô hiệu.
- Một phiên bàn mở / bàn; đóng phiên chỉ khi mọi đơn của phiên đã trả hoặc đã hủy.

## Data model

| Bảng / field | Mô tả |
| --- | --- |
| `branch.orderingPause` JSON | `{ pickup?: { until, reason?, by }, delivery?: {...}, dineIn?: {...} }` |
| `branch.busyMode` JSON | `{ extraMinutes, until, by }` |
| `branch.fees` JSON | danh sách phí (xem Decisions) |
| `branch.tips` JSON | `{ enabled, presets, allowCustom, receiveKinds }` |
| `branch.printing` JSON | `{ header?, footer?, autoKitchenTicket, width: 58\|80 }` |
| settings theo cách nhận | `autoRejectAfterMinutes?` trong `pickup`/`delivery`/`dineIn` |
| `order.tipAmount` | bigint, default 0; `order.tipPercent?` |
| `order-line.preparedAt` | datetime, null |
| `catalog-category.kitchenStation` | string, null (kế thừa) |
| `catalog-product.allergens`, `dietaryTags` | JSON string[] |
| `dining-table` | `locationRef`, `code` (unique theo chi nhánh), `name`, `area?`, `seats?`, `qrTokenHash`, `active` |
| `table-session` | `table`, `locationRef`, `status` open\|closed, `openedAt`, `closedAt?`, `closedBy?`, `orders` (oneToMany order), `businessDate` |
| `order.tableSession` | relation manyToOne (nullable) |

Migration `0010-o12-restaurant.ts`: unique (location_ref, code) bàn; partial unique `table_session(table_id) WHERE status='open'`;
`order.tip_amount >= 0`. Workflow mới đăng ký trong registry.

## API

| Method | Path | Quyền | Mô tả |
| --- | --- | --- | --- |
| GET | `/ordering/print/orders/:id?doc=` | `order.read` | dữ liệu in (JSON) cho trang in |
| GET | `/ordering/kitchen?branch=&station=` | `kitchen.read` | đơn đang làm (lines + preparedAt) |
| POST | `/ordering/kitchen/lines/:lineId/prepared` | `kitchen.read` | `{ prepared: boolean }` |
| POST | `/ordering/branches/:code/pause` | `order.process` | `{ kind, minutes \| until \| 'end-of-day' \| null, reason? }` |
| POST | `/ordering/branches/:code/busy` | `order.process` | `{ extraMinutes \| null, minutes }` |
| PUT | `/ordering/branches/:code` (đã có) | `settings.manage` | thêm `fees`, `tips`, `printing`, `autoRejectAfterMinutes` |
| GET/POST/PUT | `/ordering/tables[/:id]` | `table.manage` | bàn; `POST /tables/:id/rotate-qr` → QR mới |
| GET | `/ordering/tables/:id/qr.svg` | `table.manage` | QR SVG (sinh trong plugin, không thêm dependency — encoder QR tối giản trong `domain/qr.ts` hoặc dùng thư viện đã có trong app nếu có; hỏi trước khi thêm) |
| GET | `/ordering/table-sessions?branch=&status=` | `table.manage` | phiên + tổng còn nợ |
| POST | `/ordering/table-sessions/:id/close` | `table.manage` + `payment.record-cash` | `{ method: 'cash'\|'transfer-at-counter', reference? }` |
| GET | `/api/v1/ordering/tables/:token` | public | `{ branch, table: { code, name }, menuUrl, status }` |
| GET | `/api/v1/ordering/config` (đã có) | public | thêm `pause`, `busy`, `tips`, `fees` (để web hiện) |
| GET | `/api/v1/ordering/catalog/products` (đã có) | public | thêm `allergens`, `dietaryTags`; query `excludeAllergens=`, `dietary=` |
| POST | `/api/v1/ordering/quote`, `/orders` (đã có) | public | `tip: { percent? \| amount? }`; `receiveMethod.kind = 'dine-in'` |

Lỗi mới: `LOCATION_PAUSED` 409 (`details.kind`, `resumeAt`), `TABLE_NOT_FOUND` 404, `TABLE_SESSION_OPEN_BALANCE` 409,
`TIP_INVALID` 400.

## Implementation steps

1. **Tạm dừng + quán đông**
   - Files: `domain/branch-settings.ts` (schema pause/busy), `services/branch.ts` (`pause`, `busy`), `prepareOrder`
     (kiểm pause → `LOCATION_PAUSED`; busy → cộng `extraMinutes` vào ASAP), `/config`, routes, Admin N3 (nút trên đầu
     trang Đơn hàng), change-log.
   - Verification: `scripts/ordering/pause.mjs`: quote khi dừng 409 kèm `resumeAt`; hết hạn tự mở (now cố định);
     busy cộng phút; nhân viên thiếu `order.process` → 403; ngoài scope → 404.
2. **Tự từ chối**
   - Files: `jobs/auto-reject.ts` (`ORDERING_JOBS`, mỗi phút; lấy group quá hạn; với mỗi group: khóa, kiểm còn
     `awaiting-acceptance`, `transitionGroup → rejected` + `refundHeld`), settings, lý do hệ thống `no-response` trong
     danh sách lý do từ chối (VI/EN).
   - Verification: `scripts/ordering/auto-reject.mjs`: đúng phút; đơn chuyển khoản → phiếu hoàn pending; nhận đơn trước
     hạn → không từ chối; 2 process (barrier) → một lần.
3. **Phí dịch vụ/đóng gói + tip**
   - Files: `domain/branch-settings.ts` (`fees`, `tips`), `prepareOrder` (fee adjustments; tip sau pipeline), order
     `tipAmount`, `refund`/`line-cancel` (tip giữ khi hủy bớt, hoàn khi hủy đơn), `cash-closing.ts` (cột tip theo người
     thu), `reports.ts` (tip theo ngày/người), CSV, mẫu email/hóa đơn.
   - Verification: `pipeline.test.ts` thêm fee %; `scripts/ordering/fees-tips.mjs`: quote = create; khuyến mãi O8 không
     giảm tip; hủy đơn hoàn cả tip; chốt tiền tách tip.
4. **Dị ứng/ăn kiêng**
   - Files: `domain/catalog/allergens.ts` (bảng mã + nhãn VI/EN), schema `catalog-product`, Admin form món O2 (khối
     "Dị ứng & ăn kiêng": checkbox), catalog public (field + filter).
   - Verification: `scripts/ordering/allergens.mjs`; `catalog-api.mjs` mở rộng.
5. **In phiếu**
   - Files: `services/print.ts` (dữ liệu in theo `doc`), route, `admin/src/pages/Print/` (layout không khung, CSS in),
     nút "In phiếu bếp"/"In hóa đơn" ở S4, cờ "Máy in quầy" + tự in trong inbox provider.
   - Verification: script HTTP: dữ liệu in đúng, phiếu bếp không có giá/SĐT; UAT máy in thật.
6. **Màn hình bếp**
   - Files: `catalog-category.kitchenStation`, `order-line.preparedAt`, `services/kitchen.ts`, routes, `admin/src/pages/
     Kitchen/` (toàn màn hình, SSE, âm báo, đếm thời gian, màu theo `slaMinutes`), quyền `kitchen.read`.
   - Verification: `scripts/ordering/kds.mjs`: lọc trạm; món xong idempotent; "Xong cả đơn" → `ready`; scope.
7. **Đặt món tại bàn**
   - Files: `dining-table`, `table-session`, `order.tableSession`, migration `0010`, workflow `dine-in-*`,
     `parse.ts` (`dine-in`), `prepareOrder` (token → bàn, mở/gắn phiên trong transaction với khóa `table` FOR UPDATE),
     `services/table.ts` (CRUD, xoay QR, đóng phiên: payment cho phần nợ từng đơn + transition `completed`), job
     `table-session-autoclose` (cuối ngày kinh doanh: phiên còn mở → alert `table-session-open`, không tự thu tiền),
     public `/tables/:token`, Admin N6–N7.
   - Verification: `scripts/ordering/dine-in.mjs`: token sai 404; 3 đơn một phiên; 2 đơn đầu tiên đồng thời cùng bàn →
     một phiên (khóa); đóng khi còn nợ → thu đủ rồi đóng; đóng phiên đã trả → không tạo payment; chốt tiền nhận tiền
     mặt của người đóng phiên; báo cáo có kênh `dine-in`.
8. **Tài liệu, UAT seed, gate**
   - Files: staff guide (in, KDS, tạm dừng, bàn), API contract, screens "Đã đổi khi code", `uat-server.mjs` (bàn, phí,
     tip, món có dị ứng), STATUS, Completion record.
   - Verification: gate đầy đủ, `check:ordering` 2 lượt.

## Data and rollback

- Migration `0010`; field mới đều có default. Rollback: tắt cờ từng tính năng; bàn tắt → QR vô hiệu.

## Verification

- Automated: lint, typecheck, test, `check:ordering` 2 lượt, `check:phase3` tắt/bật, smoke, build tắt/bật.
- Manual UAT: theo spec (máy in nhiệt thật, TV/tablet cho KDS, điện thoại quét QR).

## Documentation impact

- Spec/screens/mockup O12, reference U12, staff guide, API contract, STATUS, roadmap.

## Risks and blockers

- Mã QR SVG cần encoder: viết tối giản (chỉ chế độ byte, mức sửa lỗi M) có test với mã chuẩn, hoặc hỏi chủ dự án cho
  thêm thư viện nhỏ.
- In tự động phụ thuộc cấu hình Chrome kiosk của từng máy — tài liệu hướng dẫn trong staff guide.
- Tip/thuế chờ kế toán.

Ước lượng thô: 3–4 tuần (1–2: 3 ngày; 3: 3 ngày; 4: 1 ngày; 5: 2–3 ngày; 6: 3 ngày; 7: 5–6 ngày; 8: 2 ngày).

## Completion record

- Chưa bắt đầu.
