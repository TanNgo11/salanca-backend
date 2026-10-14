# Viết provider adapter cho plugin ordering (O13)

Hướng dẫn cho tác giả adapter mới (ví dụ GHN, ShopeeFood, thẻ quà tặng). Mọi provider đi qua
registry + contract chung — **không** được bypass payment-matching, fulfillment, notification,
outbox, audit hay ops-status. Mẫu tham chiếu: `providers/sepay/` (payment), `providers/momo/`
và `providers/vnpay/` (wallet), `providers/ahamove/` (carrier), `providers/zalo-zns/` +
`providers/esms/` (notification).

## 1. Contract theo nhóm

| Nhóm | Interface | Registry |
| --- | --- | --- |
| Thanh toán | `PaymentProvider` (`contracts/payment.ts`) | `registry.registerPaymentProvider` |
| Giao vận | `FulfillmentProvider` (`contracts/fulfillment.ts`) | `registry.registerFulfillmentProvider` |
| Thông báo | `NotificationProvider` (`contracts/notification.ts`) | `registry.registerNotificationProvider` |
| Voucher/thẻ | `VoucherProvider` | `registry.registerVoucherProvider` |

Mọi provider khai `code` (unique, kebab) và `capabilities` (mảng hằng số — ví dụ
`SIGNED_WEBHOOK_CAPABILITY` cho provider nhận webhook có ký). Capability quyết định thẻ
sức khỏe webhook trên trang Ops.

Payment provider cần `initiate` / `parseWebhook` / `refund` (+ `queryTransaction` nếu provider
có API truy vấn — MoMo/VNPay dùng cho job `wallet-status-check`). Fulfillment provider cần
`quote` / `book` / `cancel` / `parseWebhook`. Notification provider chỉ cần `send`.

## 2. Cấu hình — env-only, strict, tắt mặc định

- File `providers/<name>/config.ts` dùng `parseProviderSettings(name, schema, raw, refines)`
  từ `providers/_config.ts`. Schema zod bắt buộc `enabled: z.literal(true)` — **trả null khi
  thiếu/tắt, throw khi enabled nhưng sai** (boot fail-closed).
- `config/plugins.ts` nạp env vào `plugin::ordering.providers.<group>.<code>`; key env theo
  tên đối tác (`MOMO_*`, `VNPAY_*`, `AHAMOVE_*`, `ZALO_*`, `ESMS_*`). Secret (API key, secret,
  refresh token) **không bao giờ** vào DB hay Admin UI.
- Validate provider-level (ví dụ `publicApiUrl` bắt buộc khi wallet enabled) đặt trong
  `config/index.ts` validator.
- `.env.example` liệt kê mọi biến kèm chú thích.

## 3. Đăng ký (`server/src/register.ts`)

```ts
if (momoSettingsFromConfig(config.providers.payment)) {
  registry.registerPaymentProvider(
    createMomoPaymentProvider(() =>
      momoSettingsFromConfig((strapi.config.get('plugin::ordering') as OrderingConfig).providers.payment)),
  );
}
```

Factory nhận một **getter** settings đọc config lazily — integration test có thể đổi
`baseUrl` sau boot (fake server). Provider không hợp lệ không đăng ký; `assertEnabledCodesRegistered`
fail startup nếu env bật mà không đăng ký được.

## 4. HTTP + chữ ký

- `providers/_http.ts`: `createProviderHttp({ baseUrl, timeoutMs, maxBytes })` trả client có
  `postJson` / `postForm` / `deleteJson`. Timeout `AbortSignal` (mặc định ~10 s), body đọc có
  giới hạn byte, `redirect: 'error'`; mọi lỗi mạng/đọc body → `OrderingError('PROVIDER_UNAVAILABLE')`
  kèm `details.reason` + `status`. **Không** gọi `fetch` trực tiếp trong provider.
  `baseUrl` là env-backed (chỉ env mới đổi được đích) — inbound `url-guard` chỉ áp cho
  outbound webhook subscriptions.
- `providers/<name>/signature.ts`: build/verify chữ ký đúng tài liệu đối tác (thứ tự field
  cố định cho MoMo; `vnp_` sort + url-encode cho VNPay; token header cho Ahamove). So sánh bằng
  `crypto.timingSafeEqual`. Trả **boolean**, không throw — sai chữ ký là 401 không phải 500.
