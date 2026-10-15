# Vận hành plugin bán hàng (kỹ thuật)

Dành cho người kỹ thuật vận hành CMS. Nhân viên chi nhánh đọc
[`ordering-staff-guide.md`](ordering-staff-guide.md); thanh toán SePay đọc
[`ordering-payments-runbook.md`](ordering-payments-runbook.md). Code thật:
`src/plugins/ordering/server/src` — nếu tài liệu và code lệch thì theo code.

## Trang "Tình trạng vận hành"

Admin → **Bán hàng → Vận hành → Tình trạng vận hành** (`/plugins/ordering/ops`, quyền
`ops.read`; dữ liệu từ `GET /ordering/ops/status`). Nút **Làm mới** tải lại thủ công.

Bốn thẻ trên cùng:

- **Outbox**: số event đang chờ, tuổi (phút) của event chờ lâu nhất, số event đã hết lần
  thử (`failed`). Đỏ khi tuổi lâu nhất vượt ngưỡng rule `outbox-stuck` (mặc định 10 phút)
  hoặc có bất kỳ event failed nào.
- **Webhook**: mỗi provider có webhook ký (SePay) một dòng: trạng thái `ok` / `slow`
  (thành công gần nhất cách đây hơn 24 giờ) / `failing` (số lỗi chữ ký liên tiếp ≥ ngưỡng
  `webhook-failing`), kèm lần thành công và lần lỗi gần nhất.
- **Đối soát**: lần chạy thành công gần nhất và lần chạy kế tiếp của job
  `sepay-reconciliation`. Hiện "Tắt" khi provider `sepay` chưa được cấu hình.
- **Cảnh báo**: số alert đang `open` + `acknowledged`, số mức `critical`, link sang trang
  Cảnh báo.

Hai tab phía dưới:

- **Jobs**: tên job, lần chạy gần nhất, kết quả (`ok` / lỗi cắt 200 ký tự), thời lượng,
  lần chạy kế tiếp, cờ "đang giữ khóa". Nút **Chạy ngay** gọi `POST /ordering/ops/jobs/:name/run`;
  job đang giữ khóa trả `ran:false` vẫn là 200 — không phải lỗi. Mọi job đều idempotent nên
  chạy tay luôn an toàn.
- **Lỗi outbox**: các event `failed` mới nhất (kiểu, mã đơn nếu suy ra được, số lần thử,
  lỗi cuối). Nút **Thử lại** gọi `POST /ordering/ops/outbox/:id/retry` — xóa lease, reset
  `attempts` về 0 và `failedAt`, giữ `lastError` làm ngữ cảnh; event quay lại hàng chờ.

## Cảnh báo

Mười rule (contracts §12 + O15 + O9; producer trong `jobs/` và `services/alert.ts`). Ngưỡng và người
nhận chỉnh tại **Bán hàng → Cấu hình → Cài đặt bán hàng**, khối **Cảnh báo**
(`GET/PUT /ordering/settings/alert-rules`,
ghi change-log `alert-rules.update`), lưu trong plugin store key `alert-rules`.

