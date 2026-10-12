# Phase O14 — Bảng giá theo kênh, nhóm khách, khung giờ

Trạng thái: spec chờ duyệt (2026-10-12). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Mockup: [`plans/mockups/ordering-o14-price-lists.html`](../plans/mockups/ordering-o14-price-lists.html).
Kế hoạch thực hiện (gồm đặc tả màn hình L1–L3): [`plans/ordering-o14-price-lists.md`](../plans/ordering-o14-price-lists.md).
Thiết kế: contracts §20.1 (`catalog-price` có điều kiện), reference U14.

## Goal

Quán đặt giá khác nhau theo kênh (online giao / tự lấy / tại bàn / đơn hộ), theo nhóm khách (thành viên, nhân viên, khách
sỉ), theo khung giờ và ngày trong tuần (happy hour), và giảm hàng loạt theo danh mục trong một khoảng thời gian — không
phải sửa giá từng món. Giá luôn chọn ở server, đơn lưu giá lúc đặt.

## Điều kiện bắt đầu

- O11 đã merge (nhóm khách cần hồ sơ khách). Phần kênh và khung giờ làm được trước O11.

## Scope

- **Lõi đã có:** `catalog-price` (rule `locationRef`, `channel`, `customerGroup`, `validFrom/To`, `priority`, `minQuantity`)
  + `domain/catalog/price-selection.ts` (rule khớp hết, nhiều rule thắng). O14 nối và mở rộng, không viết lại.
- **Kênh chuẩn:** `pickup`, `delivery`, `dine-in`, `staff` (đơn hộ) — truyền đúng vào chọn giá ở quote/create/catalog
  công khai (thay `web-checkout`/`phone-staff` hiện có).
- **Nhóm khách:** bảng `customer-group` (mã, tên), gán khách vào nhóm (tay hoặc theo điều kiện đơn giản: tổng chi ≥ X, số
  đơn ≥ N — job cập nhật hằng ngày); phiên khách O11 → `customerGroup` khi tính giá.
- **Khung giờ:** rule mới `weekdays` + `timeRanges` (giờ chi nhánh) trên dòng giá.
- **Bảng giá (price list):** nhóm nhiều dòng giá có chung điều kiện (kênh/nhóm/chi nhánh/thời gian/khung giờ), kiểu
  `override` (giá cố định từng món) hoặc `adjust` (giảm %/số tiền theo danh mục/món chọn); bật/tắt cả bảng; xem trước giá
  cuối của một món theo ngữ cảnh.
- **Hiển thị:** catalog công khai trả giá theo ngữ cảnh (kênh, chi nhánh, giờ, khách đăng nhập) + giá gạch (`compareAtAmount`).
- **Quan hệ với O8:** bảng giá đổi **giá niêm yết** của món; khuyến mãi O8 áp **sau** trên giá đó.

## Non-goals

- Đa tiền tệ; giá theo số lượng bậc thang phức tạp (giữ `minQuantity` hiện có); giá theo từng khách riêng lẻ; hợp đồng B2B.

## Acceptance

### Automated

```powershell
pnpm run lint; pnpm run typecheck; pnpm run test     # price-selection mở rộng (weekday/timeRange, list adjust)
pnpm run check:ordering     # thêm price-lists
pnpm run check:phase3       # DB test, plugin tắt và bật
pnpm exec strapi build      # plugin tắt và bật
```

Test bắt buộc:

- Kênh: cùng món, giá giao ≠ giá tự lấy ≠ tại bàn; quote = create; catalog công khai đúng theo `receiveKind` truy vấn.
- Nhóm khách: khách nhóm "thanh-vien" thấy giá nhóm khi đăng nhập; vãng lai thấy giá thường; đổi nhóm không đổi đơn cũ.
- Khung giờ: 14:00–17:00 thứ 2–6 giảm 20% danh mục Đồ uống; đơn hẹn giờ lấy giá theo **thời điểm đặt** (quyết định bên dưới);
  qua nửa đêm; giờ chi nhánh.
- Bảng giá `adjust` không làm giá âm; nhiều bảng cùng khớp → theo `priority`, rồi giá thấp hơn; tắt bảng → về giá thường.
- Khuyến mãi O8 tính trên giá sau bảng giá; hủy món hoàn đúng.

### Manual UAT

- [ ] Tạo "Happy hour đồ uống −20% 14–17h T2–T6", đặt đơn lúc 15:00 và 18:00, so giá.
- [ ] Giá giao cao hơn tự lấy 5.000đ cho 10 món; kiểm trên web/quote.
- [ ] Nhóm "Nhân viên" −30%, khách trong nhóm đăng nhập đặt đơn.

## Rollback

Tắt bảng giá → giá thường. Nhóm khách giữ lại. Đơn cũ giữ giá đã lưu.

## Rủi ro

- Nhiều bảng chồng nhau làm quán khó hiểu giá → màn xem trước "giá cuối và vì sao" (bảng nào thắng).
- Đơn hẹn giờ: chọn thời điểm áp giá (đặt hay nhận) phải rõ trên web.
