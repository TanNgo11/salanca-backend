# O1 — Lõi đơn hàng: kế hoạch thực hiện

Status: Automated verification passed
Owner: tan_ngo (duyệt), Claude (thực hiện)
Last updated: 2026-10-10
Related phase: [`phases/phase-ordering-1-core.md`](../phases/phase-ordering-1-core.md)

## Goal

Lõi đơn hàng chạy được bằng service và test: tạo đơn, tính tiền, chuyển bước, ghi tiền, phát event qua
outbox, lọc theo chi nhánh. Chưa có API công khai hay giao diện.

## Non-goals

- Catalog thật (O2), API storefront và Admin (O3), SePay (O4), giao hàng (O5), báo cáo (O6).
- Khuyến mãi, VAT bật, voucher, lịch hẹn, tồn kho.

## Current evidence

- Kết quả O0: cách build plugin (`tsc` riêng cho server, admin đọc source), thứ tự lifecycle, zod từ
  `@strapi/utils` (xem `ordering-spike.md` và báo cáo spike khi có).
- Thiết kế: contracts mục 1–8, 12, 15, 19, 20 (`Sellable`).
- App đang dùng Vitest cho `src/**/*.test.ts` (`vitest.config.ts`); script tích hợp boot Strapi bằng
  `compileStrapi()` + `createStrapi().load()` như `scripts/smoke-content-crud.mjs`.

## Decisions and assumptions

- Decision: mã nằm trong `src/plugins/ordering`, không import code app; app chỉ gọi service public.
- Decision: logic thuần (tiền, phân bổ, workflow, projection, ngày kinh doanh) nằm trong `domain/`, không
  import Strapi, test bằng Vitest không cần DB. Phần chạm DB nằm trong `services/` và `repositories/`.
- Decision: test tích hợp chạy trên DB riêng `salanca_ordering_test` (assert tên DB ở đầu script).
- Assumption: migration theo phương án O0 chốt; nếu O0 chọn DDL idempotent trong bootstrap thì bước 2
  dùng cách đó.

## Cấu trúc mã của plugin (dùng chung cho O1–O6)

```
src/plugins/ordering/
  package.json                 # exports strapi-server (dist) và strapi-admin (source)
  README.md                    # cho dev: cài đặt, config, extension, adapter
  server/tsconfig.json
  server/src/
    index.ts register.ts bootstrap.ts destroy.ts
    config/                    # default + validator (zod)
    contracts/                 # type và interface khớp contracts doc (Sellable, PaymentProvider...)
    domain/                    # thuần TS: money, pricing, allocation, tax, workflow, projection,
                               # business-date, scope, errors, hashing
    content-types/<name>/      # schema.ts + index.ts mỗi type
    repositories/              # bọc strapi.db.query, nhận trx
    services/                  # registry, order, transition, payment, refund, outbox, job-lock,
                               # hold, idempotency, scope, timeline, alert
    providers/                 # provider dựng sẵn: test-payment, cash, pickup...
    jobs/                      # outbox-dispatcher, hold-expiry, idempotency-cleanup
    routes/ controllers/ policies/
    migrations/                # theo cách O0 chốt
  admin/src/                   # index.ts, pluginId.ts, pages/, components/, api/, translations/
scripts/ordering/              # script tích hợp, DB riêng
```

## Invariants

- Mọi thay đổi tiền, trạng thái, hold và outbox trong cùng một transaction.
- `Σ allocation.amount = adjustment.amount`; `Σ lineTotal + fulfillmentAmount = grandTotal`.
- `fulfilledQuantity + returnedQuantity + canceledQuantity ≤ quantity`.
- Không ghi tiền hai lần cho cùng `providerCode + providerTransactionId`.
- Đọc và ghi đơn luôn đi qua scope chi nhánh; không có scope là từ chối.
- Log không chứa tên, số điện thoại, email, địa chỉ, token.

## Implementation steps

1. **Khung plugin** (lấy lại từ stash O0, đổi theo cấu trúc trên)
   - Files: `src/plugins/ordering/{package.json, server/src/index.ts, config/, contracts/}`,
     `config/plugins.ts` (+ test), `package.json` (`build:ordering`), `src/ordering/register-ordering-adapters.ts`.
   - Verification: `pnpm run typecheck`, `pnpm run test`, `pnpm run build`; boot với
     `ORDERING_ENABLED=true` log đủ lifecycle.
2. **Lỗi chuẩn và tiền**
   - Files: `domain/errors.ts` (`OrderingError` có `code`, `status`, `details`), `domain/money.ts`
     (`toMoney`, `addMoney`, kiểm safe integer, đổi `biginteger` string).
   - Verification: Vitest: vượt safe integer, string không phải số, cộng khác currency đều ném lỗi.