| Mã | Khi nào | Ngưỡng mặc định | Critical | Người nhận mặc định | Xử lý |
| --- | --- | --- | --- | --- | --- |
| `webhook-failing` | lỗi chữ ký/lỗi xử lý webhook liên tiếp theo provider | 5 lần | 20 lần | `ops.read` | kiểm secret, IP gửi, body; webhook hợp lệ tự đóng |
| `payment-unmatched` | tiền vào không tự khớp, gộp theo provider | 1 khoản | 10 khoản | `report.read` | xử lý ở Duyệt chuyển khoản; đóng tay |
| `outbox-stuck` | event chờ lâu hơn ngưỡng (phút) hoặc có event failed | 10 phút | 60 phút | `ops.read` | xem tab Lỗi, Thử lại, kiểm dispatcher |
| `job-heartbeat-missed` | job im lặng quá `threshold × heartbeatMinutes[job]` | 2× | 6× | `ops.read` | xem tab Jobs, log process, Chạy ngay |
| `order-awaiting-acceptance` | đơn chờ quán nhận quá SLA chi nhánh | 1 đơn | 3 đơn | `branch-email` | gọi quán nhận đơn; tự đóng khi đơn đi tiếp |
| `reconciliation-mismatch` | giao dịch đối soát không ghi được sổ | 1 giao dịch | 10 giao dịch | `payment.review` | xử lý từng giao dịch ở Duyệt chuyển khoản |
| `manual-payment-unconfirmed` | ghi tay quá ngưỡng (giờ) mà SePay chưa xác nhận | 24 giờ | 72 giờ | `report.read` | đối chiếu sao kê; tự đóng khi đã xác nhận |
| `cash-closing-mismatch` | chốt/điều chỉnh tiền mặt chênh ≠ 0 | 1 lần | 1 lần | `report.read` | đếm lại và tạo bản điều chỉnh có lý do; về 0 tự đóng |
| `audit-tampered` | job `audit-chain` thấy dòng lịch sử thay đổi bị sửa/xóa thẳng trong DB (hash hoặc liên kết sai) | 1 lần | luôn critical | `ops.read` | xem `aggregateRef` (`change-log:<id>`), so với backup DB, điều tra quyền truy cập DB; không tự đóng |
| `gift-card-probing` | mã thẻ quà tặng sai liên tiếp từ một IP (`dedupeKey` = IP; đếm cả request đang bị 429) | 20 lần / cửa sổ | 60 lần | `ops.read` | IP đã bị rate-limit + captcha — chỉ cần xác nhận, cân nhắc chặn IP ở edge nếu critical; không tự đóng |
| `data-request-overdue` | yêu cầu dữ liệu cá nhân (xuất/xóa) còn `received`/`waiting` quá `dataRights.deadlineHours` (mặc định 72 giờ); `dedupeKey` = `data-request-overdue:<documentId>`, không mang SĐT | 1 yêu cầu | — | `ops.read` | mở Yêu cầu dữ liệu, xử lý (hoặc từ chối có ghi chú) trước hạn Nghị định 13; **tự đóng** ở lần chạy `data-request-waiting` kế tiếp (35 phút) sau khi yêu cầu xong/bị từ chối. Cảnh báo không gắn chi nhánh nên chỉ nhân viên xem tất cả chi nhánh thấy |

Cơ chế chung:

- **Cửa sổ gộp** (`aggregationMinutes`, mặc định 60; `cash-closing-mismatch` 1440): một
  `dedupeKey` chỉ một bản ghi trong cửa sổ — lần sau chỉ tăng `count` và `lastSeenAt`,
  không gửi mail mới. Bản ghi `resolved` bị "đánh thức" lại trong cửa sổ cũng **không**
  gửi mail mới.
- **"Đã biết"** (`POST /ordering/alerts/:id/acknowledge`): chặn nhắc lại cùng mức; **không**
  chặn leo thang — `count` đạt `criticalThreshold` vẫn lên `critical` và gửi
  `ops-alert.escalated`.
- **Người nhận**: `branch-email` (hộp thư chi nhánh của `locationRef`) hoặc một action
  plugin (`ops.read`, `report.read`, `payment.review`, `order.read`) — ai giữ action đó
  trong scope được mail `staff.ops-alert` một lần.
- Giới hạn tối đa 500 bản ghi `ops-alert`; khi đầy dọn bản `resolved` cũ nhất trước.

## Job định kỳ

`jobs/catalog.ts` (`ORDERING_JOBS`) là danh sách duy nhất — bootstrap đăng ký
`ordering.<name>` vào cron của Strapi khi `jobs.enabled = true`. Mỗi job (trừ outbox
dispatcher) chạy dưới một dòng khóa `order-job-lock` (`jobName` + `shardKey 'default'`) có
`lastRunAt`/`lastSuccessAt`/`lastDurationMs`/`lastError`/`expiresAt`; hai process không
chạy cùng một job một lúc — process thua khóa trả `ran:false`. Outbox dispatcher không
dùng khóa mà gọi `heartbeat` (upsert không-khóa) vì nó tự phối hợp bằng lease từng event.

