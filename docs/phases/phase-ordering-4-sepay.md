# Phase O4 — Chuyển khoản qua SePay

Trạng thái: spec chờ duyệt (2026-10-10). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Mockup: [`plans/mockups/ordering-o4-sepay.html`](../plans/mockups/ordering-o4-sepay.html).
Kế hoạch thực hiện: [`plans/ordering-o4-sepay.md`](../plans/ordering-o4-sepay.md).
Thiết kế: [`plans/ordering-core-contracts.md`](../plans/ordering-core-contracts.md) (mục 8, 12, 19.1,
19.7); nghiên cứu: reference B5, C10, C11, C20.

## Goal

Khách trả bằng chuyển khoản ngân hàng qua QR; tiền khớp đơn thì tự ghi nhận và đơn chạy tiếp, tiền lệch
thì vào hàng duyệt cho nhân viên; webhook mất vẫn được đối soát bù. Hai workflow `prepay` và
`accept-then-pay` của O3 chạy được trọn vẹn.

## Điều kiện bắt đầu

- O3 đóng.
- Chủ dự án cung cấp tài khoản SePay thử (số tài khoản, API key, webhook secret) hoặc cho dùng tài khoản
  thật với giao dịch nhỏ.

## Scope

- **`PaymentProvider` SePay:**
  - `getPresentation`: QR VietQR (`acc`, `bank`, `amount`, `des`) với memo từ template (ví dụ
    `SLC{orderCode}`), hạn thanh toán.
  - Webhook `POST /ordering/webhooks/sepay`: đọc body gốc (`includeUnparsed`), kiểm HMAC trên
    `{X-SePay-Timestamp}.{raw_body}` bằng `timingSafeEqual`, từ chối timestamp lệch quá 300 giây; không
    có body gốc thì trả lỗi và mở alert, không serialize lại JSON.
  - `webhookAckMode = immediate`: lưu raw event (unique `providerTransactionId`) rồi trả đúng
    `{"success": true}`; sai chữ ký trả lỗi.
  - Bỏ qua `transferType = out`.
  - `listTransactions` qua `GET https://userapi.sepay.vn/v2/transactions` với `since_id`, giới hạn 3
    request/giây.
- **App Salanca:** bật `includeUnparsed: true` cho `strapi::body`; secret qua env
  (`SEPAY_WEBHOOK_SECRET`, API key); Cloudflare không cache/không chặn route webhook.
- **Tự khớp** (mục 19.1): đủ 5 điều kiện thì ghi ledger, cập nhật projection và chuyển bước trong cùng
  transaction; thiếu điều kiện nào thì `needs-review` với `reviewReason`.
- **Tài khoản theo chi nhánh** (mục 19.7): `accounts` theo key, dùng chung hoặc riêng từng chi nhánh;
  tiền vào tài khoản không thuộc chi nhánh của đơn thì `account-mismatch`.
- **Màn hình "Duyệt chuyển khoản"** (quyền `payment.review`, theo scope): gán vào đơn, cần hoàn tiền,
  mở lại đơn, bỏ qua; bắt buộc lý do, khóa dòng, audit, idempotent.
- **Ghi nhận chuyển khoản thủ công** khi webhook không tới; webhook/đối soát tới sau gắn vào cùng event.
- **Job đối soát** mỗi giờ (cấu hình được), claim theo `order-job-lock`; tìm thấy giao dịch chưa có trong
  ledger thì đi qua cùng đường xử lý webhook.
- **Hết hạn thanh toán:** đơn `prepay` quá `paymentTimeoutMinutes` thì hủy, nhả hold; tiền tới sau thì
  `order-closed`.
- **Hoàn tiền chuyển khoản:** refund thủ công (nhân viên chuyển trả ngoài hệ thống, nhập mã giao dịch).
- **`captureMode`:** `auto` (mặc định) hoặc `review-all`.
- **Cảnh báo:** `webhook-failing`, `payment-unmatched`, `manual-payment-unconfirmed`,
  `reconciliation-mismatch`.

## Non-goals

- VNPAY, MoMo (provider sau, cùng contract). Hoàn tiền tự động qua API ngân hàng.

## Acceptance

### Automated

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check:phase3
node scripts/smoke-ordering-sepay.mjs   # mới: webhook ký giả lập → khớp đơn, trên DB riêng
```

Test bắt buộc (contracts mục 17, mục kiểm 6):

- Response đúng `{"success": true}` cho event hợp lệ, trùng, không khớp đơn; lỗi cho sai chữ ký và
  timestamp cũ.
- Webhook trùng `id` không ghi tiền lần hai; `transferType = out` bị bỏ qua.
- Mỗi `reviewReason` (`no-code`, `order-not-found`, `underpaid`, `overpaid`, `order-closed`,
  `already-paid`, `account-mismatch`) ra đúng trạng thái và không đổi đơn.
- Gán tay khi thiếu tiền rồi khách chuyển bù có mã thì tự khớp phần còn lại.
- Ghi tay rồi webhook tới cùng mã tham chiếu không tạo ledger thứ hai.
- Đối soát tìm thấy giao dịch bị lỡ và ghi đúng một lần khi chạy song song 2 process.

### Manual UAT

- [ ] Đặt đơn `prepay`, quét QR, chuyển số nhỏ đúng nội dung → đơn tự sang "chờ quán nhận".
- [ ] Chuyển thiếu, chuyển không ghi mã → hiện ở "Duyệt chuyển khoản"; xử lý từng loại.
- [ ] Tắt route webhook tạm thời, chuyển tiền, bật lại → job đối soát ghi nhận.
- [ ] Đơn `accept-then-pay`: quán nhận → khách nhận QR → chuyển khoản → đơn chạy tiếp.

## Bổ sung sau review (2026-10-10)

- Đường dẫn công khai trong tài liệu này là tương đối; với Salanca chúng nằm dưới `/api/v1` (contracts 21.7).
- URL webhook khai cho SePay: `https://<domain cms>/api/v1/ordering/webhooks/sepay` (21.7).
- Nút "Sao chép link thanh toán" cho đơn nhân viên tạo; nhân viên tự gửi qua Zalo/SMS (21.3).
- Hủy một phần món của đơn đã chuyển khoản: hoàn tiền thủ công theo số đã phân bổ (21.5).
- Webhook và route đối soát ghi vào `docs/security-baseline.md` (21.8); duyệt chuyển khoản ghi
  `admin-change-log` (21.6).

## Rollback

Tắt provider `sepay` trong config (đơn mới chỉ còn tiền mặt); raw event và ledger giữ nguyên để đối soát.

## Rủi ro

- `includeUnparsed` giữ thêm bản body trong bộ nhớ cho mọi request: đo ở O0, giới hạn bằng `jsonLimit`
  hiện có.
- Lịch retry và hành vi thật của SePay chỉ kiểm được bằng tài khoản thật.
