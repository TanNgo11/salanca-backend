# O10 — Đặc tả màn hình (nền mở rộng)

Ngày: 2026-10-12. Bổ sung cho spec [`phases/phase-ordering-10-extensibility.md`](../phases/phase-ordering-10-extensibility.md),
kế hoạch [`ordering-o10-extensibility.md`](ordering-o10-extensibility.md), mockup
[`mockups/ordering-o10-extensibility.html`](mockups/ordering-o10-extensibility.html). Nghiên cứu: reference U10.
**Quy ước chung** như mục đầu của [`ordering-o3-screens.md`](ordering-o3-screens.md); chuỗi trong `translations/o10.ts`.

## X1. Webhook (Cấu hình → Webhook)

- Route `/plugins/ordering/webhooks`. Quyền `webhook.manage`.
- Danh sách: **URL** (cắt giữa, không hiện query string), **Mô tả**, **Sự kiện** (số + `Tooltip` danh sách),
  **24 giờ** (`✓ 120 · ✗ 3`), **Trạng thái** (`Badge` Đang bật / Đã tắt / Tự tắt do lỗi — kèm lý do), `Switch` bật/tắt.
  Nút "+ Thêm webhook".
- Tạo/sửa (trang con, không Modal): URL (`TextInput`, báo lỗi `WEBHOOK_URL_INVALID` theo `reason`: "Chỉ nhận https",
  "Không gửi tới địa chỉ nội bộ", "Không tìm thấy tên miền"), Mô tả, **Sự kiện**: danh sách checkbox nhóm theo đối tượng
  (Đơn hàng, Thanh toán, Hoàn tiền, Giao hàng, Khuyến mãi, Thẻ quà tặng, Đánh giá), mỗi dòng có mô tả + link "Xem payload
  mẫu" (panel JSON); `Checkbox` "Gửi kèm thông tin khách (tên, SĐT, địa chỉ)" — bật hiện `Dialog` cảnh báo dữ liệu cá nhân.
- Sau khi tạo / "Đổi bí mật": khối hiện bí mật **một lần** (`whsec_…`), nút Sao chép, cảnh báo "Chỉ hiện một lần"; ghi
  chú "Bí mật cũ còn dùng được 24 giờ".
- Nút "Gửi thử" → hiện kết quả ngay (mã HTTP, thời gian, lỗi rút gọn).
- Tab **Nhật ký gửi**: lọc trạng thái; bảng: Lúc, Sự kiện, Mã đơn (nếu có), Kết quả (HTTP / lỗi), Lần thử, Lần tới; nút
  "Gửi lại" trên dòng lỗi; bấm dòng → panel payload đã gửi (đã lọc PII nếu endpoint không bật).

## X2. Tài liệu API (Cấu hình → Tài liệu API)

- Route `/plugins/ordering/api-docs`. Quyền `settings.manage`.
- Nội dung tĩnh: link `GET /api/v1/ordering/openapi.json` (sao chép), hướng dẫn mở bằng Swagger Editor/Postman, link
  `docs/ordering-integrations.md` (nếu có trang tài liệu), đoạn mã kiểm chữ ký webhook (Node, PHP) dạng code block.
  Không nhúng Swagger UI (tránh thêm dependency).

## X3. Nhập/xuất menu (Món → Nhập/xuất)

- Route `/plugins/ordering/catalog-import`. Quyền `catalog.manage` (xuất cần thêm `export`).
- Khối **Xuất**: 2 nút "Tải products.csv", "Tải modifiers.csv"; ghi chú "Mở bằng Excel, giữ nguyên dòng tiêu đề".
- Khối **Nhập**: chọn loại (`Radio` Món / Tùy chọn — nhập Tùy chọn trước), chọn file (`input type=file` .csv, ≤ 2 MB) →
  "Kiểm tra" (chạy thử) → báo cáo: thẻ Tạo mới n · Sửa n · Lỗi n; bảng lỗi (Dòng, Cột, Lỗi — "Giá phải ≥ 0", "SKU trùng
  dòng 12", "Không có nhóm tùy chọn SIZE"); có lỗi thì nút Áp dụng tắt. Không lỗi → "Áp dụng" (`Dialog`: "Sẽ tạo n, sửa
  m món. Nên tải bản xuất hiện tại trước."). `CATALOG_IMPORT_STALE` → "Menu vừa thay đổi, kiểm tra lại file".
- Lịch sử nhập (10 lần gần nhất): lúc, người, loại, kết quả.

## X4. Mẫu email (Cài đặt bán hàng → Mẫu email)

- Trong trang Settings (S9) thêm tab "Mẫu email". Quyền `settings.manage`.
- Danh sách mẫu: Tên ("Đơn đã sẵn sàng"), người nhận (Khách/Nhân viên), VI/EN mỗi ngôn ngữ một `Badge` (Mặc định / Đã sửa).
- Sửa (trang con): chọn ngôn ngữ (nút VI/EN), **Tiêu đề** (`TextInput`), **Nội dung** (`Textarea` markdown giới hạn),
  bên phải danh sách **biến** cho phép (bấm để chèn `{{orderCode}}`), xem trước (render server với dữ liệu mẫu, khung
  email). Nút "Lưu", "Gửi thử tới tôi", "Khôi phục mặc định" (`Dialog`). Lỗi `TEMPLATE_VARIABLE_UNKNOWN` tô biến lạ.