| Job | Cron mặc định (`jobs.*Cron`) | Heartbeat | Việc |
| --- | --- | --- | --- |
| `outbox` | `*/10 * * * * *` | 2' | giao event outbox (email, consumer) |
| `hold-expiry` | `*/30 * * * * *` | 2' | hết hạn giữ chỗ/hàng đợi |
| `idempotency-cleanup` | `0 */15 * * * *` | 45' | dọn khóa idempotency cũ |
| `sla-check` | `0 * * * * *` | 3' | đơn chờ quán quá SLA → `order-awaiting-acceptance` |
| `sepay-reconciliation` | `0 0 * * * *` | 150' | kéo giao dịch SePay về đối soát |
| `payment-expiry` | `*/30 * * * * *` | 2' | đơn prepay quá hạn → `expired` |
| `manual-payment-check` | `0 15 * * * *` | 150' | ghi tay chưa xác nhận → `manual-payment-unconfirmed` |
| `ops-check` | `0 * * * * *` | — | kiểm outbox + heartbeat các job (tự nó không được giám sát) |
| `retention` | `0 30 3 * * *` | 1500' | xóa/gỡ dữ liệu cá nhân quá hạn |
| `audit-chain` | `0 */5 * * * *` | 15' | điền hash cho dòng lịch sử thay đổi (sau 30 giây) và kiểm 2.000 dòng mới nhất + 200 dòng ngẫu nhiên → `audit-tampered`; tắt bằng `audit.hashChain=false` |
| `gift-card-expiry` | `0 45 3 * * *` | 1500' | thẻ quà tặng quá hạn: ghi sổ `expire` phần số dư còn lại, đưa số dư về 0; idempotent — chạy lại không ghi trùng |

Tắt toàn bộ job: `plugin::ordering.jobs.enabled = false`. Đổi nhịp một job: ghi đè
`jobs.<tên>Cron` trong cấu hình plugin (env/config `config/plugins.ts`), khởi động lại.
Không có cấu hình tắt từng job riêng — để "tắt" một job thì cho cron nó xa tới mức không
chạy, hoặc tắt `jobs.enabled` và gọi `POST /ordering/ops/jobs/:name/run` khi cần (đây cũng
là đường rollback của phase: các tính năng O6 chỉ đọc hoặc chạy job).

## Thời hạn lưu (`retention`)

Cấu hình `plugin::ordering.retention` — **mặc định chờ pháp lý xác nhận** (contracts §19.9):

| Khóa | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `paymentPayloadDays` | 180 | tuổi `receivedAt` để redact `payment-event.raw_payload` |
| `outboxDeliveredDays` | 30 | xóa outbox đã `delivered` quá hạn; cũng là hạn xóa `webhook-delivery` `succeeded` (theo `succeededAt`) |
| `outboxFailedDays` | 90 | xóa outbox `failed` quá hạn; cũng là hạn xóa `webhook-delivery` `failed` (theo `updatedAt`) — payload có thể chứa thông tin khách của endpoint bật `includeCustomer` |
| `alertResolvedDays` | 90 | xóa `ops-alert` `resolved` quá hạn |
| `sealedCodeHours` | 24 | tuổi `plugins_ordering_gift_card.sealed_code` (mã thẻ đã niêm phong) — quá hạn xóa trường này, chỉ giữ `code_hash` + `last4`; sau đó "gửi lại mã" không còn khả dụng |
| `batchSize` | 500 | số dòng mỗi lô |
| `maxBatchesPerRun` | 20 | tối đa lô mỗi lượt (backlog dồn sang lượt sau) |

Redact chỉ giữ allowlist `RETAINED_PAYLOAD_KEYS` (`domain/pii.ts`): `id`, `transferAmount`,
`transferType`, `transactionDate`, `referenceCode`, `gateway`, `code`, `source`,
`accountKey`, `memoCode`, `manual`, `confirmed`, `confirmedAt`, `transferredAt`,
`sepayTransactionId`, `kind`, `amount`, `currency`, `providerTransactionId` — đủ để đối
soát; `content`, `description`, `accountNumber`, `sender*`, `headers`, `body` bị bỏ. Mọi
payload đã xử lý mang `redactedAt`; payload không parse được thành
`{ redactedAt, unparsable: true }`. Chạy tay: trang vận hành → Jobs → `retention` →
**Chạy ngay** (khớp mã `ORDERING_JOBS`, `runnable: true`). Chạy lại an toàn — đã xong thì
mọi số đếm là 0.

## Khôi phục

