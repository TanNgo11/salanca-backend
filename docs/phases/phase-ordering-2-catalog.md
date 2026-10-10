# Phase O2 — Module catalog

Trạng thái: spec chờ duyệt (2026-10-10). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Mockup: [`plans/mockups/ordering-o2-catalog.html`](../plans/mockups/ordering-o2-catalog.html).
Kế hoạch thực hiện: [`plans/ordering-o2-catalog.md`](../plans/ordering-o2-catalog.md).
Thiết kế: [`plans/ordering-core-contracts.md`](../plans/ordering-core-contracts.md) (mục 4, 20);
nghiên cứu: reference C12, C18, C19, C20.

## Goal

Nhân viên của bất kỳ khách nào cài plugin nhập được danh mục, sản phẩm, biến thể, giá, tùy chọn cộng
thêm và combo trong Content Manager; website đọc được catalog qua API của plugin; lõi đơn hàng (O1) nhận
`Sellable` từ adapter mặc định `ordering-catalog`. Content của Salanca (`menu-item`…) không đổi.

## Điều kiện bắt đầu

- O1 đóng (registry, `Sellable`, pipeline giá).
- O0 đã xác nhận custom field trong Content Manager và extension của app (mục kiểm 15–18).

## Scope

- **Content type** (mục 20.1): `catalog-category` (cây), `catalog-product` (`status`, `sellOnline`,
  `minQuantity`, cách nhận hàng, `modifierGroups`, `bundleSlots`), `catalog-variant`, `catalog-price`,
  `catalog-modifier-group`, `catalog-modifier`, `catalog-availability-window`, `catalog-location-state`.
  Không bật i18n, không bật Draft & Publish, ẩn khỏi Content-Type Builder.
- **Custom field:** `localized-text` (ô nhập theo từng ngôn ngữ đang bật trong Strapi), editor cho
  `modifierGroups` (chọn group từ thư viện, ghi đè giá/mặc định/ẩn) và `bundleSlots` (nhóm chọn, item,
  giá chênh). Validate ở service khi lưu; slug unique theo từng ngôn ngữ bằng index.
- **Adapter `ordering-catalog`:** `listCategories`, `listSellables`, `getSellable`, `getListPrice`,
  `getAvailability`; áp ghi đè tùy chọn, chọn giá cụ thể nhất (v1 giá gốc), tính "tạm hết" và khung giờ
  bán theo giờ chi nhánh; combo hết khi một item bắt buộc hết.
- **API storefront chỉ đọc** (mục 20.2): `GET /ordering/catalog/categories`,
  `GET /ordering/catalog/products`, `GET /ordering/catalog/products/:slug`; chỉ product `active` và
  `sellOnline`; cache ngắn; không lộ field nội bộ.
- **Màn hình "Tạm hết món"** theo chi nhánh trong Admin; quyền `catalog.manage` và
  `catalog.toggle-availability` (nhân viên chi nhánh chỉ bật/tắt trong scope).
- **Extension:** tài liệu và ví dụ thêm field cho product bằng `src/extensions/ordering/strapi-server.ts`.
- **Snapshot:** line lưu tên, biến thể, tùy chọn, thành phần combo, danh mục lúc đặt.
- **Tài liệu:** hướng dẫn nhập catalog cho nhân viên (tiếng Việt).

## Non-goals

- Tồn kho đếm số lượng, giá theo chi nhánh/nhóm khách, bộ thuộc tính khai trong Admin (module sau).
- Liên kết `menu-item` của Salanca với product (chủ dự án chốt giữ nguyên content).
- Nhập dữ liệu thật của Salanca (khách tự nhập khi bán online).

## Acceptance

### Automated

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check:phase3
```

Test bắt buộc:

- `modifierGroups`/`bundleSlots` sai cấu trúc hoặc trỏ tới group/variant không tồn tại bị từ chối.
- Ghi đè tùy chọn theo món ra đúng `Sellable.options`; combo ra đúng thành phần và giá chênh.
- Khung giờ bán và "tạm hết" theo chi nhánh cho đúng `availability` (gồm khung giờ qua nửa đêm).
- Slug trùng trong cùng ngôn ngữ bị từ chối, khác ngôn ngữ thì được.
- API chỉ trả product `active` + `sellOnline`, không trả field nội bộ; locale thiếu bản dịch thì rơi về
  ngôn ngữ mặc định.

### Manual Admin UAT

- [ ] Tạo danh mục cha/con, product có 2 biến thể, gắn nhóm "Topping" và ghi đè giá một topping.
- [ ] Tạo combo "1 món chính + 1 nước", tắt một món chính bắt buộc → combo hiện hết.
- [ ] Nhập tên VI/EN trong cùng một trang; Content Manager của content Salanca vẫn như cũ.
- [ ] Nhân viên chi nhánh A bật "tạm hết" được ở A, không thấy B.
- [ ] Content-Type Builder không hiện type nào của plugin.

## Bổ sung sau review (2026-10-10)

- Đường dẫn công khai trong tài liệu này là tương đối; với Salanca chúng nằm dưới `/api/v1` (contracts 21.7).
- Bản dịch giao diện Admin của plugin: `admin/src/translations/{vi,en}.json`; plugin generic nên không
  để chuỗi cứng tiếng Việt trong component.
- Ghi route catalog công khai, rate limit và giới hạn kích thước vào `docs/security-baseline.md` (21.8).
- Thay đổi catalog và "tạm hết" ghi vào `admin-change-log` (21.6).

## Rollback

Tắt `ORDERING_ENABLED`; bảng catalog không liên kết với content Salanca nên drop được khi cần.

## Rủi ro

- Viết editor React cho `modifierGroups`/`bundleSlots` tốn công nhất; nếu vượt ước lượng, v1 dùng editor
  JSON có schema và gợi ý, nâng cấp sau.
- Content Manager không thân thiện với quan hệ nhiều cấp (variant, price): đo bằng UAT, nếu nhân viên
  thấy khó thì đề xuất màn hình riêng (cần duyệt theo `AGENTS.md`).
