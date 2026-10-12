# O7 — Vận hành bổ sung: giờ đặc biệt, tồn theo ngày, sửa đơn, trang người giao

Status: Draft
Owner: tan_ngo (duyệt), AI thực hiện
Last updated: 2026-10-12
Related phase: chưa có spec — viết `docs/phases/phase-ordering-7-ops-extras.md` khi plan này được duyệt

## Goal

Bốn việc chủ dự án chọn sau review chức năng (2026-10-12):

1. Giờ mở cửa đặc biệt theo ngày (ví dụ mùng 2 Tết mở 10:00–14:00), không chỉ ngày nghỉ.
2. Giới hạn số phần bán mỗi ngày cho món/biến thể/tùy chọn (ví dụ "30 phần/ngày"), tự trừ khi đặt, tự
   trả lại khi hủy.
3. Sửa đơn sau khi đặt: thêm/bớt món, đổi giờ nhận, đổi địa chỉ giao — server tính lại tiền, thu thêm
   hoặc hoàn phần chênh.
4. Trang di động cho người giao: đơn của tôi, địa chỉ, gọi khách, "Đã giao / Đã thu tiền", "Giao thất bại".

## Non-goals

- Tồn kho theo nguyên liệu, nhập/xuất kho, định lượng (module kho riêng, contracts §5 `inventoryRef`).
- Khách tự sửa đơn trên web (O7 chỉ cho nhân viên sửa; khách gọi điện). Có thể mở ở OW sau.
- Định vị, bản đồ, theo dõi vị trí người giao; app native.
- Đổi chi nhánh hoặc đổi cách nhận (tự lấy ↔ giao) của đơn đã đặt — hủy và đặt lại.

## Current evidence

- Lịch: `domain/branch-settings.ts` `scheduleSchema` có `openingHours` (`24_7 | daily | weekly`) và
  `businessDayPolicy.holidayDates`; `domain/scheduling/slots.ts` đọc `holidayDates` (trả rỗng),
  `asapReadyAt` nối khoảng giờ qua nửa đêm; `services/pickup-scheduling.ts`; giao hàng dùng
  `deliverySettings.schedule` cùng schema.
- Tạm hết: `catalog-location-state` (`selling`, `outOfStockUntil`) theo product/variant/modifier ×
  chi nhánh; `catalog-variant`/`catalog-modifier` đã có `trackInventory`, `inventoryRef` (chưa dùng).
- Giữ chỗ: `hold` (`resourceRef`, `quantity`, `expiresAt`, `releasedAt`) + `services/hold.ts`, job
  `hold-expiry`; dùng cho sức chứa slot.
- Sửa đơn hiện có: `services/line-cancel.ts` (hủy bớt số lượng, hoàn theo phần đã phân bổ, preview bằng
  transaction rollback). Pricing: `domain/pricing/pipeline.ts` (line base, adjustment, allocation, thuế,
  làm tròn tiền mặt). Hoàn: `services/refund.ts` (tiền mặt `settled`, chuyển khoản `pending`). Link
  thanh toán bổ sung: `services/payment-link.ts` (O4).
- Giao hàng: `services/delivery-assignment.ts` (dispatch/markFailed/markDelivered/retry, assignee
  `admin:<id>`), `admin-orders.cashHandover` ghi tiền theo người giao, board "Đơn giao"
  `admin/src/pages/Deliveries/`. Người giao là admin user có `order.read`, `order.process`,
  `payment.record-cash` trong scope chi nhánh.

## Decisions and assumptions

- Decision: giờ đặc biệt là `businessDayPolicy.specialHours: [{ date, ranges | closed }]`, ưu tiên hơn
  `weekly/daily`; `holidayDates` giữ nguyên nghĩa (= đóng cả ngày) để không đổi dữ liệu cũ.
- Decision: tồn theo ngày tính theo **ngày kinh doanh của lúc nhận hàng** (đơn đặt trước cho thứ Bảy trừ
  tồn thứ Bảy), không theo ngày đặt.
- Decision: tồn trừ lúc tạo đơn (cùng transaction), trả lại khi đơn hủy/hết hạn/từ chối hoặc hủy bớt
  món; không trừ ở bước quote.
