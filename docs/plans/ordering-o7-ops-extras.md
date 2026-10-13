# O7 — Vận hành bổ sung: kế hoạch thực hiện

Status: Implemented (2026-10-13), chưa push
Owner: tan_ngo (duyệt), AI thực hiện
Last updated: 2026-10-13
Related phase: [`phases/phase-ordering-7-ops-extras.md`](../phases/phase-ordering-7-ops-extras.md)

Đặc tả màn hình: [`ordering-o7-screens.md`](ordering-o7-screens.md) (E1–E4, reference mục U7). Mockup:
[`mockups/ordering-o7-ops-extras.html`](mockups/ordering-o7-ops-extras.html). Mọi màn UI làm theo hai file đó.

## Goal

Giờ đặc biệt theo ngày, giới hạn số phần mỗi ngày, nhân viên sửa đơn, trang di động cho người giao —
xem spec. Plan này chốt dữ liệu, API, thuật toán, thứ tự làm và test.

## Non-goals

- Kho nguyên liệu, định lượng; khách tự sửa đơn; đổi chi nhánh/cách nhận; định vị; app native.
- Sửa đơn nháp (draft O3 đã có luồng riêng) và đơn đã đóng.

## Current evidence

- `domain/branch-settings.ts`: `scheduleSchema.businessDayPolicy = { cutoffLocalTime, holidayDates }`,
  `openingHours { mode: 24_7|daily|weekly, daily[], weekly{mon..sun} }`, `timeRange` cho phép qua nửa đêm;
  `pickupSettingsSchema` và `deliverySettingsSchema` mỗi cái có `schedule` riêng. Object lồng dùng
  `.prefault({})`.
- `domain/scheduling/slots.ts`: `rangesForDate(settings, date)` là nơi duy nhất đọc `holidayDates` và giờ
  mở cửa; `listSlots`, `checkSlot`, `isOpenAt`, `asapReadyAt` (nối hôm qua → ngày mai) đều đi qua nó.
- `catalog-location-state` (tạm hết) theo `entityType product|variant|modifier` × `locationRef`; service
  `catalog-availability.ts` (`list`, `toggle`, quyền `catalog.toggle-availability`, change-log).
- `catalog-variant`/`catalog-modifier` có `trackInventory`, `inventoryRef` (chưa dùng).
- `services/order.ts`: `prepareOrder` (dùng chung quote/create, chạy trong transaction create),
  `createOrder` (idempotency, consent, phone, address), `recomputeProjection`.
- `services/line-cancel.ts` `cancelLineQuantity` + preview bằng transaction rollback
  (`admin-orders.lineCancelPreview`); `services/refund.ts` (`createRefundInTransaction`; tiền mặt
  `settled`, chuyển khoản `pending`); `services/payment-link.ts` (`issue`, `summary`, hạn link).
- `services/pickup-scheduling.ts` `reserveInTransaction` (hold sức chứa slot, `slotResourceRef`);
  `services/hold.ts` `releaseForGroup`.
- Giao: `services/delivery-assignment.ts` (`dispatch`, `markDelivered`, `markFailed`, `retry`,
  `assigneeCtxFor`), `admin-orders.cashHandover` (payment theo người giao), `admin-orders.list` filter
  `assignee=mine`. Provider `self-delivery` (`validate`, `calculatePrice`), `requireDeliveryAddress`.
- Hủy: `transition.cancelOrder`, `admin-orders.cancel`, `refundHeld` (O5 sửa sau review); từ chối/hết hạn
  qua `transitionGroup`; job `payment-expiry`.
- Số điện thoại khách lưu E.164 trong `order.contactSnapshot.phone`.

## Decisions and assumptions

- Decision: `specialHours` nằm trong `schedule.businessDayPolicy` của **từng** cách nhận (tự lấy, giao) —
  cùng chỗ với `holidayDates`. UI có nút "Áp dụng cho cả giao tận nơi".
- Decision: thứ tự ưu tiên trong một ngày: `specialHours[date]` → `holidayDates` → `openingHours`.
- Decision: giới hạn ngày tính theo ngày kinh doanh của **thời điểm nhận**: ASAP = `order.businessDate`;
  hẹn giờ = `businessDate(slot.startsAt, timezone, cutoff)`.
- Decision: trừ giới hạn khi tạo đơn (kể cả đơn chờ thanh toán); trả lại khi group về terminal `canceled`
  (hủy, từ chối, hết hạn) hoặc hủy bớt/sửa bớt món. Đơn hoàn tất không trả lại.
