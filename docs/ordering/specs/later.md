# Để sau go-live

Đã chốt với chủ dự án (2026-10-11). Mỗi mục là một provider hoặc module cắm thêm, không sửa lõi.

| Mục | Kiểu | Ghi chú |
| --- | --- | --- |
| Zalo ZNS báo khách | kênh thông báo | Cần Zalo OA đã xác thực, mẫu tin được duyệt trước, tính phí theo tin; dự phòng email. Ước lượng 2–3 ngày code + thời gian duyệt mẫu |
| Telegram báo quán | kênh thông báo | Bot gửi vào nhóm chat của chi nhánh |
| Messenger | kênh thông báo | Khách phải nhắn Page trước; cần luồng liên kết ở trang xác nhận |
| Máy in nhiệt POS | máy in | Cần biết máy của quán (USB / LAN, hãng). USB không driver cần app cầu nối (vd QZ Tray). 2–5 ngày |
| MoMo, VNPAY | thanh toán | `presentation: redirect`, có API hoàn tiền tự động. Cần đăng ký kinh doanh + hợp đồng. 3–5 ngày mỗi cổng |
| Stripe | thanh toán | `presentation: embedded`. Không mở cho doanh nghiệp đăng ký ở Việt Nam |
| Hoàn tiền tự động | thanh toán | Làm cùng lúc tích hợp MoMo/VNPAY; SePay chỉ ghi nhận hoàn tay |
| Danh sách khách theo SĐT + lịch sử | module | Gom đơn theo SĐT đã chuẩn hóa, không cần tài khoản |
| Báo cáo tháng | báo cáo | Biểu đồ theo ngày, so tháng trước, món bán chạy, khung giờ nhiều đơn, xuất Excel |
| Kế hoạch chuẩn bị theo ngày nhận | báo cáo | Gộp số lượng món theo ngày nhận để chuẩn bị nguyên liệu |
| Tồn kho đếm số lượng | module | Tồn theo chi nhánh, giữ hàng, sổ biến động |
| VAT, hóa đơn điện tử | module | Khi kế toán chốt |
| Khuyến mãi, mã giảm giá | module | Dùng `order-adjustment` đã có |
| GHN, Ahamove, Grab | giao hàng | `FulfillmentProvider` mới |
| Tách repo / npm | đóng gói | Khi có khách thứ hai |
| Nhiều instance | hạ tầng | Redis cho SSE và rate limit |
