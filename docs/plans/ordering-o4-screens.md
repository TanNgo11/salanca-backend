# O4 — Đặc tả màn hình (chuyển khoản SePay)

Ngày: 2026-10-10. Bổ sung cho spec [`phases/phase-ordering-4-sepay.md`](../phases/phase-ordering-4-sepay.md),
kế hoạch [`ordering-o4-sepay.md`](ordering-o4-sepay.md), mockup [`mockups/ordering-o4-sepay.html`](mockups/ordering-o4-sepay.html).
Nghiên cứu: [`ordering-reference.md` mục U4](ordering-reference.md). **Quy ước chung** (route, quyền ở service,
bản dịch, 5 trạng thái, định dạng tiền/giờ, component) như mục đầu của
[`ordering-o3-screens.md`](ordering-o3-screens.md).

Đổi khi code O4:

- Route Admin không có đoạn `/admin` (giống O3): `/ordering/payment-reviews`.
- Chuỗi mới nằm trong `admin/src/translations/o4.ts` (`[vi, en]`), gộp lúc `registerTrads`.
- Trong `Modal` không dùng `Combobox`, `SingleSelect` hay `SimpleMenu` (O3: dropdown trong modal làm treo trang).
  P3 chọn cách xử lý và đơn bằng nút + ô chữ. Lọc ở danh sách (ngoài modal) vẫn dùng `SingleSelect`.

## P1. Khối thanh toán trong chi tiết đơn (mở rộng S4 của O3)

Theo Saleor `OrderTransactionTile`.

- Mỗi `payment` là một dòng (tiêu đề phương thức · người ghi · giờ, số đã thu). Card đủ "Cần thu · Đã thu · Đã hoàn ·
  Còn thiếu" chưa làm.
- Dưới dòng payment: sự kiện (`paymentEvents`) — loại, mã giao dịch đã che, số tiền. Ghi tay có badge "Chờ đối soát" /
  "Đã đối soát". API không trả mã đầy đủ và không trả payload gốc.
- Thao tác ghi tay nằm ở menu header của trang (ngoài modal), quyền `payment.review`. Hoàn tiền (P5) và sao chép link
  (P6) làm ở bước sau.
- Quyền xem payload gốc (`payment.raw-read`): nút "Xem dữ liệu gốc" mở `Modal` JSON chỉ đọc; không có quyền thì ẩn.

## P2. Duyệt chuyển khoản (danh sách)

- Route: `/plugins/ordering/payment-review`; menu "Bán hàng" thêm mục "Duyệt chuyển khoản" có badge số chờ.
- Quyền: `payment.review`. Lọc theo scope: tiền vào tài khoản của chi nhánh trong scope; tiền không xác định chi nhánh
  chỉ hiện với `allLocations`.
- API: `GET /ordering/payment-reviews?status=open|resolved&reason=&branch=&from=&to=&q=&page=`
  → `{ results, pagination, counts }`.

Bố cục: header + nút **Ghi nhận chuyển khoản thủ công** (mở P4); hai nút Chờ xử lý (n) · Đã xử lý; lọc lý do, chi nhánh,
khoảng ngày, tìm theo nội dung/mã giao dịch/số tiền.

| Cột | Nội dung |
| --- | --- |
| Thời gian | giờ tiền vào (giờ chi nhánh) |
| Số tiền | căn phải |
| Nội dung CK | nguyên văn, cắt 40 ký tự, tooltip đầy đủ |
| Tài khoản nhận | số TK che + chi nhánh |
| Lý do | `Badge`: Không có mã · Sai mã · Chuyển thiếu · Chuyển dư · Đơn đã hủy · Đã trả rồi · Sai tài khoản |
| Gợi ý | đơn tìm được từ mã (nếu có) + số cần thu |
| (thao tác) | nút **Xử lý** → P3 |

Tab Đã xử lý thêm cột: cách xử lý, người xử lý, lý do ghi, thời điểm.

## P3. Hộp thoại xử lý một giao dịch

`Modal` lớn. Đầu hộp thoại: số tiền, nội dung, thời gian, mã giao dịch, lý do vào hàng duyệt. Bốn nút chọn cách xử lý (không dùng tab/dropdown trong modal):

