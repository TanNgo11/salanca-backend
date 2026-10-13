# MoMo — ví điện tử (O13)

Provider code: `momo`. Loại: payment provider (`wallet`). **Tắt mặc định** — chỉ đăng ký khi cấu hình đầy đủ.

## Nguồn tài liệu chính thức

- Tài liệu AIO v2: <https://developers.momo.vn/v3/docs/payment/guides/payment-with-aio/> (đọc 2026-10-13)
- Bảng chữ ký/tham số theo endpoint: <https://developers.momo.vn/v3/vi/docs/payment/api/wallet/> (đọc 2026-10-13)
- Test instructions / sandbox: <https://developers.momo.vn/v3/docs/payment/onboarding/test-instructions/> (đọc 2026-10-13)
- API version: **AIO v2** (`/v2/gateway/api/*`)

## Môi trường

| Môi trường | Base URL |
| --- | --- |
| Sandbox | `https://test-payment.momo.vn` |
| Production | `https://payment.momo.vn` |

Chọn qua `MOMO_ENVIRONMENT` (`sandbox`|`production`) hoặc ghi đè trực tiếp `MOMO_BASE_URL`.

## Chữ ký (signature)

Mọi request/response ký **HMAC-SHA256 hex** với `secretKey` trên chuỗi `key=value&key=value` ghép đúng **thứ tự field cố định** (không sort từ điển):

| Endpoint | Trường ký (đúng thứ tự) |
| --- | --- |
| `create` | `accessKey&amount&extraData&ipnUrl&orderId&orderInfo&partnerCode&redirectUrl&requestId&requestType` |
| IPN (verify) | `accessKey&amount&extraData&message&orderId&orderInfo&orderType&partnerCode&payType&requestId&responseTime&resultCode&transId` |
| `query` | `accessKey&orderId&partnerCode&requestId` |
| `refund` | `accessKey&amount&description&orderId&partnerCode&requestId&transId` |

Lưu ý: trường optional vắng mặt vẫn phải xuất hiện trong chuỗi ký dưới dạng `key=` (ví dụ `extraData=`). So sánh chữ ký bằng constant-time.

## Endpoint dùng

| Việc | Endpoint |
| --- | --- |
| Tạo phiên thanh toán | `POST /v2/gateway/api/create` |
| Truy vấn giao dịch | `POST /v2/gateway/api/query` |
| Hoàn tiền | `POST /v2/gateway/api/refund` |

`requestType` dùng `captureWallet` (ví MoMo, auto-capture). Response `create` trả `payUrl`, `deeplink`, `qrCodeUrl` khi `resultCode=0`.

## IPN (webhook)

- MoMo `POST` JSON đến `ipnUrl` khai báo lúc `create` — ta trỏ về `POST /api/v1/ordering/webhooks/momo`.
- Trường bắt buộc trong payload: `orderId`, `requestId`, `amount`, `resultCode`, `transId`, `signature`.
- `resultCode = 0` → thành công; `1006` hủy bởi người dùng, `9000`… và các mã khác → thất bại (ghi nhận `payment failed`, không capture).
- Adapter trả **HTTP 204** cho mọi kết quả hợp lệ (kể cả duplicate/unknown) và 401 khi chữ ký sai — theo khuyến nghị AIO v2 IPN trả `204 No Content`.
- `transId` là idempotency key (`providerTransactionId`); `orderId` mang tham chiếu `reference` về phiên thanh toán của ta.

## Rate limit / IP nguồn

- MoMo không công bố rate limit chính thức cho AIO v2 trong tài liệu mở; client áp timeout 10s và không retry phía adapter (retry là việc của job/outbox).
- Tài liệu không công bố dải IP nguồn IPN → xác thực bằng chữ ký là bắt buộc, không whitelist IP.

## Env / cấu hình

`MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY` (bắt buộc khi bật); `MOMO_ENVIRONMENT` (`sandbox` mặc định), `MOMO_BASE_URL` (ghi đè — dùng trong test giả lập), `MOMO_REQUEST_TYPE` (mặc định `captureWallet`).

## Ghi chú

- Refund trả `resultCode=0` + `transId` mới — trạng thái `settled`; mọi mã khác giữ refund `pending`/`failed` tùy bảng mã.
- `query` trả `resultCode=0` nghĩa là giao dịch thành công — job `wallet-status-check` dùng khi IPN trễ.
