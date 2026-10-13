# O11 — Đặc tả màn hình (khách hàng, giỏ, quyền dữ liệu)

Ngày: 2026-10-12. Bổ sung cho spec [`phases/phase-ordering-11-customers-cart.md`](../phases/phase-ordering-11-customers-cart.md),
kế hoạch [`ordering-o11-customers-cart.md`](ordering-o11-customers-cart.md), mockup
[`mockups/ordering-o11-customers-cart.html`](mockups/ordering-o11-customers-cart.html). Nghiên cứu: reference U11.
**Quy ước chung** như [`ordering-o3-screens.md`](ordering-o3-screens.md); chuỗi trong `translations/o11.ts`.

## C1. Khách hàng (Vận hành → Khách hàng)

- Route `/plugins/ordering/customers`. Quyền `customer.read` (lọc scope ở server).
- Ô tìm: "Số điện thoại, tên hoặc email" (SĐT chuẩn hóa ở server). Lọc: Đã xác minh / Chưa xác minh, Có đồng ý tiếp thị.
- Bảng: **Khách** (tên hoặc "Chưa có tên"), **SĐT** (che giữa `090•••4567`), **Email** (che), **Số đơn**, **Tổng chi**,
  **Đơn gần nhất**, **Tiếp thị** (`Badge` Đồng ý / —). Bấm → C2.
- Trống: "Chưa có khách. Khách được tạo tự động khi đặt đơn."

## C2. Chi tiết khách

- Route `/plugins/ordering/customers/:id`.
- Đầu trang: tên, `Badge` trạng thái, SĐT che + nút "Hiện số" (quyền `customer.manage`, ghi change-log), email, ngày tạo.
- Thẻ: Số đơn, Tổng chi, TB/đơn, Đơn gần nhất.
- Tab **Đơn** (bảng như S1 rút gọn, link S4), **Địa chỉ** (chỉ đọc), **Đồng ý** (lịch sử đồng ý tiếp thị: lúc, nguồn,
  phiên bản chính sách), **Yêu cầu dữ liệu** (lịch sử).
- Nút: "Sửa tên/ghi chú" (`customer.manage`), "Xuất dữ liệu (JSON)" (`customer.manage`), "Tạo yêu cầu xóa"
  (`customer.erase`, `Dialog` nêu hậu quả: "Ẩn tên, SĐT, email, địa chỉ trên n đơn đã đóng; xóa hồ sơ, địa chỉ, giỏ.
  Số tiền và sổ sách giữ nguyên. Không hoàn tác được.").

## C3. Yêu cầu dữ liệu (Cấu hình → Yêu cầu dữ liệu)

- Route `/plugins/ordering/data-requests`. Quyền `customer.erase`.
- Tab: Mới · Chờ đơn đóng · Đã xử lý · Từ chối. Bảng: Lúc, Loại (Xuất/Xóa), Nguồn (Khách/Quán), Khách (SĐT che), Trạng thái,
  Người xử lý. Thao tác: "Xử lý" (`Dialog` hậu quả như C2), "Từ chối" (lý do bắt buộc). "+ Tạo yêu cầu" (nhập SĐT, loại,
  ghi chú — khi khách yêu cầu qua điện thoại).
- Hạn xử lý gợi ý hiện ở cột "Hạn" (cấu hình, mặc định 72 giờ theo Nghị định 13 — chờ pháp lý xác nhận); quá hạn tô đỏ.

## Phía khách (OW dùng)

- **W1 Đăng nhập:** nhập email (hoặc SĐT khi có SMS/Zalo) → captcha → "Đã gửi mã nếu tài khoản tồn tại" → ô 6 số (tự
  chuyển ô, dán được) → đăng nhập; sai: "Mã không đúng, còn n lần"; hết hạn: "Mã đã hết hạn, gửi lại".
- **W2 Tài khoản:** hồ sơ (tên, email), sổ địa chỉ (thêm/sửa/xóa, đặt mặc định), đồng ý nhận ưu đãi (`Switch`), nút "Tải
  dữ liệu của tôi", "Xóa tài khoản" (2 bước xác nhận).
- **W3 Đơn của tôi:** danh sách đơn, nút "Đặt lại" → giỏ mới; món không còn bán: "2 món không còn bán đã được bỏ".
- **W4 Giỏ:** giỏ đọc từ server (`GET /carts/current`), lỗi theo dòng hiện ngay dưới món ("Hết hôm nay", "Tạm hết",
  "Giá đã đổi: 45.000đ → 50.000đ"); đăng nhập giữa chừng → giỏ được gộp, báo "Đã gộp giỏ trước đó".

## Đã đổi khi code O11 (2026-10-13)

- **C1 filter `status`** nhận `verified|unverified` — map sang enum schema `active|unverified` (`erased`
  luôn bị loại khỏi danh bạ). Truy vấn SĐT chấp nhận cả `09…` và `+84…` — chuẩn hóa rồi so `phoneHash`
  (HMAC), không quét số thô; chuỗi khác ilike tên/email.
- **C2 sổ địa chỉ**: `addresses[].phoneMasked` — SĐT trong địa chỉ cũng che theo cùng quy ước mask;
  nút "Hiện số" chỉ mở SĐT hồ sơ (`POST /customers/:id/reveal-phone`, ghi `customer.reveal-phone`).
- **C2 "Tạo yêu cầu xóa"** gửi `{ customerId }` (documentId) thay vì SĐT — server resolve phoneHash
  sẵn có (hồ sơ chỉ-email dùng hash dẫn xuất từ id); `customerId` ngoài phạm vi chi nhánh → 404 như C2.
- **C3 cột "Hạn"**: `GET /data-requests` trả `deadlineHours` (mặc định 72, `dataRights.deadlineHours`);
  UI tính `requestedAt + deadlineHours` và tô đỏ khi quá hạn ở trạng thái mở. Alert "trễ hạn" vận hành
  trong comment config chưa xây — hàng đợi tự tô đỏ là đủ cho phase này.
- **S4 → C2**: chi tiết đơn trả `order.customer { id, name, phoneMasked, status }` khi đơn gắn hồ sơ —
  hiện một dòng link dưới mục "Khách hàng" dẫn tới `/plugins/ordering/customers/:id`.
- **Menu**: "Khách hàng" vào nhóm **Vận hành**; "Yêu cầu dữ liệu" vào nhóm **Cấu hình** (trước Webhook).
- **OTP chỉ kênh `email`** (`customers.otpChannels`); `sms`/`zalo` đến cùng O13.
- **Reorder** tạo giỏ **mới** (không ghi đè): dòng còn bán được dựng lại kèm `issues[]` cho phần bỏ;
  địa chỉ giao mang theo, khung giờ thì không.
- **Chi tiết kỹ thuật**: cột jsonb đọc qua `strapi.db.connection` trả string — list khách parse
  `marketing_consent` tường minh trước khi đọc `granted`.
