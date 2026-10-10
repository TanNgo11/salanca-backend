# Plugin `ordering` (O1)

Plugin Strapi cục bộ cho đơn hàng trực tuyến: tạo đơn, tính tiền, workflow chuyển bước,
thanh toán/hoàn tiền, giữ chỗ (hold), timeline, outbox và cron nền — theo phạm vi chi nhánh.

**Ranh giới:** plugin không import mã của app và không sửa content type/seed của app.
App chỉ đi qua các service public (`strapi.plugin('ordering').service(...)`) và các điểm
mở rộng của registry. Ngược lại, app đăng ký adapter/provider/product type/workflow của
riêng mình vào registry khi `register()`.

## Bật plugin

- `ORDERING_ENABLED=true` (xem `config/plugins.ts` — app map env vào `plugin::ordering`).
- `pnpm run build:ordering` biên dịch `server/tsconfig.json` ra `dist/server` (được chạy
  kèm trong `pnpm run build`/`dev`).
- Migration của plugin chạy trong `bootstrap()` (`runOrderingMigrations`), tạo index và
  sequence `plugins_ordering_order_code_seq`; content type do Strapi sync theo schema.

## Cấu hình

Các khóa `plugin::ordering` (mặc định trong `server/src/config/index.ts`):

| Khóa | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `currency` | `VND` | Đơn vị tiền duy nhất hỗ trợ |
| `catalog.adapter` | `ordering-catalog` | Adapter catalog mặc định |
| `catalog.defaultLocale` | `vi` | Locale snapshot món |
| `allowMixedProductTypes` | `false` | Cho đơn nhiều product type |
| `orderCode.template` / `prefix` | `{prefix}-{seq:6}` / `ORD` | Định dạng mã đơn |
| `consent.policyVersion` | `v1` | Bắt buộc khi tạo đơn |
| `businessDay.cutoffLocalTime` | `04:00` | Giờ cắt ngày kinh doanh |
| `tax.enabled` / `pricesIncludeTax` | `false` / `true` | Thuế tắt; giá đã gồm thuế |
| `hold.defaultMinutes` | `15` | TTL mặc định của hold |
| `idempotency.ttlHours` | `24` | TTL khóa idempotency |
| `outbox.batchSize` / `leaseSeconds` | `50` / `300` | Batch claim và lease |
| `outbox.maxAttempts` | `10` | Quá số lần → `failed_at` |
| `outbox.baseBackoffSeconds` / `maxBackoffSeconds` | `30` / `3600` | Backoff mũ `base*2^(n-1)` |
| `jobs.enabled` | `true` | Bật cron (test tắt qua builtins) |
| `jobs.outboxCron` / `holdExpiryCron` / `idempotencyCleanupCron` | `*/10s` / `*/30s` / `*/15m` | Lịch 3 job |
| `testing.builtins` | `false` | Catalog/provider consumer test; cấm khi `NODE_ENV=production` |
| `productTypes`, `providers.*` | `{}` | Map bật/tắt theo code (`{enabled}`); validate qua zod ở `validator` |

## Cấu trúc mã

```
src/plugins/ordering/
  admin/                # placeholder Admin (chưa dùng)
  server/src/
    content-types/      # order, order-line, fulfillment-group/line, payment(-event),
                        # refund(-line), hold, outbox, idempotency-key, order-job-lock,
                        # branch, staff-location-scope, admin-change-log, ops-alert, ...
    contracts/          # adapter/provider/outbox contracts
    domain/             # THUẦN TOÁN: pricing/allocation, money, refund-amount,
                        # business-date, order-code, workflow/, product-types/, pii, hashing
    jobs/               # outbox-dispatcher, hold-expiry, idempotency-cleanup
    migrations/         # runner + 0001-o1-core (index/unique/sequence)
    providers/          # ordering-catalog stub, test-catalog, test-payment (builtins)
    repositories/       # order aggregate loader, row locks
    services/           # registry, scope, idempotency, order, transition, payment,
                        # refund, line-cancel, timeline, hold, outbox, job-lock,
                        # branch, change-log, migrations
    register.ts bootstrap.ts destroy.ts index.ts
```

