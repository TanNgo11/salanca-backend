# Plugin `ordering` (O1)

Plugin Strapi cục bộ cho đơn hàng trực tuyến: tạo đơn, tính tiền, workflow chuyển bước,
thanh toán/hoàn tiền, giữ chỗ (hold), timeline, outbox và cron nền — theo phạm vi chi nhánh.

**Ranh giới:** plugin không import mã của app và không sửa content type/seed của app.
App chỉ đi qua các service public (`strapi.plugin('ordering').service(...)`) và các điểm
mở rộng của registry. Ngược lại, app đăng ký adapter/provider/product type/workflow của
riêng mình vào registry khi `register()`.

## Bật plugin

- `ORDERING_ENABLED=true` (xem `config/plugins.ts` — app map env vào `plugin::ordering`).
- `pnpm run build:ordering` biên dịch `server/tsconfig.json` (gồm `shared/`) ra `dist/`, giữ nguyên cấu
  trúc thư mục: entry là `dist/server/src/index.js`, code dùng chung ở `dist/shared/` (được chạy kèm trong
  `pnpm run build`/`dev`). `check:ordering` kiểm mọi import tương đối trong `dist` trỏ tới file có thật.
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
| `jobs.outboxCron` / `holdExpiryCron` / `idempotencyCleanupCron` / `slaCheckCron` | `*/10s` / `*/30s` / `*/15m` / mỗi phút | Lịch 4 job (`sla-check` mở cảnh báo đơn chờ nhận quá `slaMinutes`) |
| `clientIp.secretHeader` / `ipHeader` / `sharedSecret` | `x-ordering-client-secret` / `x-ordering-client-ip` / không | Chỉ tin IP khách do server web chuyển tiếp khi secret khớp (so sánh timing-safe); ngược lại dùng `ctx.request.ip`. Salanca dùng `x-salanca-intake-secret` + `x-salanca-visitor-ip` + `FORM_INTAKE_SHARED_SECRET` |
| `encryptionKey` | không | AES-256-GCM, 32 byte base64 (`ORDERING_ENCRYPTION_KEY`). Bắt buộc khi `NODE_ENV=production`; nơi khác thiếu thì cảnh báo và không tạo được đơn |
| `storefront.captchaProvider` | `''` | Code `CaptchaProvider` cho tạo đơn/tra cứu; rỗng = tắt (chỉ dev/test) |
| `storefront.rateLimits.*` | xem `config/index.ts` | Cửa sổ cố định trong process theo IP (và theo mã đơn cho tra cứu) |
| `notifications.email.enabled` | `false` | Gửi email qua plugin email của app; tắt thì nhật ký ghi `skipped`. Salanca bật khi có `EMAIL_SMTP_HOST` |
| `notifications.orderLinkTemplate` | `''` | Link đơn cho khách, `{token}` đặt sau `#` (`ORDERING_ORDER_LINK_TEMPLATE` hoặc `FRONTEND_URLS` đầu + `/don-hang#t={token}`) |
| `testing.builtins` | `false` | Catalog/provider consumer test; cấm khi `NODE_ENV=production` |
| `productTypes`, `providers.*` | `{}` | Map bật/tắt theo code (`{enabled}`); validate qua zod ở `validator` |

## O3: đặt món tự lấy

- API storefront công khai: [`docs/ordering-api-contract.md`](../../../docs/ordering-api-contract.md).
- Màn Admin: Đơn hàng (hộp đơn, chi tiết, tạo đơn hộ), Chi nhánh, Nhân viên bán hàng, Settings → Bán hàng.
  Hộp thoại đơn mới cần app chủ bọc router bằng `OrderingInboxProvider`
  (`admin/src/inbox/OrderingInboxProvider.tsx`; Salanca làm ở `src/admin/app.tsx`).
- Realtime (SSE) và rate limit nằm trong process: chỉ đúng khi chạy **1 instance**.
- Hướng dẫn nhân viên: [`docs/ordering-staff-guide.md`](../../../docs/ordering-staff-guide.md); vai trò:
  [`docs/admin-roles.md`](../../../docs/admin-roles.md).

## Cấu trúc mã