- Decision: món nháp (draft O3) không trừ cho tới khi `confirmDraft`.
- Decision: sửa đơn cho phép khi group ở `awaiting-acceptance` hoặc `preparing`; đơn giao thêm `ready`.
  Không cho ở `awaiting-payment` (khách chưa trả; hủy và tạo lại).
- Decision: dòng cũ giữ giá lúc đặt; dòng thêm lấy giá hiện hành của catalog lúc sửa.
- Decision (chủ dự án 2026-10-12): đơn đã trả trước mà sửa tăng tiền → phần chênh trả qua link thanh toán
  O4, group không đổi trạng thái; đơn trả khi nhận chỉ tăng số cần thu.
- Decision (chủ dự án 2026-10-12): trang người giao là trang Admin bố cục điện thoại (phương án A).
- Decision: chống sửa đè bằng `order.editRevision` (integer, tăng mỗi lần sửa); client gửi revision đã xem.
- Assumption: Strapi Admin dùng được trên điện thoại 360px sau khi đăng nhập. Kiểm ở UAT; nếu không đạt thì
  ghi rủi ro và đề xuất trang nhẹ riêng (ngoài O7).

## Invariants

- Tổng đơn = Σ dòng còn hiệu lực + adjustment + phí + thuế; khớp sau mỗi lần sửa (`TOTALS_MISMATCH` nếu lệch).
- `reserved` của một (món, chi nhánh, ngày) không vượt `dailyLimit`, kể cả khi nhiều process tạo đơn song song.
- Σ `catalog-daily-reservation.quantity - releasedQuantity` của một ngày = `catalog-daily-usage.reserved`.
- Sửa đơn không xóa dòng: bớt = tăng `canceledQuantity`; thêm = dòng mới `addedInRevision = n`.
- Người giao chỉ thao tác đơn có `assigneeRef` = chính họ (hoặc nhân viên có quyền xử lý đơn trong scope).
- Không log tên/số điện thoại/địa chỉ; timeline sửa đơn che PII như timeline hiện có.

## Data model

| Bảng / field | Mô tả |
| --- | --- |
| `businessDayPolicy.specialHours[]` (JSON trên branch) | `{ date: YYYY-MM-DD, closed: boolean, ranges: TimeRange[] (0–6), note?: string ≤ 100 }`; tối đa 366 dòng; `closed=true` ⇔ `ranges=[]`; ngày không trùng |
| `catalog-daily-limit` (mới) | `entityType` product\|variant\|modifier, `entityDocumentId`, `locationRef`, `dailyLimit` int ≥ 0, `updatedBy`; unique (entityType, entityDocumentId, locationRef) |
| `catalog-daily-usage` (mới) | `entityType`, `entityDocumentId`, `locationRef`, `businessDate` (date), `reserved` int ≥ 0; unique (entityType, entityDocumentId, locationRef, businessDate) |
| `catalog-daily-reservation` (mới) | `order`, `line`, `entityType`, `entityDocumentId`, `locationRef`, `businessDate`, `quantity`, `releasedQuantity`; index (order), (line) |
| `order.editRevision` (mới) | integer, default 0 |
| `order-line.addedInRevision` (mới) | integer, null = có từ lúc đặt |

Migration `0005-o7-ops-extras.ts`: 3 unique index trên, `CHECK (reserved >= 0)`,
`CHECK (released_quantity <= quantity)`. Cập nhật `persisted-tables.ts`, sinh lại
`types/generated/contentTypes.d.ts` (`ORDERING_ENABLED=true`).

## API

