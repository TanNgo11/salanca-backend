# VNPay — cổng thanh toán (O13)

Provider code: `vnpay`. Loại: payment provider (`wallet`). **Tắt mặc định**.

## Nguồn tài liệu chính thức

- Tài liệu tích hợp "thanh toán PAY": <https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html> (đọc 2026-10-13)
- Bảng mã lỗi: <https://sandbox.vnpayment.vn/apis/docs/bang-ma-loi/> (đọc 2026-10-13)
- Phiên bản API: **2.1.0** (`vnp_Version=2.1.0`)

## Môi trường

| Môi trường | Pay URL | Query/Refund API |
| --- | --- | --- |
| Sandbox | `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html` | `https://sandbox.vnpayment.vn/merchant_webapi/api/transaction` |
| Production | `https://payment.vnpayment.vn/...` (theo hợp đồng) | tương tự, domain production |

`VNPAY_ENVIRONMENT` (`sandbox` mặc định) chọn cặp URL; `VNPAY_BASE_URL` ghi đè (test giả lập).

## Checksum

- Thuật toán: **HMAC-SHA512** hex với `vnp_HashSecret` (cấu hình cũ chấp nhận SHA256 — adapter dùng HMACSHA512 theo khuyến nghị hiện tại).
- Pay URL + IPN verify: chuỗi ký là `k=v&...` của **mọi tham số `vnp_*` trừ `vnp_SecureHash`/`vnp_SecureHashType`**, sort theo key tăng dần. Giá trị tham gia ký ở dạng **đã decode** (theo mã mẫu chính thức `qs.stringify(params, {encode:false})`); URL thanh toán encode từng giá trị bằng `encodeURIComponent`.
- `querydr`/`refund` ký trên chuỗi **pipe-separated** theo thứ tự tài liệu:
  `vnp_RequestId|vnp_Version|vnp_Command|vnp_TmnCode|vnp_TxnRef|vnp_TransactionDate|vnp_CreateDate|vnp_IpAddr|vnp_OrderInfo` (querydr) và refund thêm `vnp_TransactionType|vnp_Amount|vnp_TransactionNo|vnp_CreateBy` theo thứ tự tài liệu.
- `vnp_Amount` = số tiền **× 100** (khử phần thập phân). `vnp_CreateDate`/`vnp_PayDate`/`vnp_TransactionDate` dạng `yyyyMMddHHmmss` giờ GMT+7.

## Luồng

1. `initiate` → build pay URL đã ký; khách redirect sang VNPay. `vnp_TxnRef` = `providerReference` của phiên (`<orderCode>-<paymentId>`).
2. **Return URL** (`vnp_ReturnUrl` → `GET /api/v1/ordering/payments/return/vnpay`) chỉ hiển thị — **không ghi nhận tiền** từ tham số URL.
3. **IPN** (`GET /api/v1/ordering/webhooks/vnpay`): verify checksum → trả JSON `{RspCode, Message}`:
   - `00` Confirm Success — ghi nhận/capture.
   - `01` Order not found — `vnp_TxnRef` không khớp phiên.
   - `02` Order already confirmed — idempotent replay.
   - `04` Invalid amount — lệch `vnp_Amount` vs `requestedAmount`.
   - `97` Invalid Checksum — chữ ký sai.
   - `99` Unknown error — lỗi khác.
   Thành công cần `vnp_ResponseCode=00` **và** `vnp_TransactionStatus=00`; các mã khác (vd `07` nghi ngờ, `24` khách hủy) → đánh dấu thất bại.
4. `querydr` (`vnp_Command=querydr`) — job `wallet-status-check` hỏi trạng thái khi IPN trễ.
5. `refund` (`vnp_Command=refund`, `vnp_TransactionType=02` full / `03` partial) — `vnp_ResponseCode=00` → settled; `94` trùng trong 5 phút → xem như đã nhận (idempotent bằng `vnp_RequestId`).

## Rate limit / IP nguồn

- `querydr`/`refund` giới hạn **1 request / 5 phút cho cùng nội dung** (mã `94`) — job query phải idempotent theo tham chiếu, không spam.
- VNPay không công bố IP nguồn IPN cố định → bắt buộc checksum.

## Env / cấu hình

`VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` (bắt buộc khi bật); `VNPAY_ENVIRONMENT`, `VNPAY_BASE_URL`, `VNPAY_LOCALE` (mặc định `vn`), `VNPAY_ORDER_TYPE` (mặc định `other`), `VNPAY_CREATE_BY` (tên hiển thị khi refund, mặc định `ordering`).

## Ghi chú chưa đối chiếu sandbox

- Quy ước encode trong chuỗi ký IPN theo mã mẫu chính thức (giá trị đã decode). Nếu UAT sandbox báo `RspCode=97` sai lệch, kiểm tra lại quy ước encode trước khi đổi code.