```
src/plugins/ordering/
  admin/                # Admin plugin: trang Danh mục / Tạm hết món, custom field inputs
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
được phép. Content type plugin có thể mở rộng từ app qua `src/extensions/ordering/
strapi-server.ts` — ví dụ hiện có: app thêm `isFeatured` vào `catalog-product` bằng code
(attribute merge vào schema lúc boot, cột `is_featured` sync vào cùng bảng plugin và giữ
nguyên qua restart — kiểm chứng bởi `scripts/ordering/catalog-extension.mjs`). Không bao
giờ chép `schema.json` của plugin ra app: thêm attribute bằng code, phần còn lại của schema
vẫn do plugin sở hữu.

## Module catalog (O2)

9 content type `collectionName` tiền tố `plugins_ordering_catalog_*`, ẩn khỏi
Content-Type Builder:

- Nhân viên sửa qua Content Manager: `catalog-category` (cây `parent`/`rank`),
  `catalog-product`, `catalog-variant`, `catalog-price`, `catalog-modifier-group`,
  `catalog-modifier`, `catalog-availability-window`.
- Nội bộ (không sửa tay): `catalog-slug` (slug theo locale, sync qua Document Service
  middleware), `catalog-location-state` (trạng thái tạm hết món theo chi nhánh).
- `name`/`description`/`name` biến thể & modifier dùng custom field `localized-text`
  (`{vi, en, ...}` theo locale đang bật); `modifierGroups`/`bundleSlots` là custom field
  JSON có zod-validate server-side.

`catalog.adapter = 'ordering-catalog'` (mặc định) đọc catalog thật → `Sellable`: chọn giá
theo context (chi nhánh/kênh/thời điểm), variant, modifier option với `priceDelta`/
`overrideAmount`, bundle slot bắt buộc (`isRequired`), cửa sổ bán theo giờ địa phương chi
nhánh, và `catalog-location-state` (tạm hết món). Product type `food` (mặc định của
catalog product) hỗ trợ fulfillment `pickup`/`delivery`, workflow `pickup-prepay` /
`pickup-pay-on-pickup` theo `paymentTiming`.

Public read-only API (`auth:false`, cache ngắn + rate limit theo IP):

- `GET /api/v1/ordering/catalog/categories` — cây danh mục public (không `isInternal`).
- `GET /api/v1/ordering/catalog/products` — chỉ `status:'active'` + `sellOnline`.
- `GET /api/v1/ordering/catalog/products/:slug` — slug theo locale → `?locale=`.

Trang Admin plugin (menu section **Ordering**):

- **Danh mục** (`/plugins/ordering/categories`): cây + thêm/sửa/xóa, kéo-thả HTML5 đổi thứ
  tự & đổi cha (fallback nút ↑/↓ + chọn cha), route `/ordering/categories*` yêu cầu
  `plugin::ordering.catalog.manage`. `move` chạy trong transaction (rank dày đặc, chống
  chu trình); xóa chặn khi còn con, có sản phẩm thì phải `confirm` (gỡ liên kết, trả danh
  sách sản phẩm mất danh mục).
- **Tạm hết món** (`/plugins/ordering/availability`): chọn chi nhánh trong scope, bật/tắt
  product/variant/modifier, `untilKind` `end-of-business-day` (theo giờ đóng cửa chi
  nhánh) hoặc `specific-time`, tự mở lại khi hết hạn. Route `/ordering/availability*` chấp
  nhận `catalog.manage` **hoặc** `catalog.toggle-availability` (policy `has-catalog-access`)
  + scope chi nhánh của nhân viên.

Permission mới: `plugin::ordering.catalog.manage`, `plugin::ordering.catalog.toggle-availability`
(mỗi thao tác sửa catalog/trạng thái bán ghi một dòng `admin-change-log`).

Order line giữ snapshot bất biến khi tạo đơn: `titleSnapshot`/`sku`/`variantUid`,
`selectedOptionsSnapshot` (tùy chọn đã chọn), `categoriesSnapshot`, `componentsSnapshot`
(thành phần combo theo slot) — sửa catalog sau này không đổi đơn cũ.

## Service public

Gọi qua `strapi.plugin('ordering').service('<tên>')`. Mọi hàm nghiệp vụ nhận `ctx:
ServiceContext = { actor: ActorContext; now?: Date }`; `ActorContext` là
`{ kind: 'system' }`, `{ kind: 'customer', actorRef? }` hoặc `{ kind: 'staff', adminUserId,
allLocations?, locationRefs? }` (dựng bằng `scope.actorFromAdminUser`).

- `order.createOrder(input, ctx)` → `{ order: aggregate, publicToken, replayed }` —
  idempotent theo `idempotencyKey`; `getOrder(id, ctx)`, `listOrders(where, ctx)` (cần
  scope), `confirmDraft({orderId}, ctx)`.
- `transition.transitionGroup({orderId, groupId, to}, ctx)`, `cancelOrder`, `customerCancel` (khóa các group,
  kiểm tra quyền tự hủy trên trạng thái đã khóa, hủy và hoàn tiền còn giữ trong một transaction).
  Mọi đường đóng đơn bị hủy/hết hạn (staff, khách, job `payment-expiry`) hoàn tiền còn giữ
  qua `refund.refundHeldForOrder`.
- `payment.createPayment({orderId, providerCode}, ctx)`,
  `recordPaymentEvent({providerCode, providerTransactionId, ...}, ctx)`,
  `capturePayment({paymentId, amount, providerTransactionId}, ctx)` — idempotent theo txnId.
- `refund.createRefund({paymentId, amount?|lines?, reason, idempotencyKey}, ctx)` —
  theo dòng dùng quy tắc telescoping; `createRefundInTransaction` là lõi trong transaction
  cho service khác dùng (`countsAs: 'canceled'`).
- `line-cancel.cancelLineQuantity({orderId, lineId, quantity, reason}, ctx)` — hủy một phần
  món: `canceledQuantity += q`, không tự chuyển group. Phần tiền của món hủy rời khỏi số còn phải
  trả (`domain/payable`: `due = totalAmount − order.canceledAmount − captured`; `totalAmount` giữ nguyên
  làm snapshot, `order-edit` định giá lại và đặt `canceledAmount = 0`). Chỉ tiền đang giữ vượt số còn phải trả mới hoàn — đơn chưa trả/trả một phần không hoàn.
  Khoản hoàn chia qua nhiều payment (lớn nhất trước); `refundShortfall` là phần đáng hoàn nhưng
  đã bị phiếu hoàn pending giữ chỗ.
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
pnpm run check:ordering   # build + các integration script trên salanca_ordering_test
                          # (xem danh sách trong scripts/ordering/run-all.mjs)
```

Integration scripts (`scripts/ordering/`) boot Strapi thật trên Postgres loopback
`salanca_ordering_test` với `ORDERING_TEST_BUILTINS=true` (tắt cron, bật test catalog/
provider/consumer). Không bao giờ chạy trên `salanca_cms`.

## Chưa có (O3–O6)

API order phía public, voucher/scheduling/fulfillment provider, ops-alert delivery, báo
cáo/export, webhook endpoint thật, pendingStats dashboard. `test.ping`/`test.fail` chỉ
tồn tại dưới `testing.builtins`.