| Method | Path | Quyền | Body / query | Trả về |
| --- | --- | --- | --- | --- |
| PUT | `/ordering/branches/:code` (đã có) | `settings.manage` | thêm `specialHours` trong `fulfillment.pickup|delivery.schedule.businessDayPolicy` | branch |
| GET | `/api/v1/ordering/config?branch=` (đã có) | public | — | thêm `specialHours: [{ date, closed, ranges, note }]` trong 14 ngày tới, theo từng cách nhận |
| GET | `/ordering/availability?branch=` (đã có) | `catalog.toggle-availability` | — | mỗi món/biến thể/tùy chọn thêm `dailyLimit`, `reservedToday`, `remainingToday` |
| PUT | `/ordering/availability/daily-limit` | `catalog.toggle-availability` | `{ locationRef, entityType, entityDocumentId, dailyLimit: number \| null }` | dòng sau khi lưu; change-log `catalog.daily-limit` |
| GET | `/api/v1/ordering/catalog/products?branch=&date=` (đã có) | public | `date` tùy chọn (ngày nhận) | thêm `dailyLimit: { remaining, date }` khi có giới hạn; `available=false`, `unavailableReason: 'sold-out-today'` khi hết |
| POST | `/api/v1/ordering/quote`, `/orders` (đã có) | public | — | lỗi `ITEM_SOLD_OUT` 409 `details { entityType, sellableUid, variantUid?, modifierUid?, remaining, businessDate }` |
| POST | `/ordering/orders/:id/edit/preview` | `order.edit` | `EditInput` | `EditPreview` (không ghi) |
| POST | `/ordering/orders/:id/edit` | `order.edit` | `EditInput` | `{ preview: EditPreview, detail }` |
| GET | `/ordering/courier/deliveries?view=active\|done` | `order.process` | — | đơn gán cho tôi trong ngày kinh doanh hôm nay của từng chi nhánh |

`EditInput`:

```ts
type EditInput = {
  revision: number;                       // order.editRevision client đã xem
  reason: string;                         // 1–500 ký tự, bắt buộc (vào timeline/change-log)
  add?: Array<{ sellableUid: string; variantUid?: string; options?: SelectedOption[]; quantity: number; note?: string }>;
  reduce?: Array<{ lineId: number; quantity: number }>;   // số lượng bớt
  timing?: { kind: 'asap' } | { kind: 'scheduled'; startsAt: string };
  address?: DeliveryAddressInput;          // chỉ đơn giao; như storefront
  notifyCustomer?: boolean;                // mặc định true
};
type EditPreview = {
  revision: number;                        // revision mới nếu áp
  lines: Array<{ lineId?: number; title: string; quantityBefore: number; quantityAfter: number; lineTotalAfter: number; added: boolean }>;
  totals: { before: Totals; after: Totals };
  fulfillmentAmount: { before: number; after: number };
  timing?: { before: string | null; after: string | null };
  money: { paid: number; dueAfter: number; refundCash: number; refundTransferPending: number; extraDue: number; paymentLink: boolean };
  warnings: string[];                      // ví dụ 'below-min-order', 'promotion-kept'
};
```

Mã lỗi mới (`domain/errors.ts` + `error.<CODE>` VI/EN trong `translations/o7.ts`):

| Code | HTTP | Khi |
| --- | --- | --- |
| `ITEM_SOLD_OUT` | 409 | hết giới hạn ngày (quote, create, sửa đơn thêm món) |
| `ORDER_NOT_EDITABLE` | 409 | trạng thái không cho sửa; `details.status` |
| `ORDER_CHANGED` | 409 | `revision` khác `order.editRevision` |
| `EDIT_EMPTY` | 400 | không có thay đổi nào |

## Implementation steps

1. **Giờ đặc biệt — domain**
   - Files: `domain/branch-settings.ts` (`specialHoursSchema`, refine: ngày duy nhất, `closed` ⇔ không có
     khoảng, khoảng không chồng nhau trong một ngày); `domain/scheduling/slots.ts` (`rangesForDate`:
     special → holiday → openingHours; export `dayKind(settings, date): 'special'|'holiday'|'regular'`).
   - Verification: `slots.test.ts` thêm: (a) ngày thường 07–22 có special 10–14 → slot chỉ 10–14;
     (b) weekly chủ nhật đóng, special chủ nhật 09–12 → có slot; (c) special `closed` → không slot, ASAP
     `ASAP_UNAVAILABLE`; (d) special hôm trước 22:00–02:00 → `asapReadyAt` lúc 01:00 hôm sau mở; (e) cùng
     ngày trong `holidayDates` và `specialHours` → special thắng; `branch-settings.test.ts` trùng ngày lỗi.
     `pnpm run test`.
2. **Giờ đặc biệt — API và Admin**
   - Files: `services/storefront.ts` `config` (lọc 14 ngày tới theo timezone chi nhánh);
     `admin/src/pages/Branches/` khối "Ngày đặc biệt" trong tab Tự lấy và tab Giao (E1);
     `translations/o7.ts`.
   - Verification: `scripts/ordering/branches.mjs` thêm lưu/đọc special, lỗi trùng ngày 400;
     `scripts/ordering/special-hours.mjs` (mới): quote ASAP/scheduled trong và ngoài giờ đặc biệt;
     `/config` trả đúng 14 ngày.