3. **Content type nội bộ và migration nền**
   - Files: `content-types/{order, order-line, order-adjustment, adjustment-allocation, fulfillment-group,
     fulfillment, fulfillment-line, payment, payment-event, refund, refund-line, order-event, hold,
     idempotency-key, outbox, order-job-lock, staff-location-scope, ops-alert}/`, `migrations/`.
   - Làm: `collectionName` `plugins_ordering_*`; ẩn khỏi Content Manager và Content-Type Builder; unique:
     `order.code`, `order.publicTokenHash`, `payment-event(providerCode, providerTransactionId)`,
     `idempotency-key(scope, key)`, `outbox.uniqueKey`, `order-job-lock(jobName, shardKey)`,
     `staff-location-scope.adminUserId`; index: `order(locationRef, businessDate)`, `order(status)`,
     `outbox(availableAt) where deliveredAt is null`; sequence `plugins_ordering_order_code_seq`.
   - Verification: script `scripts/ordering/schema.mjs` liệt kê bảng, index, sequence và so với danh sách
     mong đợi.
4. **Registry và contract**
   - Files: `contracts/*.ts`, `services/registry.ts`, `providers/test-payment.ts`,
     `domain/product-types/test-product.ts`.
   - Làm: đăng ký catalog adapter, product type, payment/fulfillment/scheduling/voucher/captcha/
     notification provider; `bootstrap()` dừng khi code đang bật không có trong registry.
   - Verification: Vitest cho registry (trùng code ném lỗi); boot với code thiếu → Strapi dừng với thông
     báo rõ.
5. **Pipeline giá (thuần)**
   - Files: `domain/pricing/{pipeline.ts, allocation.ts, tax.ts, totals.ts}`.
   - Làm: 9 bước mục 6; phân bổ phần dư lớn nhất có thứ tự ổn định khi bằng nhau (theo `line.id`); thuế
     gồm/không gồm; kiểm tổng.
   - Verification: Vitest dạng bảng ≥ 20 ca (1–10 line, giảm %, giảm cố định, phí, VAT 8%/10%, gồm và
     không gồm, line giá 0); thuộc tính "tổng luôn khớp" chạy 1.000 bộ ngẫu nhiên có seed.
6. **Workflow và projection (thuần)**
   - Files: `domain/workflow/{definition.ts, transition.ts, projection.ts}`.
   - Làm: kiểm graph (initial tồn tại, `next` hợp lệ, terminal không có cạnh ra, `terminal` có
     `success`/`canceled`), `canTransition`, projection `order.status`, `paymentStatus`,
     `fulfillmentStatus`.
   - Verification: Vitest cho graph sai; bảng tổ hợp group × payment → status theo bảng mục 7.
7. **Ngày kinh doanh và scope (thuần)**
   - Files: `domain/business-date.ts`, `domain/scope.ts`.
   - Verification: Vitest: giờ chốt 04:00, quán 22:00–02:00, server UTC; scope `allLocations`, rỗng, nhiều
     chi nhánh.
8. **Idempotency service**
   - Files: `services/idempotency.ts`, `domain/hashing.ts` (SHA-256 của payload chuẩn hóa).
   - Verification: script tích hợp: cùng key → cùng kết quả; khác payload → `IDEMPOTENCY_PAYLOAD_MISMATCH`;
     hai request song song cùng key → một bản ghi.
9. **Tạo đơn**
   - Files: `services/order.ts` (`createOrder(input, ctx)`), `repositories/order.ts`, `services/timeline.ts`,
     `services/hold.ts`.
   - Làm: trong một transaction: idempotency → re-quote qua pipeline → `selectWorkflow` → group → line
     snapshot → adjustment + allocation → hold → mã từ sequence → token (trả 1 lần, lưu hash) →
     `businessDate` → timeline → outbox `order.created`.
   - Verification: script tích hợp tạo 200 đơn song song: mã không trùng; lỗi giữa chừng không để lại
     dòng nào; `allowMixedProductTypes` false/true.
10. **Chuyển bước**
    - Files: `services/transition.ts`.
    - Làm: khóa group `forUpdate`, kiểm `canTransition`, ghi timeline (`isPublic` theo bước), cập nhật
      projection, outbox `fulfillment-group.transitioned` và `order.transitioned` khi status đổi.
    - Verification: hai transition song song trên cùng group → một thành công, một bị từ chối.
