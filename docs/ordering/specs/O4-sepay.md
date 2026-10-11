# O4 — Chuyển khoản qua SePay và giao dịch bất thường

## 1. Mục tiêu

Khách quét QR có sẵn số tiền và nội dung theo mã đơn; tiền về thì đơn tự chuyển "đã thanh toán". Giao dịch lệch
(thiếu, thừa, sai nội dung, trùng, tới muộn) vào một hàng chờ để nhân viên xử lý. **SePay là plugin riêng**
(`ordering-provider-sepay`), lõi chỉ biết `PaymentProvider`; MoMo, VNPAY, Stripe cắm vào cùng chỗ.

## 2. Trạng thái

📝 **Có spec cũ, cần sửa:** tách SePay khỏi lõi; webhook nhận nhiều secret (xoay key); hàng chờ giao dịch bất
thường là phần **chung của lõi**. Chưa code. Cần OF (registry provider, keyring) và O3a.

## 3. Input / Output

**Provider SePay** (`presentation: 'qr'`, capabilities `webhook`, `reconcile`; **không** có `refund`):

| Hàm | Input | Output |
| --- | --- | --- |
| `createPayment` | đơn, số tiền, hạn | dữ liệu QR VietQR (`acc`, `bank`, `amount`, `des` theo mẫu, vd `SLC{orderCode}`), hạn thanh toán |
| `verifyWebhook` | header + **body gốc** | hợp lệ / không (HMAC trên `{timestamp}.{body}`, lệch > 300 s → từ chối); thử lần lượt mọi secret còn hiệu lực |
| `parseWebhook` | body | giao dịch chuẩn (mã giao dịch, số tiền, nội dung, tài khoản, thời điểm); bỏ `transferType = out` |
| `listTransactions` | `since_id` | giao dịch để đối soát (giới hạn 3 request/giây) |

**Route công khai:** `POST /api/v1/ordering/webhooks/:providerId` (chung cho mọi cổng). Lõi lưu sự kiện thô
(unique theo mã giao dịch) rồi trả `{"success": true}` ngay; xử lý so khớp trong cùng transaction.

**Storefront:** `GET /orders/payment` (header `X-Order-Token`) → QR, số tiền, nội dung, hạn, trạng thái;
web poll có backoff.

**Admin:**
- Màn **"Giao dịch"**: hàng chờ bất thường với lý do (`amount-short`, `amount-over`, `order-not-found`,
  `duplicate`, `order-closed`, `account-mismatch`); thao tác: gán vào đơn, ghi nhận hoàn tay (nhập mã giao dịch
  hoàn), mở lại đơn, bỏ qua — bắt buộc lý do, có audit.
- **Ghi nhận chuyển khoản thủ công** khi webhook không tới; webhook/đối soát tới sau gắn vào cùng giao dịch.
- Đơn do nhân viên tạo: nút **"Sao chép link thanh toán"**.

**Job:** hết hạn thanh toán (đơn `prepay` quá N phút → hủy, nhả slot); đối soát định kỳ (cấu hình được).

**Sự kiện:** `payment.received`, `payment.mismatch`, `order.payment-expired`. **Cảnh báo:** `webhook-failing`,
`payment-unmatched`, `manual-payment-unconfirmed`, `reconciliation-mismatch`.

**Cấu hình (`configSchema`):** số tài khoản, ngân hàng, mẫu nội dung, API key (secret), webhook secret (secret,
nhiều phiên bản), tài khoản theo chi nhánh, `captureMode` (`auto` / `review-all`).

## 4. Đã làm

Sổ thanh toán, chống event trùng, `needs-review` khi không khớp, hoàn tiền có từ O1. Đọc body gốc và từ chối khi
thiếu (`RAW_BODY_UNAVAILABLE`) có từ O0.

## 5. Chưa làm

1. Plugin `ordering-provider-sepay` theo `ProviderManifest` của OF.
2. Route webhook chung + lưu sự kiện thô + trả lời ngay.
3. So khớp 5 điều kiện (mã đơn trong nội dung, số tiền, tài khoản đúng chi nhánh, đơn còn mở, chưa thanh toán).
4. Hàng chờ bất thường + màn Giao dịch.
5. Ghi nhận chuyển khoản thủ công, ghi nhận hoàn tay.
6. Job hết hạn, job đối soát.
7. Link thanh toán cho đơn nhân viên tạo.
8. Cảnh báo; mục webhook trong `security-baseline.md`; Cloudflare không cache/chặn route webhook.
9. Contract test với mẫu phản hồi thật của SePay (dời từ O0).

## 6. Lỗi dự kiến và cách chặn

| Rủi ro | Cách chặn |
| --- | --- |
| Webhook giả | HMAC trên body gốc, `timingSafeEqual`, chặn timestamp cũ |
| Webhook gửi lại nhiều lần | Unique mã giao dịch; lần sau chỉ trả `success` |
| Webhook tới trước khi đơn commit | So khớp lại trong job đối soát; sự kiện `order-not-found` tự gán lại khi đơn có |
| Tiền tới sau khi đơn hết hạn | `order-closed` → hàng chờ, không tự mở lại đơn |
| Khách chuyển 2 lần | Lần 2 `duplicate`/`amount-over` → hàng chờ, nhắc hoàn |
| Đổi webhook secret làm rớt webhook | Nhiều secret cùng lúc trong thời gian chuyển tiếp (OF) |
| Cloudflare chặn/cached webhook | Rule riêng cho route webhook; kiểm trên staging |

## 7. Edge case

- Nội dung chuyển khoản viết thường, có dấu cách, thêm chữ: `slc 000123 thanh toan` vẫn khớp `SLC000123`.
- Chuyển thiếu 1.000đ; thừa 5.000đ; ngưỡng chấp nhận lệch là cài đặt (mặc định 0).
- Một giao dịch chứa 2 mã đơn → hàng chờ.
- Tiền vào tài khoản của chi nhánh khác → `account-mismatch`.
- Webhook thiếu body gốc → lỗi + cảnh báo, không serialize lại JSON.
- Đối soát tìm thấy giao dịch webhook đã bỏ sót → xử lý như webhook, không ghi trùng.
- Nhân viên ghi tay rồi webhook tới → gắn vào cùng giao dịch.

## 8. Phần dễ tốn thời gian nhất (dự kiến) và vì sao

**Test với SePay thật.** Lý do: cần tài khoản ngân hàng + tài khoản SePay thật (chủ quán cung cấp), webhook
phải gọi được tới server công khai (cần staging hoặc tunnel), và mỗi lần thử là một giao dịch tiền thật. Định
dạng nội dung chuyển khoản thật (ngân hàng tự thêm chữ, cắt ngắn) chỉ biết khi chạy thật, nên phần so khớp phải
chỉnh sau khi có dữ liệu thật.

## 9. Gate / Acceptance

lint, typecheck, test, build, `check:ordering` (thêm webhook-signature, webhook-duplicate, match-rules,
payment-expiry, reconcile). UAT: một giao dịch thật số tiền nhỏ trên staging tự xác nhận đơn; chuyển thiếu vào
hàng chờ và gán tay được; đơn quá hạn tự hủy; xoay webhook secret không rớt giao dịch.

## 10. Tài liệu chi tiết

`docs/phases/phase-ordering-4-sepay.md`, `docs/plans/ordering-o4-sepay.md`, `docs/plans/ordering-o4-screens.md`,
contracts mục 8, 19.1, 19.7.