`domain/` không được import Strapi (kiểm chứng bằng grep); `services/`, `repositories/`
được phép. Content type có thể mở rộng từ app qua `src/extensions/ordering/strapi-server.ts`
(ví dụ thêm `isFeatured` vào một plugin content type — ví dụ minh họa, repo chưa dùng).

## Service public

Gọi qua `strapi.plugin('ordering').service('<tên>')`. Mọi hàm nghiệp vụ nhận `ctx:
ServiceContext = { actor: ActorContext; now?: Date }`; `ActorContext` là
`{ kind: 'system' }`, `{ kind: 'customer', actorRef? }` hoặc `{ kind: 'staff', adminUserId,
allLocations?, locationRefs? }` (dựng bằng `scope.actorFromAdminUser`).

- `order.createOrder(input, ctx)` → `{ order: aggregate, publicToken, replayed }` —
  idempotent theo `idempotencyKey`; `getOrder(id, ctx)`, `listOrders(where, ctx)` (cần
  scope), `confirmDraft({orderId}, ctx)`.
- `transition.transitionGroup({orderId, groupId, to}, ctx)`, `cancelOrder`, `customerCancel`.
- `payment.createPayment({orderId, providerCode}, ctx)`,
  `recordPaymentEvent({providerCode, providerTransactionId, ...}, ctx)`,
  `capturePayment({paymentId, amount, providerTransactionId}, ctx)` — idempotent theo txnId.
- `refund.createRefund({paymentId, amount?|lines?, reason, idempotencyKey}, ctx)` —
  theo dòng dùng quy tắc telescoping; `createRefundInTransaction` là lõi trong transaction
  cho service khác dùng (`countsAs: 'canceled'`).
- `line-cancel.cancelLineQuantity({orderId, lineId, quantity, reason}, ctx)` — hủy một phần
  món: `canceledQuantity += q`, refund qua payment còn nhiều captured nhất (thiếu thì ghi
  `refundShortfall` vào timeline), không tự chuyển group.
- `scope.loadScope(ctx)`, `assertLocationInScope`, `orderWhere`, `actorFromAdminUser`,
  `condition(user)` (dùng cho permission condition `plugin::ordering.same-location`).
- `outbox.enqueue(event, ctx)` (trong transaction), `dispatch`, `claimBatch`, `deliver`,
  `pendingStats`; `hold.create/releaseForOrder/releaseForGroup/releaseExpired`;
  `idempotency.run/cleanupExpired`; `job-lock.withLock`; `branch.create/update/findByCode/list`
  (`code` bất biến); `change-log.record/list`.
- `registry.registerCatalogAdapter/ProductType/Workflow/PaymentProvider/OutboxConsumer` —
  ví dụ app-side: `src/ordering/register-ordering-adapters.ts`.

## Tiền và làm tròn

- Số tiền là số nguyên VND (safe integer); `bigint` từ Postgres đi qua `amountFromDb`.
- Phân bổ chiết khấu/phí xuống dòng theo largest remainder (`domain/pricing/allocation`).
- Giỏ mockup: 2×bún bò + 1×trà đào + 3×gỏi cuốn = 220.000 − 25.000 → **195.000**
  (allocation −14.773/−5.114/−5.113; lineTotal 115.227/39.886/39.887).
- Cash rounding theo chi nhánh: half-away-from-zero theo bội số cấu hình — 195.500 làm tròn
  **lên** 196.000 (delta +500).
- Hoàn tiền theo dòng: `refundLineAmount` dùng telescoping `cumulative(k0+q)−cumulative(k0)`
  nên tách hoàn thế nào tổng vẫn bằng `lineTotalAmount`.

## Workflow & projection