3. **Giới hạn ngày — dữ liệu và service**
   - Files: 3 content type mới, migration `0005`, `services/daily-stock.ts`:
     - `limitsFor(locationRef, refs[])` → Map;
     - `reserveInTransaction(trx, { orderId, locationRef, businessDate, items: [{ lineId, entityType, entityDocumentId, quantity }] })`:
       gộp theo entity, sắp theo khóa (tránh deadlock), mỗi entity chạy

       ```sql
       INSERT INTO plugins_ordering_catalog_daily_usage (entity_type, entity_document_id, location_ref, business_date, reserved, …)
       SELECT ?, ?, ?, ?, ?, … WHERE ? <= ?            -- quantity <= limit
       ON CONFLICT (entity_type, entity_document_id, location_ref, business_date)
       DO UPDATE SET reserved = plugins_ordering_catalog_daily_usage.reserved + EXCLUDED.reserved
       WHERE plugins_ordering_catalog_daily_usage.reserved + EXCLUDED.reserved <= ?
       RETURNING reserved
       ```

       không có dòng trả về → `ITEM_SOLD_OUT` (tính `remaining` để báo); ghi `catalog-daily-reservation`;
     - `releaseForOrder(trx, orderId, reason)`, `releaseForLine(trx, lineId, quantity)` → giảm `reserved`
       (không dưới 0), tăng `releasedQuantity`; idempotent (chỉ trả phần chưa trả);
     - `remaining(locationRef, businessDate, refs[])`.
   - Verification: `scripts/ordering/daily-stock.mjs` (mới): giới hạn 3, 4 lần reserve song song
     (`Promise.all` 2 process con như outbox test, có barrier) → đúng 3 thành công; release 2 lần chỉ trả
     một lần; `reserved` không âm.
4. **Giới hạn ngày — nối vào đặt đơn, hủy, catalog, Admin**
   - Files: `services/order.ts` (`prepareOrder` gom entity của dòng: product + variant + từng modifier đã
     chọn có giới hạn; `createOrder` gọi `reserveInTransaction` sau khi có line id; quote chỉ kiểm
     `remaining`); `transition.ts` (vào terminal `canceled` → `releaseForOrder`); `line-cancel.ts`
     (`releaseForLine`); `services/catalog-*` public output (`dailyLimit.remaining`); `admin-orders`
     không đổi; trang Tạm hết (E2) thêm cột giới hạn/còn lại + sửa giới hạn.
   - Verification: `daily-stock.mjs` mở rộng: đặt tới hết → catalog `sold-out-today`; quote báo
     `ITEM_SOLD_OUT`; hủy/từ chối/hết hạn (job `payment-expiry`) trả lại; hủy bớt 1 phần trả 1; đơn hẹn
     thứ Bảy trừ ngày thứ Bảy; đơn 03:59 trừ hôm qua, 04:00 hôm nay; thiếu quyền sửa giới hạn → 403,
     ngoài scope → 404. `pnpm run check:ordering`.