11. **Sổ thanh toán và hoàn tiền**
    - Files: `services/payment.ts`, `services/refund.ts`, `domain/payment-status.ts`.
    - Làm: `recordPaymentEvent` (unique), `capture`, `refund` + `refund-line` từ snapshot; cập nhật
      `paymentStatus`; outbox `payment.event.received`, `payment.captured`, `refund.settled`.
    - Verification: event trùng không ghi tiền lần hai; capture một phần, refund một món, refund hết →
      status đúng.
12. **Outbox, khóa job, cron**
    - Files: `jobs/outbox-dispatcher.ts`, `services/job-lock.ts`, `jobs/hold-expiry.ts`,
      `jobs/idempotency-cleanup.ts`, đăng ký cron trong `bootstrap()`.
    - Làm: claim `FOR UPDATE SKIP LOCKED` theo lô 50, lease 5 phút, backoff mũ có trần, consumer
      registry, consumer idempotent theo event id.
    - Verification: script 2 process (`scripts/ordering/outbox-two-process.mjs`): 500 event, mỗi event
      giao đúng một lần; kill một process → event của nó được nhận sau lease.
13. **Scope ở service**
    - Files: `services/scope.ts`, condition `plugin::ordering.same-location` trong `bootstrap()`.
    - Làm: đọc `staff-location-scope` theo admin user; Super Admin coi là `allLocations`; predicate cho
      query; `assertOrderInScope` trả `ORDER_NOT_FOUND`; condition trả `false` khi không có scope.
    - Verification: script 2 chi nhánh × 2 nhân viên cho đọc, transition, refund; condition trả `false` khi
      không có scope; handler nhận thẳng object user (kết quả spike O0).
14. **Tài liệu dev**
    - Files: `src/plugins/ordering/README.md`; sửa contracts nếu code buộc đổi thiết kế.
    - Verification: đọc lại; `git diff --check`.

15. **Bổ sung sau review (2026-10-10)** (contracts mục 21)
    - Files: `content-types/{branch, admin-change-log}/`, field `consentSnapshot`, `customerNote`, relation
      `branch` trên `order`; `domain/order-code.ts`; `services/line-cancel.ts`; `services/change-log.ts`;
      `domain/pricing/cash-rounding.ts`; `scripts/ordering/_harness.mjs`.
    - Làm:
      - `branch.code` unique và không sửa được sau khi tạo (middleware chặn).
      - Mã đơn từ `orderCodeTemplate` (mặc định `{prefix}-{seq:6}`).
      - `cancelLineQuantity(orderId, lineId, quantity, reason)`: kiểm invariant số lượng, refund + refund-line
        theo số đã phân bổ nếu đã thanh toán, timeline `isPublic`, outbox.
      - Nhật ký thay đổi che dữ liệu cá nhân và secret; emit eventHub không chứa giá trị.
      - `cashRounding` tạo adjustment `rounding` cho đơn tiền mặt khi bật.
      - Harness: `bootOrderingTestApp()` kiểm `DATABASE_NAME=salanca_ordering_test`, xóa bảng
        `plugins_ordering_*` giữa các script, fixture 2 chi nhánh + 2 nhân viên + 1 quản lý chuỗi.
    - Verification: Vitest cho mã đơn và làm tròn tiền mặt; tích hợp: hủy 1 trong 3 món sau khi đã thu tiền
      → refund đúng số đã phân bổ, tổng khớp; đổi `branch.code` bị từ chối; change-log không chứa số điện
      thoại.

## Data and rollback

- Migration/backfill: bảng mới, chưa có dữ liệu thật.
- Compatibility: `ORDERING_ENABLED=false` mặc định; app Salanca không đổi.
- Rollback: tắt cờ; drop bảng `plugins_ordering_*` và sequence nếu cần.

## Verification

