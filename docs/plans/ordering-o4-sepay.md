# O4 — Chuyển khoản qua SePay: kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt), Claude (thực hiện)
Last updated: 2026-10-10
Related phase: [`phases/phase-ordering-4-sepay.md`](../phases/phase-ordering-4-sepay.md)

Đặc tả màn hình: [`ordering-o4-screens.md`](ordering-o4-screens.md) (reference mục U4). Mọi màn UI làm theo file đó.

## Goal

Khách trả bằng QR chuyển khoản; tiền khớp thì tự ghi nhận, lệch thì vào hàng duyệt; webhook mất thì đối
soát bù; workflow `prepay` và `accept-then-pay` chạy trọn.

## Non-goals

- VNPAY, MoMo; hoàn tiền tự động qua API ngân hàng.

## Current evidence

- O3 xong (workflow trả trước dừng ở bước chờ thanh toán).
- Tài liệu SePay đã kiểm (reference B5, C10, C11): HMAC-SHA256 trên `{timestamp}.{raw_body}`, header
  `X-SePay-Signature: sha256=<hex>` và `X-SePay-Timestamp`, lệch ≤ 300 giây; ACK HTTP 200/201 với body
  đúng `{"success": true}` trong 30 giây; payload có `id`, `gateway`, `transactionDate`, `accountNumber`,
  `subAccount`, `code`, `content`, `transferType`, `transferAmount`, `referenceCode`; đối soát
  `GET https://userapi.sepay.vn/v2/transactions` với `since_id`, tối đa 3 request/giây.
- O0 đã kiểm `includeUnparsed` và cách đọc `Symbol.for('unparsedBody')`.

## Decisions and assumptions

- Decision: luật khớp và lý do duyệt theo contracts mục 19.1; `captureMode` mặc định `auto`.
- Decision: cursor đối soát (`since_id`) lưu trong `strapi.store` của plugin theo từng tài khoản.
- Assumption: chủ dự án cấp tài khoản SePay thử hoặc cho dùng tài khoản thật với giao dịch nhỏ trước UAT.
- Assumption: QR dùng dịch vụ tạo QR động của SePay (`acc`, `bank`, `amount`, `des`); kiểm lại tài liệu
  lúc làm bước 2.

## Invariants

- Không ghi tiền hai lần cho cùng `id` của SePay, kể cả giữa webhook, đối soát và ghi tay.
- Chữ ký luôn kiểm trên body gốc; không có body gốc thì từ chối.
- Webhook lỗi nghiệp vụ vẫn ACK thành công sau khi đã lưu raw event; chỉ sai chữ ký mới trả lỗi.
- Log không chứa tên người chuyển, số tài khoản đầy đủ hay nội dung chuyển khoản thô.

## Implementation steps

1. **Body gốc ở app**
   - Files: `config/middlewares.ts` (+ test): `includeUnparsed: true` cho `strapi::body`; `bootstrap()` của
     plugin báo lỗi rõ khi provider cần chữ ký mà app chưa bật.
   - Verification: test middleware; `pnpm run smoke:reservation-form`, upload media vẫn chạy.
2. **Config và presentation của SePay**
   - Files: `providers/sepay/{config.ts, presentation.ts}`.
   - Làm: zod cho `accounts` (theo key: `accountNumber`, `bankCode`, `subAccount?`, `locationRefs | 'all'`),
     `memoTemplate`, `webhookSecret`, `apiToken`, `captureMode`, `amountTolerance`; QR URL và hạn thanh toán.
   - Verification: Vitest cho config sai; ảnh QR mở được với số tiền và nội dung đúng.
3. **Webhook**
   - Files: `routes/content-api.ts` (`POST /ordering/webhooks/:providerCode`), `controllers/webhook.ts`,
     `providers/sepay/{signature.ts, parse.ts}`.
   - Làm: đọc body gốc, kiểm timestamp và HMAC bằng `timingSafeEqual`, parse thành `NormalizedPaymentEvent`,
     lưu `payment-event` (unique), ghi outbox, trả ACK theo `webhookAckMode`.
   - Verification: Vitest cho chữ ký (đúng, sai 1 byte, thiếu header, timestamp cũ); tích hợp: gửi lại cùng
     `id` → một bản ghi.
4. **Luật khớp (thuần)**
   - Files: `domain/payments/match.ts`, `domain/payments/memo.ts`.
   - Làm: tách mã đơn theo template; 5 điều kiện; trả `auto-matched` hoặc `needs-review` + `reviewReason`.
   - Verification: Vitest dạng bảng cho 7 lý do và trường hợp khớp.
