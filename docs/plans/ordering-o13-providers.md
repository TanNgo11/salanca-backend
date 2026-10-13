# O13 — Provider: kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt + cấp tài khoản sandbox), AI thực hiện
Last updated: 2026-10-12
Related phase: [`phases/phase-ordering-13-providers.md`](../phases/phase-ordering-13-providers.md)

Đặc tả màn hình: [`ordering-o13-screens.md`](ordering-o13-screens.md) (P1–P4, reference U13). Mockup:
[`mockups/ordering-o13-providers.html`](mockups/ordering-o13-providers.html).

## Goal

MoMo, VNPay, Ahamove (GHN tùy chọn), Zalo ZNS, SMS — cắm qua contract có sẵn, có đối soát, làm mẫu viết provider.

## Non-goals

- Stripe/thẻ quốc tế, trả góp, ví khác, hãng giao khác, push app, chọn hãng rẻ nhất tự động.

## Current evidence

- `PaymentProvider` (`contracts/payment.ts`): `code`, `capabilities`, `webhookAckMode`, `getPresentation`, `initiate`,
  `capture?`, `cancel?`, `refund?`, `parseWebhook`, `webhookResponse`, `queryTransaction?`, `listTransactions?`.
- SePay là mẫu đầy đủ: `providers/sepay/` (ký webhook, parse, response), `services/webhook.ts` (raw body, chữ ký, đếm lỗi
  → alert), `services/payment-matching.ts` (khớp, chống trùng, hàng duyệt), `jobs/reconciliation.ts`, runbook thanh toán.
- `FulfillmentProvider` (`contracts/fulfillment.ts`): `getOptions`, `validate`, `calculatePrice`, `create` …; mẫu
  `providers/self-delivery.ts`; `services/delivery-assignment.ts` (dispatch với `tracking { carrier, number, url }`,
  markDelivered/markFailed/retry).
- `NotificationProvider` (`contracts/notification.ts`): `send({ recipient, template, data })`; mẫu
  `providers/email-notification.ts`; `services/notification.ts` (`deliver`, dedupe, `notification-delivery`).
- Cấu hình provider qua `config/plugins.ts` + env, schema strict trong `config/index.ts` (SePay: thiếu biến thì không boot).
- Ops O6: trang vận hành có webhook gần nhất theo provider, alert `webhook-failing`.

## Decisions and assumptions

- Decision: **không code đoán**. Với mỗi provider, bước đầu là đọc tài liệu chính thức bản hiện hành, ghi vào
  `docs/providers/<code>.md`: URL tài liệu, phiên bản API, ngày đọc, thuật toán chữ ký, trường bắt buộc, mã kết quả, IP
  nguồn (nếu provider công bố), giới hạn tần suất, môi trường sandbox. Code tham chiếu file đó. Fixture test lấy từ ví dụ
  trong tài liệu chính thức.
- Decision: provider nào chủ dự án chưa có sandbox thì **bỏ khỏi đợt làm** (ghi Completion record), không mock thay.
- Decision: thanh toán ví dùng chung khung SePay: event lưu thô (`payment-event`), khớp theo mã giao dịch của plugin
  (`orderId`/`requestId` provider = `<orderCode>-<paymentId>`), capture một lần, lệch tiền → hàng duyệt O4; return URL
  chỉ hiển thị; `queryTransaction` dùng cho job `wallet-status-check` (mỗi 2 phút cho payment `pending` 2–30 phút tuổi) và
  đối soát hằng ngày nếu có `listTransactions`.
- Decision: hoàn tiền ví gọi API refund của provider; thành công → `settled`; lỗi tạm → thử lại (idempotency key của
  plugin); không hỗ trợ → `pending` như SePay.
- Decision: hãng giao là `FulfillmentProvider` mới (`ahamove`); chi nhánh chọn cho đơn giao: "Quán tự giao" hoặc
  "Ahamove"; khi provider hãng giao bật, quote có thể dùng phí hãng (cấu hình `feeSource: 'zone' | 'carrier'`). Chuyến tạo
  khi nhân viên bấm "Gọi xe" (không tự gọi lúc đặt). Webhook hãng → cập nhật chặng giao qua `delivery-assignment`.