**Outbox kẹt**: event đang chờ giữ lease `leaseUntil` (`outbox.leaseSeconds` mặc định
300s); process chết thì event tự hết lease và được nhặt lại ở lần dispatch sau — không cần
thao tác. Quá `outbox.maxAttempts` (10) thì `failedAt` được đặt và hiện ở tab **Lỗi
outbox**; sửa nguyên nhân (SMTP, consumer) rồi bấm **Thử lại**.

**Dispatcher chết**: nếu `outbox` im lặng quá `2 × heartbeatMinutes.outbox` (4 phút),
`ops-check` mở `job-heartbeat-missed:outbox`. Kiểm tra process, tab Jobs (lỗi cuối), rồi
**Chạy ngay** để hút hàng tồn — đây cũng là cách đẩy nhanh email đang kẹt khi cron đang
tắt.

**Database**: backup chuẩn `pg_dump`/`pg_restore`. Hai điểm cần nhớ:

- `plugins_ordering_migrations` ghi các migration đã áp — restore xong đừng xóa bảng này;
  `bootstrap` chạy `runOrderingMigrations` và sẽ áp lại migration thiếu.
- Plugin đăng ký mọi bảng `plugins_ordering_*` vào core-store `persisted_tables`
  (`migrations/persisted-tables.ts`) — schema sync khi boot với plugin tắt sẽ **không** drop
  bảng. Nếu thật sự muốn xóa sạch thì gỡ các entry đó khỏi `strapi_core_store_settings`
  (key `persisted_tables`) rồi drop tay — thường là **không** làm.

**Bật/tắt `ORDERING_ENABLED`**: `false` chỉ ngừng đăng ký plugin (route, job, bảng không
được tạo khi boot mới) — dữ liệu `plugins_ordering_*` **không mất**. Bật lại là tiếp tục
được; đây là công tắc dừng bán khẩn cấp mà không cần restore DB.

## Xuất dữ liệu (§21.9)

`strapi export` và `strapi transfer` lấy **mọi** bảng — gồm các bảng `plugins_ordering_*`
có dữ liệu cá nhân: `plugins_ordering_order` (`contact_snapshot`, `receive_method` chứa
địa chỉ giao), `plugins_ordering_payment_event` (`raw_payload` chưa quá hạn), khách
`payment`, `refund`, `staff-location-scope`… Coi file xuất như dữ liệu cá nhân:

- Luôn mã hóa file: `strapi export --encrypt` (hỏi key; xem `strapi export --help` cho cờ
  truyền key) hoặc `gpg --symmetric <file>` sau khi xuất.
- Chỉ giữ trên máy chủ dự án hoặc ổ được mã hóa. **Không** gửi qua chat/email, không đẩy
  lên drive công khai, không commit.
- Xóa ngay khi hết việc (`Remove-Item`/`shred` tùy máy).
- Ai giữ key mã hóa: chỉ chủ dự án và người kỹ thuật được giao việc đó; key không lưu
  trong repo, không trong cùng thư mục với file mã hóa.

Riêng xuất CSV cho kế toán qua `GET /ordering/orders/export` (quyền `export`, tối đa 92
ngày / 10.000 đơn) — đó là luồng nghiệp vụ có cảnh báo trên UI, khác với export kỹ thuật
ở đây.

## Hạ tầng và go-live (chủ dự án chạy)

Checklist — mỗi mục tick xong mới bật bán:

- [ ] **Cloudflare cho webhook**: path `POST <API_REST_PREFIX>/ordering/webhooks/sepay`
  (prefix mặc định `/api/v1`; kiểm env `API_REST_PREFIX` của môi trường đích):
  - Cache Rule bypass cache cho path này.
  - WAF/Security skip challenge (JS challenge, Managed Challenge) cho path này.
  - Không bật Bot Fight Mode/Bot Management cho path (bot của SePay cần vào thẳng).
  - Ví dụ rule bằng `cf` CLI tồn tại trong runbook cũ hơn — **kiểm lại cú pháp với
    `cf --help`**, không coi là đúng sẵn.
- [ ] **SSE**: `GET /ordering/orders/stream` (admin) đi qua proxy phải không buffer và
  timeout đủ dài — nếu qua nginx: `proxy_buffering off;` + `proxy_read_timeout` lớn
  (≥ 3600s) cho location đó. Cloudflare không chặn SSE mặc định nhưng kiểm lại bằng một
  tab Admin mở lâu.