| Tab | Field | API | Quy tắc |
| --- | --- | --- | --- |
| Gán vào đơn | ô chữ + nút kết quả tìm đơn (mã hoặc SĐT đủ), hiện cần thu; xem trước: "Ghi nhận X đ, còn thiếu Y đ" hoặc "Dư Z đ → cần hoàn" | `POST /ordering/payment-reviews/:id/assign { orderId, reason }` | đủ tiền thì đơn chạy bước tiếp như tự động |
| Cần hoàn tiền | số tiền hoàn (mặc định toàn bộ), lý do | `.../refund-due { amount, reason }` | tạo refund thủ công chờ ghi mã (P5b) |
| Mở lại đơn | đơn đã hủy được gợi ý; kiểm còn hàng/slot | `.../reopen { orderId, reason }` | chỉ với lý do "Đơn đã hủy"; hết hàng thì nút disabled kèm lý do |
| Bỏ qua | lý do (vd. chuyển khoản nội bộ) | `.../ignore { reason }` | |

- Lý do bắt buộc ở mọi tab (`Textarea`, ≥ 5 ký tự).
- Người khác vừa xử lý (`REVIEW_ALREADY_RESOLVED`) → thông báo và đóng, tải lại danh sách.

## P4. Ghi nhận chuyển khoản thủ công

Theo Vendure `add-manual-payment-dialog` + Saleor "Manual transaction".

| Field | Kiểu | Quy tắc |
| --- | --- | --- |
| Đơn | ô chữ + nút kết quả (điền sẵn khi mở từ P1; không dùng Combobox trong modal) | trong scope |
| Mã giao dịch ngân hàng * | `TextInput` | unique trong hệ thống |
| Số tiền * | `NumberInput` đ | > 0 |
| Thời điểm chuyển | `DateTimePicker` | mặc định bây giờ |
| Ghi chú | `Textarea` | |

API `POST /ordering/orders/:id/manual-payments`. Sau khi lưu, sự kiện hiện badge "Chờ đối soát" tới khi SePay
gửi giao dịch cùng mã (khi đó badge thành "Đã đối soát").

## P5. Hoàn tiền (chuyển khoản)

Theo TastyIgniter refund + Vendure `settle-refund-dialog`.

- P5a tạo: `Toggle` Toàn phần / Một phần; số tiền (khi một phần, hiện "tối đa X đ"); lý do *; API
  `POST /ordering/orders/:id/refunds { method: 'bank', amount, reason }` → refund trạng thái "Chờ chuyển".
- P5b ghi nhận đã chuyển: mã giao dịch hoàn *, thời điểm; API `POST /ordering/refunds/:id/settle`. Refund chưa
  ghi mã hiện trong P1 với nút "Ghi nhận đã hoàn".

## P6. Sao chép link thanh toán

Theo Medusa `copy-payment-link`. Nút trong P1 và trong chi tiết đơn nháp đã xác nhận. Bấm → copy link, đổi chữ thành
"Đã sao chép" 2 giây. Link hết hạn theo `paymentTimeoutMinutes`; nút hiện "Hết hạn — tạo link mới" khi quá hạn
(`POST /ordering/orders/:id/payment-link`).

## P7. Trang QR phía khách

Thuộc web (OW) nhưng dữ liệu do O4 cung cấp: `GET /api/v1/ordering/orders/payment` (header `X-Order-Token`) →
`{ qrUrl, bankName, accountNumber, accountName, amount, memo, expiresAt, status }`. Trang hiện QR, số tiền, nội dung
chuyển khoản (nút sao chép từng dòng), đồng hồ đếm ngược, trạng thái tự cập nhật (polling có backoff 3 → 5 → 10 giây,
dừng khi đã trả hoặc hết hạn). Hết hạn: "Đơn đã hết hạn thanh toán", không còn QR.

## P8. Cấu hình SePay theo chi nhánh

Trong S7 (Chi nhánh) tab "Thanh toán": tài khoản nhận (chọn từ danh sách tài khoản khai trong config app, chỉ đọc số
TK), mẫu nội dung chuyển khoản (`SLC{orderCode}`, chỉ đọc nếu khai trong config), chế độ `Toggle` Tự ghi nhận / Duyệt
hết, sai lệch cho phép (đ). Secret không bao giờ hiển thị.