5. **Sửa đơn — service**
   - Files: `services/order-edit.ts`:
     1. lock group (`repo.lockGroup`) theo thứ tự id; load aggregate; kiểm scope (404), trạng thái
        (`ORDER_NOT_EDITABLE`), `revision` (`ORDER_CHANGED`), có thay đổi (`EDIT_EMPTY`);
     2. dựng "đơn sau sửa": dòng cũ với `quantity - canceledQuantity - reduce`, giữ snapshot giá; dòng
        thêm qua catalog adapter + product type như `prepareOrder` (giá hiện hành, tùy chọn hợp lệ, tạm hết,
        giới hạn ngày); timing/address mới nếu có;
     3. fulfillment: giao → `self-delivery.validate` + `calculatePrice` với subtotal mới (bậc phí đổi theo
        subtotal) và địa chỉ mới; tự lấy → phí 0; timing → `scheduling.resolveTiming` + release hold cũ +
        `reserveInTransaction` slot mới;
     4. pricing: chạy `domain/pricing/pipeline.ts` với toàn bộ dòng còn hiệu lực + adjustment hiện có
        (giữ `ruleSnapshot`; khuyến mãi O8 giữ theo quyết định chủ dự án) + làm tròn tiền mặt; kiểm
        `MIN_ORDER_NOT_MET` chỉ cảnh báo (`warnings`) — quán chủ động sửa;
     5. ghi: dòng bớt → `canceledQuantity += n` (+ `releaseForLine`); dòng thêm → `order-line` mới
        `addedInRevision`, reserve giới hạn ngày; cập nhật amount của các dòng và allocation theo kết quả
        pipeline; cập nhật order totals, `receiveMethod`, fulfillment `addressSnapshot`, group
        `fulfillmentAmount`/`estimatedReadyAt`; `editRevision += 1`;
     6. tiền: `paid = Σ captured − Σ refunded − Σ refund pending`; `paid > newTotal` → `refundHeld`-style
        hoàn phần dư (tiền mặt `settled`, chuyển khoản `pending`, ưu tiên hoàn chuyển khoản trước nếu đơn
        trả cả hai — ghi rõ trong timeline); `newTotal > paid` và đơn có payment online đã capture →
        `payment-link.issue` cho phần chênh (payment `pending` mới với `requestedAmount = chênh`), group giữ
        trạng thái; đơn `pay-on-pickup` → không làm gì (số cần thu tự tăng);
     7. `recomputeProjection`; timeline `order.edited` (public: "Đơn đã được cập nhật"; payload nội bộ
        before/after đã che PII); change-log `order.edit`; outbox `order.edited` → email
        `customer.order-updated` (VI/EN: món thay đổi, tổng mới, link trả phần chênh nếu có).
     - `preview` = chạy 1–6 trong transaction rồi rollback (như `lineCancelPreview`).
   - Verification: unit test hàm tính chênh/hoàn thuần (`domain/order-edit.ts`); script
     `scripts/ordering/order-edit.mjs` (mới) đủ các ca trong spec + replay cùng `revision` → `ORDER_CHANGED`;
     preview xong DB không đổi (đếm dòng trước/sau).
6. **Sửa đơn — route và Admin**
   - Files: `register.ts` action `order.edit` ("Sửa đơn"); `routes/index.ts` 2 route; controller
     `admin-orders.editPreview`/`edit`; `detail` trả `editRevision`, `editable: boolean`, `editableReason`;
     Admin E3: nút "Sửa đơn" trong chi tiết đơn, panel sửa (không dùng dropdown trong Modal — dùng nút/
     panel như O3/O5), gọi preview mỗi khi thay đổi (debounce 400 ms), xác nhận hiện số thu thêm/hoàn.
   - Verification: script HTTP trong `order-edit.mjs`: 403 thiếu quyền, 404 ngoài scope; `translations`
     test đạt; `strapi build`.
7. **Trang người giao**
   - Files: `services/courier.ts` `myDeliveries(ctx, view)` (lọc `fulfillment.assigneeRef = actorRef`,
     trạng thái active = `ready|out-for-delivery|failed`, done = `delivered` trong ngày); route
     `GET /ordering/courier/deliveries`; `admin/src/pages/Courier/` (E4) dùng lại API `transition`,
     `cash-handover`; menu "Giao của tôi" chỉ hiện khi có `order.process` và là người giao (có đơn được
     gán hoặc có `payment.record-cash`); làm mới mỗi 30 giây + SSE `orders/stream` nếu sẵn.
   - Verification: `scripts/ordering/courier.mjs` (mới): người giao A thấy 2 đơn của mình, không thấy đơn
     của B; A gọi `cash-handover` cho đơn của B → 404 (chặn thêm trong `cashHandover`/`transition`: nếu
     actor chỉ có quyền người giao — không có `order.read` cả chi nhánh — thì chỉ đơn của mình); UAT
     điện thoại.
8. **Tài liệu, UAT seed, gate**
   - Files: `docs/ordering-staff-guide.md`, `docs/ordering-api-contract.md` (specialHours trong /config,
     `dailyLimit`, `ITEM_SOLD_OUT`), `docs/plans/ordering-o7-screens.md` ("Đã đổi khi code O7"),
     `scripts/ordering/uat-server.mjs` (ngày đặc biệt, món giới hạn, đơn để sửa, người giao),
     `scripts/ordering/run-all.mjs`, `docs/STATUS.md`, Completion record.
   - Verification: gate đầy đủ (mục Verification), `check:ordering` 2 lượt.

## Data and rollback

- Migration `0005-o7-ops-extras` thêm bảng và index; `order.editRevision` default 0,
  `order-line.addedInRevision` null — đơn cũ đọc bình thường.
