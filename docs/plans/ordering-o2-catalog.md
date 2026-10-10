# O2 — Module catalog: kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt), Claude (thực hiện)
Last updated: 2026-10-10
Related phase: [`phases/phase-ordering-2-catalog.md`](../phases/phase-ordering-2-catalog.md)

## Goal

Nhân viên nhập catalog trong Content Manager; website đọc catalog qua API plugin; lõi O1 nhận `Sellable`
từ adapter `ordering-catalog`.

## Non-goals

- Tồn kho đếm số lượng, giá theo chi nhánh/nhóm khách, bộ thuộc tính khai trong Admin.
- Đụng `menu-item`, `menu-category`, `menu-package` hay seed bundle của Salanca.

## Current evidence

- O1 xong: registry, `contracts/Sellable`, pipeline giá.
- Strapi 5.51.1: i18n coi mọi relation là theo ngôn ngữ; plugin không nạp component; plugin đăng ký được
  custom field kiểu `json` (reference C19.6, C20); plugin Shopify đăng ký custom field ở `register()` và
  ô nhập ở admin.
- Thiết kế: contracts mục 4, 20.

## Decisions and assumptions

- Decision: catalog không bật i18n và Draft & Publish; chữ đa ngôn ngữ trong custom field
  `localized-text` dạng `{ vi, en }`; product dùng `status`.
- Decision: slug unique theo ngôn ngữ bằng bảng chỉ mục riêng `catalog-slug` (`entityType`, `entityId`,
  `locale`, `slug`, unique `(entityType, locale, slug)`) do middleware duy trì, vì số ngôn ngữ thay đổi
  được nên không tạo index biểu thức cố định trên JSON.
- Decision: kiểm `modifierGroups`, `bundleSlots`, `localized-text` ở Document Service middleware của các
  type catalog (Content Manager đi qua Document Service).
- Assumption: danh sách ngôn ngữ cho ô nhập lấy từ API Admin của plugin i18n (`GET /i18n/locales`);
  kiểm ở bước 2.

## Invariants

- Content type của Salanca không đổi; `pnpm run check:phase3` vẫn đạt.
- API công khai chỉ trả product `active` + `sellOnline`, không trả `metadata` nội bộ hay `inventoryRef`.
- Giá trong DB là số nguyên VND.

## Implementation steps

1. **Content type catalog**
   - Files: `server/src/content-types/{catalog-category, catalog-product, catalog-variant, catalog-price,
     catalog-modifier-group, catalog-modifier, catalog-availability-window, catalog-location-state,
     catalog-slug}/`, migration.
   - Làm: quan hệ theo contracts 20.1; `catalog-*` hiện ở Content Manager (trừ `catalog-slug`,
     `catalog-location-state`), ẩn khỏi Content-Type Builder; field `status` enum; `listView` mặc định.
   - Verification: script `scripts/ordering/schema.mjs` mở rộng cho bảng catalog; Admin hiện đúng các type.
2. **Custom field `localized-text`**
   - Files: `server/src/register.ts` (`strapi.customFields.register`), `admin/src/custom-fields/localized-text/`
     (Input React, gọi danh sách locale), `domain/catalog/localized-text.ts` (validate: object, key là
     locale đang bật, giá trị string, độ dài tối đa).
   - Verification: Vitest cho validate; UAT: nhập VI/EN trong trang category.
3. **Slug theo ngôn ngữ**
   - Files: `services/catalog-slug.ts`, middleware trong `register.ts`.
   - Làm: khi tạo/sửa category/product, tính slug từng locale (từ field slug hoặc tạo từ tên, bỏ dấu tiếng
     Việt), ghi `catalog-slug` trong cùng transaction; trùng → lỗi rõ field nào.
   - Verification: script: hai product cùng slug `vi` → lỗi; khác locale → được; xóa product → slug được
     giải phóng.