- Decision: sửa đơn là thao tác của nhân viên (quyền mới `order.edit`), một transaction: tính lại bằng
  pipeline, ghi timeline/change-log, giữ snapshot cũ trong payload timeline.
- Owner decision required — **trang người giao**, chọn trước bước 4:
  - (A, đề xuất) trang riêng trong plugin, chạy trong Strapi Admin nhưng bố cục toàn màn hình cho
    điện thoại (route `/plugins/ordering/courier`), đăng nhập admin như hiện tại. Ít rủi ro bảo mật,
    vẫn tải bundle admin lần đầu.
  - (B) trang web nhẹ riêng, đăng nhập bằng link ký (magic link) gửi cho người giao theo từng ca. Nhẹ
    hơn, nhưng thêm một cơ chế xác thực mới cần review bảo mật.
- Owner decision required — **đơn đã chuyển khoản mà sửa làm tăng tiền**: (đề xuất) chuyển đơn sang
  chờ thanh toán phần chênh bằng link thanh toán O4, không chặn bếp; hoặc chỉ cho tăng khi trả tiền mặt
  lúc nhận.
- Assumption: sửa đơn chỉ cho phép trước `out-for-delivery` (giao) / trước `ready` (tự lấy). Kiểm với
  chủ dự án ở UAT.

## Invariants

- Tiền luôn tính ở server qua pipeline; tổng đơn = Σ dòng + adjustment + phí + thuế, khớp sổ.
- Không bán vượt giới hạn ngày khi hai đơn đặt cùng lúc (khóa/điều kiện trong SQL, không đọc rồi ghi).
- Sửa đơn không làm mất lịch sử: dòng bị bớt giữ `canceledQuantity`, dòng mới là dòng mới.
- Người giao chỉ thấy và thao tác đơn được gán cho chính họ, trong scope chi nhánh.
- Không log tên, số điện thoại, địa chỉ khách.

## Implementation steps

1. **Giờ đặc biệt theo ngày**
   - Files: `domain/branch-settings.ts` (`specialHours`, tối đa 366 dòng, ngày không trùng),
     `domain/scheduling/slots.ts` (khoảng giờ của một ngày = special → holiday → weekly/daily;
     `asapReadyAt` dùng cùng hàm), tab Tự lấy/Giao trong màn Chi nhánh (S7) thêm bảng "Ngày đặc biệt".
   - Verification: unit test slots (ngày đặc biệt rút ngắn, mở thêm ngày thường đóng, qua nửa đêm, DST
     không áp dụng ở VN nhưng giữ test timezone); script `branches.mjs` lưu/đọc; quote ASAP ngoài giờ
     đặc biệt trả `ASAP_UNAVAILABLE`.
2. **Tồn theo ngày — dữ liệu và khóa**
   - Files: content type mới `catalog-daily-limit` (entityType, entityDocumentId, locationRef,
     `dailyLimit`), `catalog-daily-usage` (entity, location, businessDate, `reserved`) + unique index
     (migration `0005-o7-*`); `services/daily-stock.ts`: `reserve(lines, ctx)` bằng
     `INSERT … ON CONFLICT DO UPDATE SET reserved = reserved + n WHERE reserved + n <= limit`,
     `release(order|line)`.
   - Verification: script `daily-stock.mjs`: 2 đơn song song tranh phần cuối → một thắng
     (`ITEM_SOLD_OUT` 409); hủy đơn trả lại; hủy bớt món trả đúng số; sang ngày mới đủ lại.
3. **Tồn theo ngày — nối vào đặt đơn và admin**
   - Files: `services/order.ts`/`storefront.ts` (reserve trong transaction tạo đơn; quote/catalog trả
     `remainingToday` để web hiện "còn 3 phần"), `transition` (hủy/hết hạn/từ chối → release),
     `line-cancel.ts`, màn Món (O2) thêm field "Giới hạn mỗi ngày" theo chi nhánh, trang tạm hết hiện
     số còn lại. Hết phần thì món hiện như tạm hết tới hết ngày.
   - Verification: script đặt đơn tới 0 → API catalog báo hết; `check:ordering`.