Group đi qua state của workflow đăng ký (`pickup-pay-on-pickup`: `awaiting-acceptance →
preparing → ready → delivered`, `canceled` là terminal từ `customerCancellable`/`cancellable`).
`transition` validate edge, khóa hàng `FOR UPDATE`, recompute projection: `status` từ các
group, `paymentStatus` từ **captured gộp** (`unpaid/partially-paid/paid/partially-refunded/
refunded`), `completed` khi giao xong + `paid`. Order `totalAmount` bất biến — hoàn/hủy món
ghi vào ledger refund, không sửa tổng.

## Outbox, job, cron

- Sự kiện `outbox.enqueue` trong cùng transaction nghiệp vụ; `dispatch` claim bằng
  `FOR UPDATE SKIP LOCKED` + lease (`locked_by`/`lease_until`), fencing khi commit
  `delivered_at` — nhiều instance chạy song song an toàn (dispatcher **không** job-lock).
- Lỗi consumer: backoff `min(base*2^(attempts-1), max)`; đủ `maxAttempts` → `failed_at`.
  `last_error` chỉ chứa message (≤500 ký tự), không payload — consumer PHẢI idempotent theo
  event id.
- Job `hold-expiry` và `idempotency-cleanup` đi qua `job-lock.withLock` (một instance chạy).
- Cron đăng ký ở `bootstrap` khi `jobs.enabled` qua `strapi.cron.add({ '<tên>': { task,
  options: { rule } } })`; owner `${hostname}:${pid}`; lỗi job chỉ log `[ordering] job …`.
- Một instance: cron đủ. Nhiều instance: outbox vẫn đúng nhờ SKIP LOCKED + lease.

## Tắt plugin không mất dữ liệu

Schema sync của Strapi xóa mọi bảng từng có trong schema lưu trước đó nhưng vắng mặt ở boot
hiện tại — tức boot với `ORDERING_ENABLED=false` sẽ xóa toàn bộ bảng `plugins_ordering_*`.
Vì vậy `bootstrap` ghi tên tất cả bảng plugin (kể cả `plugins_ordering_migrations` và link
tables) vào khóa core-store `persisted_tables`: các bảng trong danh sách này được bảo lưu
khi schema sync chạy. Tắt plugin → bảng, index, dữ liệu nguyên vẹn; bật lại → chạy tiếp bình
thường. Xóa dữ liệu ordering là quyết định thủ công, ví dụ (chỉ ý tưởng, không kèm script):

```sql
-- CHỈ chạy khi thật sự muốn xóa toàn bộ dữ liệu ordering:
DROP TABLE plugins_ordering_<name> CASCADE; -- với từng bảng plugins_ordering_*
DELETE FROM strapi_core_store_settings WHERE key = 'persisted_tables';
```

## Scope chi nhánh

`staff-location-scope` gán `adminUserId → allLocations | locationRefs[]`. Ngoài scope:
đọc → `ORDER_NOT_FOUND` (không lộ tồn tại), list không scope → `SCOPE_REQUIRED`, tạo →
`BRANCH_NOT_FOUND`. `condition(user)` trả `false`/`{locationRef:{$in:[...]}}`/`true` cho
permission engine (`plugin::ordering.same-location`).

## Test

```powershell
pnpm run test             # unit + property (domain thuần)
pnpm run check:ordering   # build + 10 integration script trên salanca_ordering_test
```

Integration scripts (`scripts/ordering/`) boot Strapi thật trên Postgres loopback
`salanca_ordering_test` với `ORDERING_TEST_BUILTINS=true` (tắt cron, bật test catalog/
provider/consumer). Không bao giờ chạy trên `salanca_cms`.

## Chưa có (O2–O6)

Public REST/API route, Admin UI thật, voucher/scheduling/fulfillment provider, ops-alert
delivery, báo cáo/export, webhook endpoint thật, pendingStats dashboard. `test.ping`/
`test.fail` chỉ tồn tại dưới `testing.builtins`.