4. **Field `modifierGroups` và `bundleSlots`**
   - Files: `admin/src/custom-fields/{modifier-groups, bundle-slots}/` (editor có chọn từ thư viện và ô
     ghi đè), `domain/catalog/{modifier-groups.ts, bundle-slots.ts}` (schema zod + kiểm tham chiếu),
     middleware.
   - Làm: v1 editor có cấu trúc; nếu vượt ước lượng thì editor JSON có schema (ghi vào Completion record).
   - Verification: Vitest: min > max, group không tồn tại, variant không tồn tại, override modifier
     không thuộc group đều bị từ chối.
5. **Chọn giá và availability (thuần)**
   - Files: `domain/catalog/{price-selection.ts, availability.ts}`.
   - Làm: chọn `catalog-price` cụ thể nhất theo ngữ cảnh (v1 giá gốc, có `validFrom/validTo`); availability
     = `status` + `sellOnline` + khung giờ bán theo giờ chi nhánh (qua nửa đêm) + `catalog-location-state`
     + combo hết khi item bắt buộc hết.
   - Verification: Vitest dạng bảng cho khung giờ, tạm hết đến giờ X, combo.
6. **Adapter `ordering-catalog`**
   - Files: `providers/ordering-catalog/adapter.ts`, đăng ký trong `register()`.
   - Làm: `listCategories`, `listSellables` (cursor), `getSellable`, `getListPrice`, `getAvailability`; áp
     ghi đè tùy chọn thành `Sellable.options`; combo thành thành phần; locale thiếu thì về `defaultLocale`.
   - Verification: script tích hợp: product mẫu có biến thể, topping ghi đè, combo → `Sellable` đúng; pipeline
     O1 tính đúng giá với tùy chọn và combo.
7. **API đọc catalog**
   - Files: `routes/content-api.ts`, `controllers/catalog.ts`, `domain/catalog/serialize.ts`.
   - Làm: 3 route mục 20.2, `auth: false`, chỉ đọc; `Cache-Control: public, max-age=30`; sanitize bằng
     danh sách field cho phép.
   - Verification: `curl` trả đúng; product `draft` hoặc `sellOnline=false` không xuất hiện; không có field
     nội bộ.
7b. **Màn hình "Danh mục"** (thêm 2026-10-10 theo chủ dự án)
   - Files: `admin/src/pages/Categories/` (cây, form sửa, hộp thoại xóa), `routes/admin.ts`,
     `controllers/categories.ts`, `services/catalog-category.ts`, `domain/catalog/category-tree.ts`.
   - Làm: API Admin lấy cây (kèm số sản phẩm), tạo, sửa, xóa, `move` (đổi cha + thứ tự trong một transaction,
     đánh lại `rank` của cùng cấp). Chặn vòng lặp (không cho làm con của chính cháu mình). Xóa: còn con → lỗi
     `CATEGORY_HAS_CHILDREN`; còn sản phẩm → cần `confirm=true`, gỡ liên kết, trả danh sách sản phẩm không còn
     danh mục. Ghi `admin-change-log`. Kéo thả bằng thư viện đã có trong Admin của Strapi nếu có; không thêm
     dependency mới khi chưa hỏi (dự phòng: nút lên/xuống và chọn danh mục cha).
   - Verification: Vitest cho `category-tree` (dựng cây, chặn vòng lặp, đánh lại rank); script tích hợp cho
     move, xóa còn con, xóa còn sản phẩm; UAT theo mockup màn 4b.
8. **Màn hình "Tạm hết món" và quyền**
   - Files: `admin/src/pages/Availability/`, `routes/admin.ts`, `controllers/availability.ts`,
     đăng ký action `catalog.manage`, `catalog.toggle-availability`.
   - Làm: chọn chi nhánh trong scope, bật/tắt tạm hết cho product/variant/modifier, chọn "đến hết ngày
     kinh doanh" hoặc giờ cụ thể; ghi actor.
   - Verification: script scope: nhân viên A không đổi được trạng thái ở B; UAT trên Admin.
9. **Extension và snapshot**
   - Files: `src/plugins/ordering/README.md` (ví dụ `src/extensions/ordering/strapi-server.ts`), kiểm snapshot
     line có `categoriesSnapshot`, biến thể, tùy chọn, combo.
   - Verification: thêm field thử qua extension trên DB test, khởi động lại hai lần, field còn.
