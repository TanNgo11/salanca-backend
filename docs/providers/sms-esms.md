# eSMS.vn — SMS brandname/OTP (O13)

Provider code: `esms` (channel `sms`). Loại: notification provider. **Tắt mặc định**.

## Nguồn tài liệu chính thức

- Send OTP/CSKH (POST JSON): <https://developers.esms.vn/en/esms-api/send-sms-api/send-otp-customer-care-message> (đọc 2026-10-13)
- Tin cố định giá rẻ (SmsType 8): <https://developers.esms.vn/esms-api/ham-gui-tin/tin-sms-co-dinh-gia-re> (đọc 2026-10-13)

## Endpoint

`POST https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/` — Content-Type `application/json`.

Body: `{ ApiKey, SecretKey, Phone, Content, Brandname, SmsType, IsUnicode, Sandbox, campaignid?, RequestId, CallbackUrl? }`.

- `Phone`: số đầu `0` hoặc `84` đều nhận; adapter gửi dạng `84xxxxxxxxx` (chuẩn hóa nội bộ E.164 → bỏ `+`).
- `SmsType`: `2` = CSKH brandname; `8` = cố định giá rẻ (không brandname, nội dung cố định số); `4` OTP… — cấu hình `ESMS_SMS_TYPE` (mặc định `2`). Loại brandname cần `Brandname` đã đăng ký.
- `IsUnicode`: `0` không dấu / `1` có dấu — cấu hình `ESMS_IS_UNICODE` (mặc định `1` vì tin Việt).
- `Sandbox`: `1` test (không gửi thật, không tính phí); `0` gửi thật. Cấu hình `ESMS_SANDBOX`.
- `RequestId` ≤50 ký tự, chặn trùng **24h**: adapter gửi `nd-<deliveryRowId>` — retry cùng id.
- `CallbackUrl`: callback trạng thái cuối — để trống trong O13 (không đăng ký nhận).

## Response

`CodeResult` là chuỗi:

| Mã | Nghĩa |
| --- | --- |
| `100` | thành công — response kèm `SMSID` dùng đối soát (`providerMessageId`) |
| `101` | sai ApiKey/SecretKey |
| `104` | Brandname sai/chưa active |
| `124` | `RequestId` đã tồn tại (trùng trong 24h) — xem như đã nhận, không resend |
| `146` | loại tin lỗi / nội dung không hợp lệ |
| `99` | lỗi khác |

`CodeResult=100` chỉ khẳng định eSMS **nhận** request, không phải đã tới máy khách — trạng thái cuối cần `CallbackUrl` (để sau).

## Rate limit / giới hạn

- Tài liệu ghi: cùng SĐT + cùng Content chỉ gửi **1 tin / 5 phút** (chặn trùng phía eSMS). OTP cần chèn mã vào content để khác nhau giữa các lần.
- Kênh SMS đi qua `notifications.dailyLimit` chung của lõi (mặc định 2000/ngày, cấu hình được trong Admin P3).

## Env / cấu hình

Bắt buộc khi bật: `ESMS_API_KEY`, `ESMS_SECRET_KEY`, `ESMS_BRANDNAME` (trừ khi `ESMS_SMS_TYPE=8`).
Tùy chọn: `ESMS_SMS_TYPE` (`2`), `ESMS_IS_UNICODE` (`1`), `ESMS_SANDBOX` (`0`), `ESMS_BASE_URL` (mặc định `https://rest.esms.vn` — test giả lập ghi đè), `ESMS_CAMPAIGN`.

## Ghi chú

- Không chữ ký request — bảo mật là `ApiKey`+`SecretKey` trong body; không log body.
- Không lưu số điện thoại trong bảng gửi — `recipientHash` SHA-256; `providerMessageId` giữ `SMSID`.
