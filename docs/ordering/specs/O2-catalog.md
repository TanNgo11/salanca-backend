# O2 — Catalog và API menu

## 1. Mục tiêu

Quán tự nhập món bán online trong Admin (danh mục, món, biến thể, tùy chọn, combo, khung giờ bán), bấm "Tạm
hết" theo chi nhánh; website đọc menu qua API công khai. Catalog là **adapter mặc định**, app khác có thể thay
bằng `CatalogAdapter` riêng.

## 2. Trạng thái

🟡 **Đang làm: 2/11 bước.** Code ở branch `docs/ordering-ui-o3` (commit `a2745c6`, `1a7f517`), chưa có branch
`feat/ordering-o2` riêng như handoff yêu cầu.

## 3. Input / Output

**API công khai** (`auth: false`, chỉ đọc, `Cache-Control: public, max-age=30`, rate limit, chỉ trả field cho phép):

| Route | Input | Output |
| --- | --- | --- |
| `GET /api/v1/ordering/catalog/categories` | `locale` | cây danh mục: id, slug, tên, thứ tự, số món |
| `GET /api/v1/ordering/catalog/products` | `locale`, `category`, `location`, `cursor` | danh sách món **đang bán online**: slug, tên, ảnh, giá "từ", `featured`, trạng thái (còn / tạm hết / ngoài giờ bán + giờ bán lại), `nextCursor` |
| `GET /api/v1/ordering/catalog/products/:slug` | `locale`, `location` | chi tiết món: biến thể + giá, nhóm tùy chọn (min/max, bắt buộc, giá cộng thêm, tạm hết), thành phần combo |

Lỗi: `PRODUCT_NOT_FOUND` (404), `LOCATION_UNAVAILABLE`, `VALIDATION_ERROR` (query sai).

**Admin:** Content Manager cho các type catalog; màn **Danh mục** (cây, kéo thả, xóa có quy tắc); màn **Tạm
hết món** (chọn chi nhánh trong scope, bật/tắt theo món/biến thể/tùy chọn, đến hết ngày hoặc giờ cụ thể).

**Quyền:** `catalog.manage`, `catalog.toggle-availability`.

**Adapter cho lõi:** `listCategories`, `listSellables`, `getSellable`, `getListPrice`, `getAvailability`.

## 4. Đã làm

- **Bước 1:** 9 content type (category dạng cây, product, variant, price, modifier-group, modifier,
  availability-window hiện ở Content Manager; catalog-slug, catalog-location-state ẩn). Không i18n, không
  Draft & Publish (product dùng field `status`). Migration `0002` tạo unique index cho slug, SKU,
  location-state + index quét món online. `schema.mjs` kiểm 29 bảng.
- **Bước 2:** custom field `localized-text`: validator thuần (object, chỉ key là locale đang bật, giá trị
  string, độ dài tối đa, bắt buộc = ít nhất một bản dịch), chuỗi fallback (locale → mặc định → bản đầu tiên có
  chữ); ô nhập Admin đọc danh sách locale từ i18n API, không hard-code vi/en.

## 5. Chưa làm

3. Slug theo ngôn ngữ (tự sinh từ tên, bỏ dấu; trùng cùng locale → lỗi rõ field).
4. Field `modifierGroups`, `bundleSlots`: editor có cấu trúc (dự phòng: editor JSON có schema) + validate.
5. Chọn giá và availability (code thuần): khung giờ qua nửa đêm, tạm hết đến giờ X, combo hết khi nhóm bắt buộc hết.
6. Adapter `ordering-catalog` thật thay stub.
7. API đọc catalog (3 route trên).
7b. Màn Danh mục.
8. Màn Tạm hết món + quyền.
9. Extension field của app + snapshot dòng hàng.
10. Hướng dẫn nhập catalog cho nhân viên.
11. Bản dịch Admin, ghi `admin-change-log`, mục route công khai trong `security-baseline.md`.
12. **Mới (2026-10-11):** field `featured` (món nổi bật) và `rank` (thứ tự món trong danh mục); API sắp theo
    `featured` rồi `rank`.

## 6. Lỗi dự kiến và cách chặn

| Rủi ro | Cách chặn |
| --- | --- |
| N+1 khi trả danh sách món (mỗi món query giá, tùy chọn, tạm hết) | Nạp theo lô bằng `$in` cho cả trang; test đếm số query cố định |
| Slug trùng khi 2 người lưu cùng lúc | Unique index ở DB (migration), không dựa `unique: true` |
| Content Manager ghi thẳng, bỏ qua validate JSON | Document Service middleware validate `localized-text`, `modifierGroups`, `bundleSlots`, slug |
| Lộ field nội bộ qua API | Serialize theo danh sách field cho phép, test snapshot response |
| Tạm hết ở chi nhánh A ảnh hưởng B | Service lọc theo scope; script scope nhân viên A không đổi được B |

## 7. Edge case (bắt buộc có test, lấy từ mockup O2)

- Topping "Giò heo" giá thư viện 20.000, ghi đè 25.000 cho Bún bò.
- Combo trưa 99.000 với "Tô đặc biệt +20.000", "Trà đào +15.000".
- Trà đào tạm hết → chỉ ẩn lựa chọn đó; nhóm bắt buộc hết sạch → cả combo hết.
- Khung "Đêm khuya 22:00–02:00" qua nửa đêm.
- Slug trùng cùng ngôn ngữ bị từ chối, khác ngôn ngữ thì được; xóa món giải phóng slug.
- API chỉ trả món `active` + `sellOnline`.
- Danh mục: không cho làm con của chính cháu mình; xóa khi còn con → `CATEGORY_HAS_CHILDREN`; xóa khi còn món →
  cần `confirm=true`.
- Locale thiếu bản dịch → về locale mặc định.

## 8. Phần dễ tốn thời gian nhất (dự kiến) và vì sao

**Editor `modifierGroups` / `bundleSlots` trong Content Manager.** Lý do:
- Custom field của Strapi là một ô React nằm trong form của Content Manager: phải tự làm UI chọn từ thư viện,
  ô ghi đè giá, kéo thả thứ tự, mà vẫn phải theo luật `.tsx` ≤ 250 dòng.
- Phải validate tham chiếu chéo (group, modifier, variant có tồn tại không) ở cả client lẫn server.
- Lỗi chỉ hiện khi bấm thử trong Admin, khó viết test tự động.
- Dự phòng đã duyệt: editor JSON có schema; nếu dùng thì ghi vào Completion record.

## 9. Gate / Acceptance

lint, typecheck, test, build (plugin bật), `check:phase3` tắt/bật, `check:ordering` (gồm `disable-survives`).
UAT: tạo danh mục cha/con, món 2 biến thể, gắn Topping ghi đè giá, combo có nhóm chọn, tên VI/EN, nhân viên A
bật tạm hết ở A không thấy B, Content-Type Builder không hiện type plugin, content Salanca không đổi.

## 10. Tài liệu chi tiết

`docs/phases/phase-ordering-2-catalog.md`, `docs/plans/ordering-o2-catalog.md`, `docs/plans/ordering-o2-handoff.md`,
`docs/plans/mockups/ordering-o2-catalog.html`, contracts mục 4, 20.
