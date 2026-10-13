# O14 — Bảng giá theo kênh, nhóm khách, khung giờ: kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt), AI thực hiện
Last updated: 2026-10-12
Related phase: [`phases/phase-ordering-14-price-lists.md`](../phases/phase-ordering-14-price-lists.md)

Mockup: [`mockups/ordering-o14-price-lists.html`](mockups/ordering-o14-price-lists.html). Đặc tả màn hình ở mục cuối.

## Goal

Nối và mở rộng lõi chọn giá có sẵn: kênh chuẩn, nhóm khách, khung giờ, bảng giá override/adjust, xem trước giá.

## Non-goals

- Đa tiền tệ, bậc thang số lượng mới, giá từng khách, B2B.

## Current evidence

- `content-types/catalog-price/schema.ts`: `variant`, `amount`, `compareAtAmount`, `currency`, `minQuantity`, `rules` JSON,
  `priority`, `validFrom`, `validTo` ("location/channel/customer group rules later").
- `domain/catalog/price-selection.ts` `selectCatalogPrice(rows, { at, locationRef, channel, customerGroup, quantity })`:
  rule phải khớp hết, nhiều rule thắng → `priority` → `minQuantity` → giá thấp.
- `providers/ordering-catalog/adapter.ts` gọi `selectCatalogPrice` với `channel: ctx.channel` (hiện `web-checkout` |
  `phone-staff` từ `consent.channel` — chưa phải kênh nhận hàng), **chưa** truyền `customerGroup`.
- Đơn lưu giá lúc đặt trên `order-line` (`unitAmount`, `optionAmount`…).
- O8 khuyến mãi áp trên base dòng; O11 có `customer` + phiên.

## Decisions and assumptions

- Decision: kênh chuẩn = `receiveMethod.kind` (`pickup` | `delivery` | `dine-in`) hoặc `staff` cho đơn hộ (`origin.kind =
  'staff-draft'`); bỏ dùng `consent.channel` cho giá (migration đổi rule cũ `web-checkout` → không rule kênh).
- Decision: thời điểm áp giá = **lúc đặt** (quote/create), kể cả đơn hẹn giờ — giống quầy; web ghi rõ "Giá theo thời điểm đặt".
- Decision: rule mới `weekdays` (mon..sun) và `timeRanges` (`HH:mm`, giờ chi nhánh, cho phép qua nửa đêm) — khớp như rule
  khác, tính vào độ cụ thể.
- Decision: `price-list` là bảng cha: `{ name, kind: 'override'|'adjust', rules (cùng từ vựng), priority, active, validFrom/To }`;
  `override` sinh/giữ dòng `catalog-price` con (`priceList` relation) cho từng biến thể chọn; `adjust` không sinh dòng mà áp
  khi chọn giá: tìm giá cơ sở bằng `selectCatalogPrice` bỏ qua list adjust, rồi trừ %/số tiền cho biến thể thuộc
  danh mục/món chọn, không dưới 0, làm tròn xuống đồng; nhiều `adjust` khớp → lấy `priority` cao nhất (không cộng dồn).
  `compareAtAmount` = giá cơ sở khi list làm giảm giá.
- Decision: nhóm khách = `customer-group` + `customer.groups` (manyToMany); nhóm tự động theo điều kiện
  `{ minTotalSpent?, minOrderCount?, sinceDays? }` cập nhật bằng job hằng ngày; khách thuộc nhiều nhóm → giá tốt nhất giữa
  các nhóm (chọn giá thấp nhất trong các ứng viên khớp).
- Decision: quyền mới `price.manage` (bảng giá, nhóm khách).

## Invariants

- Giá chọn ở server theo ngữ cảnh; quote = create cùng giờ/ngữ cảnh.
- Giá không âm; đơn đã đặt không đổi khi bảng giá/nhóm đổi.
- Khuyến mãi O8 áp sau bảng giá.

## Data model

| Bảng / field | Mô tả |
| --- | --- |
| `catalog-price.rules` | thêm `weekdays: string[]`, `timeRanges: [{ start, end }]`; `channel` ∈ pickup\|delivery\|dine-in\|staff |
| `catalog-price.priceList` | relation manyToOne `price-list` (null = giá thường) |
| `price-list` | `name` {vi,en}, `kind`, `rules` JSON, `adjust` JSON `{ type: percent\|amount, value, target: { kind: all\|categories\|products, refs } }`, `priority`, `active`, `validFrom?`, `validTo?`, `createdBy` |
| `customer-group` | `code` (unique), `name` {vi,en}, `auto` JSON? (điều kiện), `active` |
| `customer.groups` | manyToMany `customer-group` |

Migration `0012-o14-price-lists.ts` (số theo thứ tự thực tế khi làm): bảng mới, relation, chuyển rule kênh cũ.

## API

| Method | Path | Quyền | Mô tả |
| --- | --- | --- | --- |
| GET/POST/PUT | `/ordering/price-lists[/:id]` | `price.manage` | bảng giá; `override` kèm danh sách dòng (biến thể → giá) |
| POST | `/ordering/price-lists/:id/active` | `price.manage` | bật/tắt |
| POST | `/ordering/price-preview` | `price.manage` | `{ variantId, locationRef, channel, customerGroup?, at }` → `{ amount, compareAtAmount, winner: { kind: base\|list, id, name }, candidates[] }` |
| GET/POST/PUT | `/ordering/customer-groups[/:id]` | `price.manage` | nhóm; `POST /customer-groups/:id/members` thêm/bớt khách |
| GET | `/api/v1/ordering/catalog/products` (đã có) | public | thêm query `receiveKind`, `at?`; dùng phiên khách nếu có |