4. **Sửa đơn (nhân viên)**
   - Files: `services/order-edit.ts`: `preview(orderId, changes)` (transaction rollback như
     `lineCancelPreview`) và `apply(...)`; changes = `{ addLines?, removeQuantities?, slot?, address? }`;
     tính lại bằng pipeline; đổi slot đi qua capacity hold; đổi địa chỉ gọi lại quote vùng giao (ngoài
     vùng → `DELIVERY_UNAVAILABLE`); tồn theo ngày reserve/release phần chênh; chênh âm → refund
     (tiền mặt `settled`, chuyển khoản `pending`); chênh dương → theo quyết định ở trên. Route
     `POST /orders/:id/edit/preview`, `POST /orders/:id/edit` (quyền `order.edit`), timeline
     `order.edited` (before/after đã che PII), change-log, email khách "Đơn đã được cập nhật".
   - Admin: nút "Sửa đơn" trong chi tiết đơn, hộp thoại thêm món (tìm món như tạo đơn hộ O3), đổi giờ,
     đổi địa chỉ; hiện tổng mới và số thu thêm/hoàn trước khi bấm.
   - Verification: script `order-edit.mjs`: thêm món đơn tiền mặt; bớt món đơn chuyển khoản → phiếu
     hoàn `pending`; đổi giờ sang slot đầy → lỗi; đổi địa chỉ ra vùng phí khác → phí đổi; sửa sau
     `ready` bị từ chối; hai nhân viên sửa cùng lúc → một thắng (khóa group).
5. **Trang người giao trên điện thoại** (sau khi chủ dự án chọn A/B)
   - Files (A): `admin/src/pages/Courier/` bố cục một cột, chữ lớn; API `GET /courier/deliveries`
     (đơn gán cho tôi, hôm nay, theo trạng thái), dùng lại `transition`/`cash-handover`/`markFailed`.
     Nút "Gọi khách" (`tel:`), "Mở bản đồ" (link Google Maps theo địa chỉ text, không định vị), số tiền
     cần thu. Quyền: chỉ cần `order.process` + `payment.record-cash`; server lọc `assigneeRef = tôi`.
   - Verification: script `courier.mjs`: người giao A không thấy/không thao tác đơn của B (404); UAT
     trên điện thoại thật (Chrome Android, Safari iOS) ở khổ 360px.
6. **Tài liệu và UAT**
   - Files: `docs/ordering-staff-guide.md` (ngày đặc biệt, giới hạn mỗi ngày, sửa đơn, trang người giao),
     `docs/ordering-api-contract.md` (`remainingToday`, lỗi `ITEM_SOLD_OUT`), screens `ordering-o7-screens.md`
     + mockup trước khi code UI (theo quy ước O3–O6).

## Data and rollback

- Migration: `0005-o7-*` tạo unique index cho daily usage; content type mới, không đổi cột cũ.
  `specialHours` có default `[]` nên dữ liệu chi nhánh cũ đọc được.
- Compatibility: đơn cũ không có reserve nên release bỏ qua khi không có usage.
- Rollback: tắt giới hạn bằng cách xóa `dailyLimit`; sửa đơn ẩn bằng cách không cấp `order.edit`.

## Verification

- Automated: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run check:ordering` (2 lượt),
  `check:phase3` tắt/bật, smoke pickup/sepay/delivery, `strapi build` tắt/bật.
- Manual UAT: đặt đơn vào ngày đặc biệt; bán hết món giới hạn; sửa một đơn mỗi loại; người giao làm
  trọn một chuyến trên điện thoại.

## Documentation impact

- Spec `phase-ordering-7-ops-extras.md`, screens + mockup O7, staff guide, API contract, `docs/STATUS.md`,
  roadmap.

## Risks and blockers

- Sửa đơn đã chuyển khoản là phần rủi ro nhất về tiền — chờ quyết định ở trên trước bước 4.
- Trang người giao (B) cần review bảo mật riêng.
- Tồn theo ngày với đơn đặt trước nhiều ngày: cần UAT kỹ ngày kinh doanh qua nửa đêm.

Ước lượng thô: 2–3 tuần (bước 1: 2 ngày; 2–3: 4 ngày; 4: 5–6 ngày; 5: 3 ngày; 6: 2 ngày).

## Completion record

- Chưa bắt đầu.
