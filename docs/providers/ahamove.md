# Ahamove — hãng giao hàng (O13)

Provider code: `ahamove`. Loại: fulfillment provider (`carrier`). **Tắt mặc định**.

## Nguồn tài liệu chính thức

- API reference (v3): <https://developers.ahamove.com/en/docs/api-reference/order-apis> (đọc 2026-10-13)
- Authenticate token: <https://developers.ahamove.com/en/docs/api-reference/account-apis/authenticate-token> (đọc 2026-10-13)
- Webhook & callback flow: <https://developers.ahamove.com/en/docs/webhook> (đọc 2026-10-13)
- API version: **v3** (`/v3/...`)

## Môi trường

| Môi trường | Base URL |
| --- | --- |
| Staging | `https://partner-apistg.ahamove.com` |
| Production | `https://partner-api.ahamove.com` |

`AHAMOVE_ENVIRONMENT` (`staging` mặc định) hoặc `AHAMOVE_BASE_URL` ghi đè (test giả lập).

## Xác thực

- `POST /v3/accounts/token` `{ mobile, api_key }` → `{ token, refresh_token }`. Token dùng `Authorization: Bearer <token>`; adapter lấy token lazy và cache trong bộ nhớ (mất khi restart → tự lấy lại).
- Cũng chấp nhận `AHAMOVE_TOKEN` cấu hình sẵn — khi có, bỏ qua bước authenticate.

## Endpoint dùng

| Việc | Endpoint |
| --- | --- |
| Báo phí | `POST /v3/orders/estimates` (`services[]` + `path[]`) → `data[*].total_fee` |
| Tạo chuyến | `POST /v3/orders` (`order_time:0`, `path[0]=lấy`, `path[1]=giao`, `service_id`, `payment_method`) |
| Hủy chuyến | `DELETE /v3/orders/{order_id}` body `{comment}` — chỉ hủy được khi trạng thái `IDLE`/`ASSIGNING`/`ACCEPTED`/`CONFIRMING`/`PAYING` |

## Trạng thái chuyến → trạng thái chặng giao nội bộ

| Ahamove | Hành động nội bộ |
| --- | --- |
| `IDLE`, `ASSIGNING` | booking (đang tìm tài xế) |
| `ACCEPTED`, `CONFIRMING`, `PAYING` | đã có tài xế (`booked`) — chặng vẫn `ready` |
| `IN PROCESS` | chuyển `out-for-delivery` qua transition |
| `COMPLETED` | `delivered` qua `completeLeg` |
| `CANCELLED` trước `IN PROCESS` | hủy leg — chặng quay `ready` để gọi xe khác |
| `CANCELLED`/`FAILED` khi đang giao | `failed` (reason `carrier-cancelled`/`carrier-failed`) |

## Webhook

- Ahamove POST JSON về URL ta đăng ký — `POST /api/v1/ordering/webhooks/ahamove`.
- Xác thực: header `apikey` phải trùng `AHAMOVE_WEBHOOK_TOKEN` (so sánh constant-time). Tài liệu hỗ trợ 3 kiểu (`API-KEY`, `BEARER-TOKEN`, `BASIC-AUTH`) — adapter dùng `apikey`.
- Payload: `{ _id, status, sub_status, path[], ... }`; trạng thái giao dịch theo `path[1].status` khi cần chi tiết điểm giao.
- Mọi payload hợp lệ (kể cả trạng thái không quen) trả `200 {success:true}` để Ahamove không retry; sai `apikey` → `401`.
- Ahamove không công bố dải IP nguồn → token header là điểm kiểm duy nhất; giữ bí mật.

## Rate limit

- Không công bố chính thức trong tài liệu mở. Client timeout 10s, response cap 64 KB, không retry trong adapter.

## Env / cấu hình

Bắt buộc khi bật: `AHAMOVE_API_KEY` + (`AHAMOVE_MOBILE` để authenticate hoặc `AHAMOVE_TOKEN` sẵn có) + `AHAMOVE_WEBHOOK_TOKEN`.
Tùy chọn: `AHAMOVE_ENVIRONMENT`, `AHAMOVE_BASE_URL`, `AHAMOVE_NAME` (tên tài khoản đăng ký), `AHAMOVE_SERVICE_ID` (mặc định `SGN-BIKE`), `AHAMOVE_PAYMENT_METHOD` (mặc định `CASH`), `AHAMOVE_REQUESTS` (JSON — vd gói COD/bulky).

## Ghi chú

- Tạo chuyến chỉ khi nhân viên bấm **Gọi xe** (không tự động lúc đặt đơn). Idempotent: bấm hai lần → cùng một `providerReference`.
- `path[1].cod` = số tiền thu hộ = phần còn phải thu của đơn (khi `paymentTiming` trả sau); mặc định 0 cho đơn đã trả.
- Không có tọa độ từ khách: **bỏ hẳn** `lat/lng`, chỉ gửi địa chỉ text (trang Create Order ghi lat/lng "optional but recommended"; cột Required ghi Yes — tài liệu tự mâu thuẫn, đọc 2026-10-14). Không bao giờ gửi `0,0`. Nếu sandbox báo lỗi tọa độ, quote/book trả `DELIVERY_UNAVAILABLE`/`CARRIER_BOOKING_FAILED`, admin vẫn có đường "quán tự giao"; khi đó cần geocode địa chỉ. **Chưa kiểm sandbox.**
- COD chốt lúc gọi xe (`metadata.carrier.codAmount`). `PATCH /v3/orders/<id>` chỉ sửa `cod` được cho dịch vụ OnWheel, một lần, khi `IDLE/ASSIGNING/ACCEPTED` (<https://developers.ahamove.com/en/docs/api-reference/order-apis/update-order-path>, đọc 2026-10-14) — SGN-BIKE không sửa được. Nên: đã gọi xe có COD thì **chặn** mở phiên ví (`cod-trip-booked`), phiên ví đang chờ bị hủy lúc gọi xe (IPN muộn vào hàng duyệt). Chuyển khoản SePay không chặn được: khi xe báo `COMPLETED` mà phần đã trả không-tiền-mặt + COD > tổng đơn → `metadata.codConflict` + change-log `carrier.cod-conflict` để nhân viên hoàn tiền.
- Webhook trạng thái chạy trong transaction, khóa dòng group rồi dòng leg (cùng thứ tự với transition); hai push song song chỉ chuyển trạng thái một lần.