- Đơn cũ không có reservation: `releaseForOrder` không làm gì.
- Rollback: xóa giới hạn và ngày đặc biệt trong Admin; bỏ quyền `order.edit`. Không xóa bảng (dữ liệu
  reservation còn dùng để đối chiếu).

## Verification

- Automated (tuần tự, `DATABASE_NAME`/`ORDERING_TEST_DATABASE` là DB test):

  ```bash
  pnpm run lint && pnpm run typecheck && pnpm run test
  pnpm run check:ordering            # 2 lượt liên tiếp
  DATABASE_NAME=salanca_ordering_test ORDERING_ENABLED=false pnpm run check:phase3
  DATABASE_NAME=salanca_ordering_test ORDERING_ENABLED=true  pnpm run check:phase3
  DATABASE_NAME=salanca_ordering_test ORDERING_ENABLED=true  pnpm run smoke:reservation-form
  pnpm run smoke:ordering-pickup && node scripts/smoke-ordering-sepay.mjs && node scripts/smoke-ordering-delivery.mjs
  ORDERING_ENABLED=true pnpm exec strapi build && ORDERING_ENABLED=false pnpm exec strapi build
  ```

- Manual UAT: theo spec.
- Evidence: Completion record + `docs/STATUS.md`.

## Documentation impact

- Spec O7, screens O7, mockup O7, reference U7, staff guide, API contract, STATUS, roadmap.

## Risks and blockers

- Sửa đơn chạm tiền và allocation: viết hàm thuần cho chênh lệch trước, test property "tổng sau sửa =
  Σ dòng + phí + adjustment" trước khi nối DB.
- Đơn trả cả tiền mặt và chuyển khoản rồi sửa giảm: thứ tự hoàn ghi rõ, test riêng.
- Strapi Admin trên điện thoại: UAT sớm (sau bước 7) để kịp đổi hướng.

Ước lượng thô: 2–3 tuần (1–2: 2 ngày; 3–4: 4 ngày; 5–6: 5–6 ngày; 7: 3 ngày; 8: 2 ngày).

## Completion record

- 2026-10-13. Nhánh `feat/ordering-o7`. Chưa push, chưa merge `main`.
- Commit tính năng: `30caf1d` giờ đặc biệt theo ngày; `04699b3` công bố trên config và màn chi nhánh;
  `2393d42` giữ phần nguyên tử; `28faa8e` áp giới hạn lên đơn và catalog; `2a96316` tính lại giá và hoàn
  phần chênh; `57090f2` mở sửa đơn trên màn chi tiết; `d0541bf` trang điện thoại cho người được gán.
  Tài liệu, seed UAT và bản ghi này nằm ở commit docs cùng ngày.
- Gate chạy trên `salanca_ordering_o7` (plan ghi `salanca_ordering_test`; worktree này không đụng DB đó,
  cũng không đụng `salanca_cms`). UAT server mặc định cổng 1352, DB `salanca_ordering_o7_uat`.
- Gate 2026-10-13 trên `salanca_ordering_o7`: lint, typecheck, vitest 162 file / 1131 test, `check:ordering` lượt 1 **51/51** (gồm `special-hours.mjs` và `courier.mjs`). Lượt 2 bị dừng giữa chừng. Chưa chạy `check:phase3`, smoke reservation/pickup/sepay/delivery, và hai lượt `strapi build` — chủ dự án bảo phần đó lâu và không cần cho lần này. `special-hours.mjs` so ngày fixture với cửa sổ 14 ngày thật, vì 2026-10-26 vào cửa sổ từ 2026-10-13.
- Lệch khi code: `updatedByRef` (Strapi đã dùng `updatedBy`); hai unique index, không ba; `editRevision` /
  `addedInRevision` sync schema, không viết lại migration `0005`. Link phần chênh đi qua `issueForBalance`
  (không đổi `issue()`, không ghi `paymentDeadlineStoreKey`). Preview không ghi token link vào plugin store.
  Actor không có dòng `plugin::ordering.*` (seed `roles: []`) vẫn thao tác được như trước. `en.json` /
  `vi.json` không sửa tay. Màn Admin sửa đơn và trang người giao chưa bấm trên trình duyệt.
- Open: UAT 360px của khung Admin chưa làm. Hướng nếu khung không dùng được: trang nhẹ ngoài chrome Admin,
  không magic link, ngoài O7. Chưa push.