- Automated: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`,
  `pnpm run check:phase3`; `node scripts/ordering/*.mjs` với `DATABASE_NAME=salanca_ordering_test`,
  `ORDERING_ENABLED=true`.
- Manual UAT: Admin không hiện bảng nội bộ ở Content Manager và Content-Type Builder.
- Evidence to record: lệnh và kết quả trong `docs/STATUS.md` và Completion record.

## Documentation impact

- `src/plugins/ordering/README.md` (mới); contracts nếu lệch; `docs/STATUS.md`.

## Risks and blockers

- Workflow engine tự viết: giữ nhỏ, test dạng bảng.
- Test 2 process chậm và dễ chập chờn: chạy riêng, không nằm trong `pnpm run test`.
- Phụ thuộc kết quả O0 (migration, build).

## Completion record

### Đã làm (nhánh `feat/ordering-o1`, 18 commit, chưa push, chưa merge `main`)

- Bước 1–15 xong theo kế hoạch; mỗi bước một commit, riêng bước 13 hai commit (service + script
  engine): 16 commit `f8220d1` … `6222457`, thêm 2 commit sửa `8e1f9fd` (unique index ở DB) và
  `bce6979` (giữ bảng khi tắt plugin). Tổng 18 commit O1.
- Mã: `src/plugins/ordering/server/src/{contracts,domain,content-types,repositories,services,providers,jobs,migrations}`;
  20 content type nội bộ; migration `0001-o1-core`; README plugin; `scripts/ordering/*.mjs` (11 script) và
  `pnpm run check:ordering`.
- Ví dụ mockup thành test: giảm 25.000đ → 14.773 / 5.114 / 5.113; VAT 8% gồm trong giá → 8.535 / 2.955 / 2.955
  (tổng 14.445); hoàn Trà đào = 39.886; hủy 1/3 Gỏi cuốn = 13.296; bảng projection và bảng `businessDate`
  (thứ Bảy 01:30, chốt 04:00 → thứ Sáu).

### Lệnh đã chạy (2026-10-10, DB `salanca_ordering_test`)

| Lệnh | Kết quả |
| --- | --- |
| `pnpm run lint`, `pnpm run typecheck` | đạt |
| `pnpm run test` | đạt, 129 file / 857 test (O0: 112 / 677) |
| `ORDERING_ENABLED=true pnpm run build` | đạt |
| `ORDERING_ENABLED=false pnpm run check:phase3` | đạt |
| `ORDERING_ENABLED=true pnpm run check:phase3` | đạt; `types/generated/contentTypes.d.ts` không đổi |
| `pnpm run check:ordering` (chạy lại sau hai lượt `check:phase3` ở trên, không tạo lại DB) | đạt 11/11: schema, disable-survives, registry-boot, idempotency, create-order (200 đơn song song, mã không trùng), transition (2 transition song song → 1 đạt 1 bị từ chối), payment-refund, outbox-two-process (500 event giao đúng một lần, 10 event được nhận lại sau lease 3 giây của process bị kill), jobs, scope (service + engine phân quyền Strapi), review-additions |

### Lệch so với kế hoạch và lý do

- **Tắt plugin từng làm mất bảng.** Schema sync của Strapi xóa bảng có trong schema đã lưu lần trước nhưng
  không có trong schema hiện tại, nên boot với `ORDERING_ENABLED=false` sau khi đã bật sẽ drop mọi bảng
  `plugins_ordering_*` (phát hiện khi `check:phase3` tắt/bật làm mất index của migration). Sửa: bootstrap ghi tên
  bảng vào core store `persisted_tables` (cơ chế Strapi dùng cho bảng audit EE); script `disable-survives.mjs`
  kiểm. Rollback "tắt cờ" trong spec vì vậy chỉ an toàn từ bản này.
- Strapi 5 không tạo unique index cho `unique: true`; migration tự tạo (order.code, publicTokenHash, branch.code,
  staff-location-scope.adminUserId, outbox.uniqueKey).
- `WorkflowDefinition` thêm `cancelState` và `customerCancellable`; `completed` dùng tiền thu gộp
  (`Σ captured ≥ total`), hoàn tiền không mở lại đơn (contracts mục 7 đã ghi).
- Condition `same-location` đăng ký trong `register()` (như O0 đã chứng minh), không phải `bootstrap()`.
- Builtin test (`test-catalog`, product type `test-food`/`test-service`, provider `test`, consumer `test.ping`/
  `test.fail`) chỉ bật khi app đặt `testing.builtins = true`; `config/plugins.ts` bật qua env
  `ORDERING_TEST_BUILTINS=true` (validator từ chối ở production). Adapter `ordering-catalog` là stub tới O2.
- Trả lời idempotent (replay) không trả lại `publicToken` (token chỉ cấp một lần); snapshot lưu orderId, code,
  status, total.
- `cancelLineQuantity` không tự chuyển group sang hủy và không đổi `order.totalAmount`; nhân viên hủy group rõ ràng.
- Làm tròn tiền mặt nửa ra xa số 0 (195.500 → 196.000). `payment-event` không khớp payment nào mặc định
  `needs-review` / `order-not-found`. Outbox có thêm cột `failedAt` (quá `maxAttempts` thì dừng retry).
- Hạn mục trong product type test: bỏ qua `freeQuantity`.

### Còn mở

- UAT thủ công: xem trong Admin rằng 20 bảng nội bộ không hiện ở Content Manager và Content-Type Builder
  (script đã kiểm `pluginOptions`, chưa kiểm bằng mắt).
- Chưa push; chưa merge `main`; stash O0 `stash@{0}` vẫn còn.