- [ ] **Backup DB trước go-live** (`pg_dump` đầy đủ, lưu nơi mã hóa theo mục Xuất dữ liệu).
- [ ] **Env đầy đủ**: `ORDERING_ENABLED=true`, `ORDERING_ENCRYPTION_KEY`,
  `SEPAY_WEBHOOK_SECRET` + `SEPAY_API_TOKEN` + `SEPAY_ACCOUNTS` (nếu bán chuyển khoản),
  captcha (`TURNSTILE_SECRET_KEY` hoặc provider tương đương), SMTP (`EMAIL_SMTP_*`),
  `TRUST_PROXY=true` khi đứng sau proxy, `API_REST_PREFIX` nếu khác `/api/v1`.
- [ ] **`plugin::ordering.consent.policyVersion`**: đặt đúng phiên bản chính sách dữ liệu
  cá nhân đã duyệt (21.4). Hiện chỉ chỉnh được qua config/env — **chưa có màn Admin**.
- [ ] **Smoke sau khi bật**: `GET /_health` → 204; Admin hiện menu **Bán hàng**; gửi một
  webhook thử có chữ ký đúng qua domain thật → 200 `{"success": true}` và event hiện trong
  Duyệt chuyển khoản hoặc ghi sổ; `GET <prefix>/ordering/branches` → 200 JSON.
- [ ] **Tài khoản SePay thật**: đã cấu hình, đã thử bằng một giao dịch nhỏ (đối soát khớp).
- [ ] **Mọi gate O1–O6** ghi trong `docs/STATUS.md` — repo chưa có CI nên đây là bằng chứng
  duy nhất.

## Bật nhà cung cấp O13 (MoMo, VNPay, Ahamove, Zalo ZNS, eSMS)

Các provider O13 **mặc định tắt**. Chỉ bật khi đã UAT sandbox và có duyệt của chủ dự án:

1. UAT sandbox xong (đúng luồng trong `docs/providers/<name>.md` + script tích hợp tương ứng).
2. Điền env theo `.env.example`; bắt buộc `ORDERING_PUBLIC_API_URL` khi bật ví (IPN/return URL).
3. `MOMO_ENVIRONMENT`/`VNPAY_ENVIRONMENT`/`AHAMOVE_ENVIRONMENT` để `sandbox|staging` cho tới khi
   được duyệt production; VNPay production còn cần đối tác duyệt IPN URL.
4. Mở trang **Bán hàng → Cấu hình → Nhà cung cấp** kiểm badge "Đã cấu hình" + URL webhook hiển thị
   đúng domain public, rồi đăng URL đó trong portal đối tác.
5. Sau bật: theo dõi thẻ webhook trên **Tình trạng vận hành** (tỉ lệ lỗi 24h, alert
   `webhook-failing:<code>`) và job `wallet-status-check` trước khi nhận traffic thật.

## Một instance (§21.9)

SSE đẩy đơn realtime và giới hạn tần suất storefront đều giữ trạng thái **trong bộ nhớ
process** — chạy hai instance là hai thế giới khác nhau (đơn báo lệch, rate limit nhân
đôi). Quyết định go-live mặc định: **một instance CMS**. Nâng lên nhiều instance là một
thay đổi kiến trúc (Redis/pub-sub cho SSE + rate limit), không phải chỉnh deploy.

## Job điểm thành viên (O16)

| Job | Lịch | Việc | Chạy lại |
| --- | --- | --- | --- |
| `loyalty-earn-sweep` | mỗi 10 phút | Tích điểm cho đơn hoàn tất mà sự kiện không tới (hủy món, hoàn tiền, khách xác minh sau); hoàn điểm cho đơn hủy còn giữ điểm | an toàn, idempotent |
| `loyalty-expiry` | 03:30 hằng ngày | Ghi `expire` từng lô quá hạn; gửi mail nhắc một lần/lô | an toàn |
| `loyalty-tiers` | 04:00 hằng ngày | Tính lại chi tiêu 12 tháng, lên/xuống hạng, đổi nhóm O14 | an toàn |

Tắt chương trình (`enabled=false`) dừng cả ba job; số dư và sổ giữ nguyên. Nhịp kỳ vọng nằm ở `jobs.heartbeatMinutes` (15 / 1500 / 1500 phút) cho cảnh báo `job-heartbeat-missed`.