10. **Hướng dẫn nhập catalog**
    - Files: `docs/ordering-catalog-guide.md` (tiếng Việt cho nhân viên).
    - Verification: UAT theo hướng dẫn.

11. **Bổ sung sau review (2026-10-10)**
    - Files: `admin/src/translations/{vi,en}.json` (mọi chuỗi của màn hình và custom field),
      `docs/security-baseline.md` (route catalog công khai), ghi `admin-change-log` trong middleware catalog.
    - Verification: đổi ngôn ngữ Admin sang English thấy đủ chuỗi; `curl` route catalog có rate limit và
      giới hạn kích thước; tạo/sửa product có dòng change-log.

## Data and rollback

- Migration/backfill: bảng mới.
- Compatibility: không đổi content Salanca.
- Rollback: tắt cờ; drop bảng catalog nếu cần.

## Verification

- Automated: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`,
  `pnpm run check:phase3`, `node scripts/ordering/catalog-*.mjs` (DB test).
- Manual UAT: theo danh sách trong spec O2.
- Evidence to record: Completion record, `docs/STATUS.md`.

## Documentation impact

- `docs/ordering-catalog-guide.md` (mới), README plugin, `docs/STATUS.md`.

## Risks and blockers

- Editor React cho tùy chọn/combo là phần tốn công nhất (rủi ro ước lượng).
- Content Manager có thể khó dùng với variant/price nhiều cấp; UAT quyết định có cần màn hình riêng.

## Completion record

Automated verification passed on `feat/ordering-o2` (14 commits trên `feat/ordering-o1`,
chưa merge/push theo quyết định của chủ dự án). Thực hiện 2026-10-10.

- **Bước 1–11 hoàn tất** (commit trên `feat/ordering-o2`): 9 content type catalog +
  migration 0002; validator `localized-text` + ô nhập theo locale; slug theo locale qua
  Document Service middleware + `catalog-slug`; `modifierGroups`/`bundleSlots` zod-validate +
  ref-check + custom field editor; chọn giá thuần + domain availability; adapter
  `ordering-catalog` thật + product type `food`; 3 public route read-only (`auth:false`,
  serializer trắng-field, cache ngắn, rate limit theo IP); màn **Danh mục** (bước 7b —
  cây, CRUD, kéo-thả + nút ↑/↓, move trong transaction, chống vòng lặp, quy tắc xóa);
  màn **Tạm hết món** (scope chi nhánh, EOD/giờ cụ thể, `catalog.manage` +
  `catalog.toggle-availability`); extension `src/extensions/ordering/strapi-server.ts`
  (`isFeatured` còn sau 2 lần boot — `catalog-extension.mjs`); hướng dẫn nhân viên
  `docs/ordering-catalog-guide.md`; middleware ghi `admin-change-log` cho mọi write
  Document Service lên catalog CT; `security-baseline.md` ghi mặt tấn công public API.
- **Gates:** `lint` ✓, `typecheck` ✓, `test` 137 file / 978 ✓, `build` (server + admin
  Vite) ✓, `check:ordering` 18/18 script trên `salanca_ordering_test` ✓ (gồm
  `disable-survives` — boot với plugin tắt giữ nguyên bảng).
- **`check:phase3` bị chặn ở `smoke:i18n`:** guard của script từ chối chạy vì dev DB
  `salanca_cms` đang có 4 bản ghi `global-setting` thật (bảo vệ nội dung biên tập, không
  liên quan thay đổi O2). `verify:schema` ✓ và `smoke:crud` ✓ đã chạy; phần còn lại của
  phase3 chạy riêng lẻ ✓. Cần chủ dự án quyết định chạy smoke:i18n trên DB trống.
- **UAT thủ công còn mở** (theo spec): màn Danh mục (kéo-thả, xóa có sản phẩm), màn Tạm
  hết món (scope nhân viên thật), nhập catalog theo `ordering-catalog-guide.md`, đổi
  ngôn ngữ Admin sang English kiểm tra chuỗi, `curl` 3 public route.
- Quyết định merge/push thuộc chủ dự án; chưa có code O2 trên `main`.