- Chia rate-limit/retry theo tài liệu đối tác; tôn trọng `Retry-After` nếu có.

## 5. Webhook inbound

- Route chung `POST|GET /api/v1/ordering/webhooks/:providerCode` → `controllers/webhook.receive`
  → `services/webhook.ts`. Khai `SIGNED_WEBHOOK_CAPABILITY` để service đòi raw body + verify.
- Provider chỉ trả `parseWebhook(raw) → { accepted, events, ack }`; ACK format (HTTP status,
  body) nằm trong `webhookResponse` của provider (MoMo 204, VNPay `{RspCode,Message}`).
- Sai chữ ký → `webhook.receive` trả `WEBHOOK_SIGNATURE_INVALID` (401), ghi
  `noteWebhookFailure` — tự động mở alert `webhook-failing:<code>` khi vượt threshold.
- Webhook payment **không** tự sửa đơn — events đi qua `payment-matching.ingest` (idempotent
  theo `providerTransactionId`); wallet khớp bằng `providerReference`. Carrier webhook đi qua
  `carrier-assignment.applyCarrierStatus`.

## 6. Idempotency + đối soát

- Mọi thao tác có side-effect nhận `idempotencyKey`/`providerTransactionId`; lặp lại phải trả
  cùng kết quả (xem `carrierAssignment.book` — lock `FOR UPDATE` rồi trả booking cũ nếu đã có).
- Provider không có "list" API (MoMo/VNPay) → đối soát bằng job poll `queryTransaction` trên
  payment đang pending (`jobs/wallet-status.ts`). Provider có list API (SePay) → job pull
  statement (`sepay-reconciliation`).
- Refund phải đọc `payment.session` (transactionNo/payDate lưu lúc capture) chứ không query
  lại lịch sử.

## 7. Outbox + notification

- Notification provider nhận `(channel, recipient, template)` đã qua `notification.ts` —
  chain/fallback/dedupe/daily-limit nằm ở đó, provider chỉ gửi + báo lỗi. Recipient đến provider
  là giá trị thật (cần để gửi), nhưng **log/delivery row chỉ lưu hash** — không echo phone/email
  vào error message.
- Outbound webhooks (catalog change…) đi qua outbox (`FOR UPDATE SKIP LOCKED`), không gửi
  trực tiếp trong request.

## 8. Phân loại lỗi + retry

- `OrderingError` codes: `PROVIDER_UNAVAILABLE` (503, retry được), `CARRIER_BOOKING_FAILED`,
  `CARRIER_NOT_CONFIGURED`, `WEBHOOK_SIGNATURE_INVALID`… — thêm vào `domain/errors.ts` + status
  map + `admin/src/translations` (`error.CODE`).
- Provider trả lỗi nghiệp vụ → giữ `resultCode` của đối tác trong `details` (ví dụ
  `details.reason='zalo-error:-1121'`) để `failureText()` hiển thị an toàn.
- Timeout mặc định ngắn (~10 s); lỗi 5xx/timeout được outbox/job retry theo backoff.

## 9. Test

- Unit test cạnh provider (`provider.test.ts`): mock `fetch`/`http` — chữ ký đúng/sai, mapping
  mã kết quả, idempotency, phân loại lỗi. Không gọi mạng thật.
- Integration script `scripts/ordering/<name>.mjs`: boot Strapi trên `salanca_ordering_test`,
  dựng **fake provider server** trong script (`baseUrl` trỏ `127.0.0.1`), chạy đủ luồng
  happy/fail/bad-signature/idempotent. Thêm vào `scripts/ordering/run-all.mjs`.

## 10. Trang Nhà cung cấp + tài liệu

- Thêm card vào `services/provider-status.ts` (envNeeded, docsPath, partnerRef mask — tuyệt đối
  không trả secret) và label `p1.provider.<code>` trong `admin/src/translations/o13.ts`.
- Tài liệu `docs/providers/<name>.md` theo mẫu: nguồn tài liệu chính thức (link + ngày đọc),
  API version, bảng chữ ký, endpoint, mã kết quả (bảng `resultCode → hành vi`), IP nguồn
  webhook (nếu đối tác công bố), rate limit, hướng dẫn sandbox, danh sách env var.