Lỗi mới: `PRICE_LIST_INVALID` 400 (`details.issues`), `PRICE_LIST_NOT_FOUND` 404, `CUSTOMER_GROUP_NOT_FOUND` 404.

## Implementation steps

1. **Mở rộng hàm chọn giá (thuần)**
   - Files: `domain/catalog/price-selection.ts` (rule `weekdays`/`timeRanges` theo timezone; ứng viên nhiều `customerGroup`;
     `applyAdjustLists(base, lists, variantContext)`), test bảng giá trị (≥ 25 ca: kênh, nhóm, giờ qua nửa đêm, adjust không âm,
     priority, nhiều nhóm → giá thấp nhất).
   - Verification: `pnpm run test`.
2. **Kênh chuẩn**
   - Files: `adapter.ts` + `services/order.ts` (kênh từ `receiveMethod.kind`/origin), catalog công khai nhận `receiveKind`,
     migration chuyển rule cũ.
   - Verification: `scripts/ordering/price-lists.mjs` (mới): giá theo kênh; quote = create; `catalog-api.mjs` vẫn xanh.
3. **Bảng giá + nhóm khách (dữ liệu, service)**
   - Files: content type `price-list`, `customer-group`, relation, migration, `services/price-list.ts`,
     `services/customer-group.ts`, job `customer-group-refresh` (hằng ngày), `register.ts` (`price.manage`), change-log.
   - Verification: script: override/adjust, bật/tắt, nhóm tự động, nhiều nhóm.
4. **Nối nhóm khách khi tính giá**
   - Files: `prepareOrder`/catalog công khai lấy `customerGroups` từ phiên O11 (đơn hộ: theo SĐT khách nếu có hồ sơ).
   - Verification: script: đăng nhập khách nhóm → giá nhóm; vãng lai → giá thường; khuyến mãi O8 trên giá nhóm.
5. **Admin (L1–L3)**
   - Files: `admin/src/pages/PriceLists/`, `admin/src/pages/CustomerGroups/`, nhóm menu **Món** (Bảng giá) và **Vận hành**
     (Nhóm khách, cạnh Khách hàng O11), `translations/o14.ts`.
   - Verification: script HTTP 403/404; `strapi build`.
6. **Tài liệu, gate**
   - Files: catalog guide (bảng giá), API contract (`receiveKind`, giá theo khách), screens trong file này "Đã đổi khi code",
     STATUS, Completion record.
   - Verification: gate đầy đủ, `check:ordering` 2 lượt.

## Đặc tả màn hình

Quy ước chung như [`ordering-o3-screens.md`](ordering-o3-screens.md); chuỗi trong `translations/o14.ts`.

### L1. Bảng giá (Món → Bảng giá)

- Route `/plugins/ordering/price-lists`. Quyền `price.manage`. Bảng: **Tên**, **Kiểu** (`Badge` Giá riêng / Giảm theo
  danh mục), **Áp khi** (rút gọn: "Giao · T2–T6 14:00–17:00 · Q1"), **Thời gian**, **Ưu tiên**, `Switch` bật.
- Tạo/sửa (trang con): Tên VI/EN; Kiểu (thẻ chọn); **Áp khi**: kênh (nút Tự lấy/Giao/Tại bàn/Đơn hộ), chi nhánh (checkbox),
  nhóm khách (checkbox), ngày trong tuần (7 nút), khung giờ (cặp TimePicker ≤ 3), từ–đến ngày; **Giá**: kiểu Giá riêng → bảng
  món/biến thể có ô giá mới (tìm món không dấu, thêm từng dòng; cột "Giá thường" để so); kiểu Giảm → % hoặc số tiền + áp cho
  Tất cả / Danh mục / Món (checkbox có tìm). Ưu tiên (số). Lưu.

### L2. Xem trước giá (panel trong L1 và form món O2)

- Chọn món/biến thể, chi nhánh, kênh, nhóm khách, ngày giờ → "Giá cuối 52.000đ (giá thường 65.000đ) — thắng: Happy hour đồ uống
  (ưu tiên 10)" + danh sách ứng viên (bảng nào khớp/không khớp và vì sao).

### L3. Nhóm khách (Vận hành → Nhóm khách)

- Route `/plugins/ordering/customer-groups`. Quyền `price.manage`. Bảng: Mã, Tên, Số khách, Tự động (điều kiện rút gọn), bật.
- Tạo/sửa: mã, tên VI/EN, `Checkbox` "Tự động" + điều kiện (tổng chi ≥, số đơn ≥, trong N ngày); tab Thành viên (tìm khách O11 theo
  SĐT, thêm/bớt tay — khách tự động hiện `Badge` "Tự động").

## Data and rollback

- Migration theo số thứ tự thực tế; rollback: tắt bảng giá; giá thường giữ nguyên.

## Verification

- Automated: lint, typecheck, test, `check:ordering` 2 lượt, `check:phase3` tắt/bật, smoke, build tắt/bật.
- Manual UAT: theo spec.

## Documentation impact

- Spec + mockup O14, reference U14, catalog guide, API contract, STATUS, roadmap.

## Risks and blockers

- Bảng chồng nhau khó hiểu → L2 bắt buộc có trước khi bật cho chi nhánh thật.

Ước lượng thô: 1,5–2 tuần (1: 2 ngày; 2: 1 ngày; 3–4: 3–4 ngày; 5: 3 ngày; 6: 1 ngày).

## Completion record

- Chưa bắt đầu.