- Decision: thông báo có **kênh** theo mẫu (`notification-channel-rule`: mẫu → danh sách kênh ưu tiên, ví dụ
  `customer.order-ready: [zalo, sms, email]`); gửi kênh đầu khả dụng với khách (có SĐT → zalo/sms; có email → email); lỗi
  kênh → kênh sau; mẫu ZNS lưu `templateId` + map biến cho từng mẫu plugin (Admin P3).
- Decision: bí mật chỉ ở env; Admin chỉ thấy "đã cấu hình / chưa" và 4 ký tự cuối của mã đối tác.
- Owner decision required: chọn nhà cung cấp SMS (eSMS, SpeedSMS, Stringee, VNPT…) và có làm GHN không.
- Owner decision required: phí giao lấy theo vùng (quán quyết) hay theo báo giá hãng.

## Invariants

- Chỉ IPN/webhook có chữ ký hợp lệ (và truy vấn trạng thái chủ động) mới ghi tiền/đổi trạng thái; return URL không bao giờ.
- Mỗi giao dịch provider capture tối đa một lần (khóa theo `providerCode + providerTransactionId`, như SePay).
- Không log bí mật, chữ ký, số thẻ/ví, nội dung tin nhắn đầy đủ (chỉ mã mẫu + 4 số cuối SĐT).
- Hoàn tiền không vượt số đã capture của payment đó.

## Data model

| Bảng / field | Mô tả |
| --- | --- |
| `payment.providerTransactionId` (đã có) | mã giao dịch phía provider |
| `fulfillment.carrierRef`, `carrierStatus`, `carrierFee`, `trackingUrl` (một phần đã có) | mã chuyến, trạng thái hãng, phí thật |
| `notification-delivery.channel` (đã có), `providerMessageId?`, `costEstimate?` | kênh thật đã gửi, mã tin, chi phí ước tính |
| `notification-channel-rule` | `template`, `channels` JSON (thứ tự), `zns` JSON `{ templateId, params: { znsParam: pluginVar } }`, `active` |
| config `providers.payment.momo|vnpay`, `providers.fulfillment.ahamove|ghn`, `providers.notification.zalo|sms` | env → zod strict |

Migration `0011-o13-providers.ts`: cột mới + bảng rule; index `fulfillment(carrier_ref)`.

## API

| Method | Path | Quyền | Mô tả |
| --- | --- | --- | --- |
| POST | `/api/v1/ordering/webhooks/momo` · `/vnpay` (IPN) | public (chữ ký) | phản hồi đúng định dạng provider yêu cầu |
| GET | `/api/v1/ordering/payments/return/:provider` | public | chỉ hiển thị kết quả (redirect về trang đơn web) |
| POST | `/api/v1/ordering/webhooks/ahamove` | public (chữ ký/token theo tài liệu) | trạng thái chuyến |
| POST | `/ordering/orders/:id/carrier/quote` | `order.process` | báo phí hãng cho đơn |
| POST | `/ordering/orders/:id/carrier/book` | `order.process` | gọi xe (idempotent) → `out-for-delivery` khi hãng nhận |
| POST | `/ordering/orders/:id/carrier/cancel` | `order.process` | hủy chuyến |
| GET | `/ordering/providers` | `settings.manage` | trạng thái cấu hình từng provider (không bí mật) |
| GET/PUT | `/ordering/notification-channels` | `settings.manage` | rule kênh theo mẫu + map ZNS |
| POST | `/ordering/notification-channels/test` | `settings.manage` | gửi thử `{ template, channel, phone\|email }` |

Lỗi mới: `PROVIDER_UNAVAILABLE` 503 (provider lỗi tạm), `CARRIER_BOOKING_FAILED` 409 (`details.reason` từ hãng, đã lọc),
`CARRIER_NOT_CONFIGURED` 400.

## Implementation steps

1. **Đọc tài liệu + khung chung**
   - Files: `docs/providers/{momo,vnpay,ahamove,zalo-zns,sms-<vendor>}.md` (theo Decision), `providers/_http.ts` (client
     HTTP dùng `fetch` + timeout + không log body), `domain/signatures.ts` (HMAC/SHA helpers dùng `node:crypto`), config
     schema env.
   - Verification: review tài liệu với chủ dự án (sandbox nào có); unit test helper.
