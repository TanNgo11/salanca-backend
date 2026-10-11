# O3a — API đặt hàng (storefront)

## 1. Mục tiêu

Website (bộ storefront mặc định hoặc UI riêng) đặt được đơn tự đến lấy, trả tiền mặt khi lấy hoặc chờ thanh
toán (O4); khách tra cứu được đơn. Quán cấu hình chi nhánh, giờ nhận đơn, đặt trước, tạm ngưng nhận đơn.

## 2. Trạng thái

📝 **Có spec cũ (O3, bước storefront), cần sửa theo quyết định 2026-10-11.** Chưa code. Cần OF xong.

## 3. Input / Output

Đường dẫn thật dưới `/api/v1/ordering/...`. Mọi route công khai `auth: false`, có rate limit, giới hạn body, từ
chối field lạ, validate bằng schema ở server.

| Route | Input | Output | Lỗi chuẩn |
| --- | --- | --- | --- |
| `GET /branches` | `locale` | chi nhánh đang bán online: code, tên, địa chỉ, SĐT, cách nhận đang bật, **đang tạm ngưng tới HH:mm** | — |
| `GET /config` | `branch`, `locale` | giờ mở, ngày nghỉ, ASAP/đặt trước, thời gian chuẩn bị, đặt trước tối đa N ngày, phương thức thanh toán + `presentation`, đơn tối thiểu, phiên bản chính sách | `LOCATION_UNAVAILABLE` |
| `GET /slots` | `branch`, `receive`, `date` | danh sách khung giờ: giờ, còn chỗ / hết chỗ | `LOCATION_UNAVAILABLE` |
| `POST /quote` | dòng hàng (ref, biến thể, tùy chọn, số lượng, ghi chú), chi nhánh, cách nhận, slot | giá từng dòng, tạm tính, phí, giảm giá, tổng, **thời gian chuẩn bị tối thiểu áp dụng** (theo rule), cảnh báo món không còn bán | `SELLABLE_UNAVAILABLE`, `SLOT_TOO_EARLY`, `MIXED_WORKFLOW_UNSUPPORTED` |
| `POST /orders` | như quote + liên hệ (tên, SĐT bắt buộc, email tùy chọn), `customerNote`, `consent`, `captchaToken`, header `Idempotency-Key`; **giá do client gửi bị bỏ qua** | mã đơn, `publicToken` (trả lại cùng token khi replay), trạng thái, cách thanh toán + dữ liệu hiển thị | `PRICE_CHANGED`, `SLOT_TOO_EARLY`, `SLOT_FULL`, `LOCATION_UNAVAILABLE`, `ORDERING_PAUSED`, `CONSENT_REQUIRED`, `CAPTCHA_FAILED`, `TOO_MANY_PENDING_ORDERS`, `IDEMPOTENCY_PAYLOAD_MISMATCH`, 429 |
| `GET /orders` | header `X-Order-Token` | chi tiết đơn của chính token đó: món, bước công khai, giờ lấy, thanh toán | `ORDER_TOKEN_INVALID` |
| `POST /orders/cancel` | header `X-Order-Token`, lý do | đơn đã hủy (chỉ khi mọi group ở bước `customerCancellable` và trước hạn tự hủy) | `CANCEL_NOT_ALLOWED` |
| `POST /orders/lookup` | `code`, `phone`, `captchaToken` | **chỉ trạng thái**: mã, bước công khai, giờ lấy, chi nhánh, tổng, trạng thái thanh toán; không có tên/SĐT/địa chỉ/ghi chú | `ORDER_LOOKUP_FAILED` (chung cho sai mã và sai SĐT), 429 |

**Admin:** màn **Chi nhánh** (thông tin, bật bán online, timezone, giờ mở nhiều ca, ngày nghỉ, giờ chốt ngày,
cách nhận, thời điểm trả tiền, phương thức thanh toán); **Cài đặt nhận đơn** (mục 11.1 `highlevel.md`); nút
**Tạm ngưng nhận đơn** (15/30/60 phút / hết ngày, tự mở lại).

**Sự kiện outbox:** `order.placed`, `order.cancelled-by-customer`.

**Provider:** `CaptchaProvider` Turnstile; `PaymentProvider` tiền mặt (`presentation: offline`);
`SchedulingProvider` theo giờ mở.

## 4. Đã làm

Lõi tạo đơn, idempotency, giữ slot, scope, ngày kinh doanh có từ O1. CORS cho 2 header và body gốc có từ O0.

## 5. Chưa làm