5. **Áp kết quả khớp**
   - Files: `services/payment-matching.ts`.
   - Làm: trong transaction: khóa đơn, ghi ledger, cập nhật projection, transition (`prepay`: chờ thanh toán
     → chờ quán nhận; `accept-then-pay`: chờ thanh toán → chuẩn bị); thiếu tiền ghi một phần.
   - Verification: tích hợp cho cả hai workflow; chuyển bù có mã sau khi gán tay → tự khớp phần còn lại.
6. **Màn hình "Duyệt chuyển khoản"**
   - Files: `routes/admin.ts`, `controllers/payment-review.ts`, `services/payment-review.ts`,
     `admin/src/pages/PaymentReview/`.
   - Làm: danh sách theo scope (tiền không rõ chi nhánh chỉ cho `allLocations`); gán vào đơn, cần hoàn tiền,
     mở lại đơn, bỏ qua; bắt buộc lý do; khóa dòng; audit; idempotent.
   - Verification: script hai người duyệt cùng event → một người thành công; UAT từng thao tác.
7. **Ghi nhận thủ công**
   - Files: `services/manual-payment.ts`, nút trong chi tiết đơn.
   - Làm: event `kind = manual` có mã tham chiếu; webhook/đối soát tới sau cùng mã tham chiếu và số tiền thì
     gắn vào event này.
   - Verification: tích hợp: ghi tay rồi webhook tới → một ledger.
8. **Đối soát**
   - Files: `providers/sepay/client.ts` (giới hạn 3 request/giây, retry khi 429), `jobs/reconciliation.ts`.
   - Làm: chạy mỗi giờ (cấu hình được), claim qua `order-job-lock`, đọc từ `since_id`, đi qua cùng đường xử lý
     webhook.
   - Verification: tích hợp với client giả: giao dịch bị lỡ được ghi đúng một lần khi 2 process cùng chạy.
9. **Hết hạn thanh toán**
   - Files: `jobs/payment-expiry.ts`.
   - Verification: đơn `prepay` quá hạn bị hủy, hold được nhả; tiền tới sau → `order-closed`.
10. **Hoàn tiền chuyển khoản**
    - Files: `services/refund.ts` (mở rộng), nút trong chi tiết đơn.
    - Verification: refund thủ công có mã giao dịch; `paymentStatus` đúng.
11. **Cảnh báo thanh toán**
    - Files: `services/alert.ts` (rule `webhook-failing`, `payment-unmatched`, `manual-payment-unconfirmed`,
      `reconciliation-mismatch`).
    - Verification: tích hợp mỗi rule mở đúng một alert theo key.
12. **Smoke và tài liệu**
    - Files: `scripts/smoke-ordering-sepay.mjs` (webhook ký giả lập), `.env.example` (biến SePay),
      `docs/ordering-payments-runbook.md`, `docs/ordering-api-contract.md` (webhook).

13. **Bổ sung sau review (2026-10-10)** (contracts mục 21)
    - Files: `controllers/admin-orders.ts` (link thanh toán), `services/line-cancel.ts` (hoàn chuyển khoản),
      `docs/security-baseline.md`.
    - Làm: link thanh toán mở trang QR bằng token, có hạn, không cho sửa đơn; hủy một phần đơn đã chuyển
      khoản tạo refund thủ công; ghi webhook vào security baseline.
    - Verification: link hết hạn không mở QR; hủy một phần đơn chuyển khoản → `paymentStatus`
      `partially-refunded` sau khi ghi mã hoàn.

## Data and rollback

- Migration/backfill: không có bảng mới ngoài field đã có ở O1.
- Compatibility: bật `includeUnparsed` cho mọi request (đã đo ở O0).
- Rollback: tắt provider `sepay`; ledger và raw event giữ để đối soát.

## Verification

- Automated: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`,
  `pnpm run check:phase3`, `pnpm run smoke:reservation-form`, `node scripts/smoke-ordering-sepay.mjs`.
- Manual UAT: theo spec O4 với giao dịch thật số tiền nhỏ.
- Evidence to record: Completion record, `docs/STATUS.md`.

## Documentation impact

- `docs/ordering-payments-runbook.md`, `docs/ordering-api-contract.md`, `.env.example`, `docs/STATUS.md`.

## Risks and blockers

- Cần tài khoản SePay để UAT.
- Hành vi retry thật của SePay chỉ kiểm được khi chạy thật.

## Completion record

- Chưa bắt đầu.