2. **MoMo**
   - Files: `providers/momo/` (`initiate` → payUrl/deeplink/QR, `parseWebhook` + chữ ký, `webhookResponse`,
     `queryTransaction`, `refund`), đăng ký trong `register.ts` khi đủ env, `getPresentation` cho web.
   - Verification: `scripts/ordering/momo.mjs` (server giả lập trả fixture tài liệu): đủ ca thanh toán trong spec; UAT sandbox.
3. **VNPay**
   - Files: `providers/vnpay/` (tạo URL thanh toán có chữ ký, IPN, return, `queryTransaction`, `refund`), như bước 2.
   - Verification: `scripts/ordering/vnpay.mjs`; UAT sandbox.
4. **Job trạng thái ví + đối soát**
   - Files: `jobs/wallet-status-check.ts`, mở rộng `jobs/reconciliation.ts` cho provider có `listTransactions`; alert
     `reconciliation-mismatch` dùng lại.
   - Verification: script: IPN không tới → job capture; giao dịch thất bại → payment `failed`, đơn prepay hết hạn đúng.
5. **Ahamove (+ GHN nếu chọn)**
   - Files: `providers/ahamove/` (`calculatePrice`, `create` chuyến, `cancel`, webhook parse), `services/delivery-assignment.ts`
     (nhánh hãng: book → chờ hãng nhận → `out-for-delivery` với tracking; webhook → delivered/failed), routes carrier, Admin
     nút "Gọi xe" (P2).
   - Verification: `scripts/ordering/ahamove.mjs` (giả lập): đủ ca giao trong spec; book idempotent (2 lần bấm → 1 chuyến).
6. **Zalo ZNS + SMS + kênh**
   - Files: `providers/zalo-zns.ts`, `providers/sms-<vendor>.ts`, `notification-channel-rule`, `services/notification.ts`
     (chọn kênh, dự phòng, ghi `channel`/`providerMessageId`), OTP O11 dùng kênh `sms|zalo`, Admin P3.
   - Verification: `scripts/ordering/zalo-zns.mjs`, `sms.mjs`: map biến, dự phòng, dedupe; UAT điện thoại thật.
7. **Trang provider + tài liệu viết provider**
   - Files: Admin P1 (Cấu hình → Provider), Ops O6 thêm thẻ provider; `docs/ordering-writing-providers.md` (contract, vòng đời,
     chữ ký, idempotency, test giả lập — lấy MoMo/Ahamove/ZNS làm ví dụ).
   - Verification: script HTTP: không lộ bí mật.
8. **Tài liệu, gate**
   - Files: payments runbook (MoMo/VNPay: bật, IPN URL, hoàn), staff guide (gọi xe, kênh tin), security baseline (IPN, bí
     mật), API contract, STATUS, Completion record.
   - Verification: gate đầy đủ (không gọi mạng thật), `check:ordering` 2 lượt; UAT sandbox ghi kết quả.

## Data and rollback

- Migration `0011`. Rollback: bỏ env provider → không đăng ký; rule kênh rơi về email.

## Verification

- Automated: lint, typecheck, test, `check:ordering` 2 lượt (giả lập), `check:phase3` tắt/bật, smoke, build tắt/bật.
- Manual UAT: sandbox từng provider + điện thoại thật.

## Documentation impact

- Spec/screens/mockup O13, reference U13, `docs/providers/*.md`, `docs/ordering-writing-providers.md`, runbook, staff guide,
  security baseline, API contract, STATUS, roadmap.

## Risks and blockers

- Chặn bởi tài khoản sandbox và mẫu ZNS đã duyệt (Zalo duyệt mẫu mất vài ngày).
- Thay đổi API provider: ghi phiên bản + ngày đọc; test giả lập theo fixture tài liệu.

Ước lượng thô: 3–4 tuần cho đủ 5 provider (mỗi ví ~4 ngày, Ahamove ~4 ngày, ZNS + SMS + kênh ~4 ngày, chung ~3 ngày).

## Completion record

- Chưa bắt đầu.