1. Content type/settings chi nhánh + màn Chi nhánh.
2. `SchedulingProvider`: slot theo giờ chi nhánh, ngày nghỉ, sức chứa, giữ slot có hạn.
3. **Rule đặt trước có điều kiện** (số suất ≥ X, giá trị ≥ Y, món có tag → tối thiểu Z giờ); lấy giá trị lớn
   nhất giữa chi nhánh, món và rule.
4. **Tạm ngưng nhận đơn** có hạn.
5. 3 workflow tự lấy có version (`prepay`, `accept-then-pay`, `pay-on-pickup`); O3a chạy hết được `pay-on-pickup`.
6. Provider tiền mặt, captcha Turnstile.
7. 8 route trên; chuẩn hóa SĐT Việt Nam về E.164; consent snapshot.
8. Token replay mã hóa bằng keyring (OF).
9. **Giới hạn số đơn chưa trả theo SĐT** (chống đơn ảo).
10. Ghi route công khai vào `docs/security-baseline.md`.

## 6. Lỗi dự kiến và cách chặn

| Rủi ro | Cách chặn |
| --- | --- |
| Client sửa giá | Server tính lại toàn bộ; so với quote, lệch → `PRICE_CHANGED` |
| 2 khách giành slot cuối | Giữ slot trong transaction, khóa dòng; test 2 request song song |
| Bấm "Đặt hàng" 2 lần / rớt mạng | `Idempotency-Key` bắt buộc; replay trả cùng đơn + cùng token |
| Dò mã đơn qua tra cứu | Lỗi chung `ORDER_LOOKUP_FAILED`, captcha, rate limit theo IP và theo mã |
| Token lọt vào log | Token chỉ ở header và fragment `#t=`, không ở path/query |
| N+1 khi quote nhiều dòng | Nạp catalog theo lô cho mọi dòng |
| Rate limit trong process sai khi chạy nhiều instance | Ghi rõ v1 chạy 1 instance |

## 7. Edge case

- Slot sớm hơn thời gian chuẩn bị → `SLOT_TOO_EARLY`; đúng biên (bằng) thì được.
- Đơn 25 suất mà rule "≥ 20 suất → 24 giờ" → slot hôm nay bị từ chối, slot ngày mai được.
- Giờ mở qua nửa đêm (18:00–02:00) và slot 01:30; ngày nghỉ lễ; đặt trước vượt N ngày.
- Đang "Tạm ngưng" → `ORDERING_PAUSED`; hết hạn tạm ngưng thì tự nhận lại.
- Ngừng nhận đơn trước giờ đóng cửa N phút.
- Món tạm hết giữa quote và tạo đơn → `SELLABLE_UNAVAILABLE`; giá đổi → `PRICE_CHANGED`.
- Cùng `Idempotency-Key` khác payload → `IDEMPOTENCY_PAYLOAD_MISMATCH`.
- SĐT dạng `0901…`, `+84901…`, `84 901…` → cùng một số; số không hợp lệ → `VALIDATION_ERROR`.
- Tra cứu sai SĐT 6 lần liên tiếp → bị chặn.
- Khách hủy sau khi quán đã nhận → `CANCEL_NOT_ALLOWED`.
- Đổi thời gian chuẩn bị trong cài đặt → chỉ áp cho đơn mới.

## 8. Phần dễ tốn thời gian nhất (dự kiến) và vì sao

**Tính slot và thời gian chuẩn bị.** Lý do: kết hợp nhiều nguồn (giờ mở nhiều ca, qua nửa đêm, timezone chi
nhánh, ngày nghỉ, giờ chốt ngày kinh doanh, sức chứa, slot đang được giữ, rule đặt trước theo điều kiện, ngưng
nhận trước giờ đóng). Lỗi thường chỉ lộ ở biên (nửa đêm, đổi ngày, đúng phút biên) và phụ thuộc giờ hệ thống →
phải viết test dạng bảng với đồng hồ giả, chạy với server UTC.

## 9. Gate / Acceptance

lint, typecheck, test, build, `check:phase3`, `check:ordering`, `scripts/smoke-ordering-pickup.mjs` (quote → tạo
đơn → tra cứu → hủy). UAT: đặt bằng Postman với slot hợp lệ; đổi lead time chỉ ảnh hưởng đơn mới; tạm ngưng
rồi đặt bị từ chối; tra cứu bằng mã + SĐT không thấy tên.

## 10. Tài liệu chi tiết

`docs/phases/phase-ordering-3-pickup-cash.md`, `docs/plans/ordering-o3-pickup-cash.md`, contracts mục 9, 11,
19.5–19.7, 21.1–21.4, 21.9, 21.10.
