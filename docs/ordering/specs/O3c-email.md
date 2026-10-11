# O3c — Kênh email

## 1. Mục tiêu

Khách nhận email ở các bước quan trọng của đơn; quán nhận email khi có đơn mới. Email là **kênh đầu tiên** chạy
trên khung thông báo của OF; Zalo, Telegram, Messenger cắm thêm sau theo cùng cách.

## 2. Trạng thái

📝 **Spec cũ chỉ có "email", cần thiết kế lại theo kênh.** Chưa code. Cần OF (khung thông báo) và O3a (sự kiện).

## 3. Input / Output

- **Input:** sự kiện từ outbox: `order.placed`, `payment.received` (O4), `order.accepted`, `order.ready`,
  `order.rejected`, `order.cannot-complete`, `order.cancelled`, `order.delivering` (O5).
- **Quy tắc mặc định:**

| Sự kiện | Khách | Email quán (theo chi nhánh) |
| --- | --- | --- |
| Đặt đơn thành công | ✔ | ✔ |
| Đã thanh toán | ✔ | |
| Quán đã nhận (kèm giờ sẵn sàng) | ✔ | |
| Sẵn sàng / đang giao | ✔ | |
| Bị từ chối / không thể hoàn tất (kèm lý do) | ✔ | |

- **Output:** email HTML + bản text, VI/EN theo locale lúc đặt, có logo, tên, địa chỉ, SĐT quán; link theo dõi
  `#t=<token>`. Nhật ký gửi: thành công / lỗi / đang thử lại; không lưu địa chỉ người nhận trong log.
- **Cấu hình (Admin):** bật/tắt từng ô của ma trận; email nhận báo của từng chi nhánh; thông tin quán trên email;
  sửa nội dung mẫu (tiêu đề, đoạn đầu) theo ngôn ngữ.
- **Provider:** `email-smtp` dùng SMTP hiện có của app (Resend SMTP); `configSchema` gồm host, port, user,
  password (secret), from.

## 4. Đã làm

App đã có gửi email qua SMTP cho form đặt bàn và nhận báo theo loại (Settings → Salanca). Outbox gửi đúng một lần
có từ O1.

## 5. Chưa làm

1. Kênh `email-smtp` implement `NotificationChannel`.
2. Mẫu email theo sự kiện × ngôn ngữ, có thông tin quán.
3. Ma trận quy tắc mặc định + màn cấu hình đơn giản.
4. Nhật ký gửi + nút gửi lại.
5. Thử lại có giới hạn khi SMTP lỗi; kênh dự phòng (khi có kênh khác).

## 6. Lỗi dự kiến và cách chặn

| Rủi ro | Cách chặn |
| --- | --- |
| Gửi trùng khi dispatcher chạy lại | Unique (sự kiện, người nhận, kênh) |
| SMTP chập chờn làm kẹt outbox | Retry có backoff, tối đa N lần, sau đó `failed` + hiện trong nhật ký |
| Lộ email/SĐT trong log | Log chỉ ghi id đơn + kênh + kết quả |
| Email sai ngôn ngữ | Lấy locale lúc đặt từ snapshot đơn |
| Email vào spam | SPF/DKIM của domain gửi (runbook O6) |

## 7. Edge case

- Khách không để email → bỏ qua kênh email của khách, không báo lỗi.
- Đổi nội dung mẫu sau khi đơn đã tạo → email sau dùng mẫu mới (mẫu không thuộc snapshot).
- "Nhận và lùi 20 phút" → email ghi giờ sẵn sàng mới.
- Chi nhánh chưa cấu hình email nhận báo → không gửi cho quán, hiện cảnh báo trong Cài đặt.

## 8. Phần dễ tốn thời gian nhất (dự kiến) và vì sao

**Mẫu email hiển thị đúng trên mọi trình đọc mail** (Gmail, Outlook, app điện thoại). HTML email phải dùng bảng và
CSS inline; mỗi lần sửa phải gửi thử thật (Mailpit + một hộp thư thật) để xem.

## 9. Gate / Acceptance

lint, typecheck, test, build, `check:ordering` (thêm script notification-once). UAT với Mailpit: đặt đơn → email
khách VI và EN đúng ngôn ngữ; email quán khi có đơn mới; từ chối có lý do; chạy lại dispatcher không gửi trùng.

## 10. Tài liệu chi tiết

`highlevel.md` mục 4.8, 5.4, 11.7; contracts mục 12, 14.
