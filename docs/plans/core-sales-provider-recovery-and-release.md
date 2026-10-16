# Core-sales: phục hồi provider và gate phát hành

Status: Round-7 blockers implemented; automated gate passed; NO-GO pending manual UAT and remaining provider hardening
Owner: Ordering maintainer; owner sản phẩm duyệt phạm vi sau go-live
Last updated: 2026-10-15
Related phase: [O13 — Provider](../phases/phase-ordering-13-providers.md), [audit vòng 7](../../artifacts/core-sales-audit-20261015-round7/report.md), [tổng hợp audit](../../artifacts/core-sales-audit-20261015-summary/report.md)

## Kết luận phát hành

**NO-GO cho production.** Hai P1 vòng 7 đã được sửa và full automated gate đã xanh trên
working tree hiện tại. Chưa được bật tiền/giao hàng thật vì chưa UAT sandbox/provider thật và
chưa chạy release rehearsal. `carrierCancel` đã dùng durable protocol như booking, cảnh báo
critical `carrier-operation-unknown` và tab Ops **Đối tác giao xe** đã có (2026-10-16).

Hai lỗi P1 đã tái hiện trên PostgreSQL thật ở HEAD `de77da5` cùng working tree ngày 2026-10-15:

1. Lỗi tạm thời khi hỏi trạng thái MoMo/VNPay có thể làm payment `pending` cũ bị chuyển thành `cancelled` dù provider chưa trả kết luận nghiệp vụ.
2. Provider đã nhận lệnh gọi xe nhưng lần ghi DB sau đó thất bại; retry gọi provider lần nữa và tạo chuyến thứ hai.

Working tree hiện có bản sửa chưa commit. `pnpm run check:ordering` đã kết thúc với marker
`all 106 scripts passed` trên PostgreSQL riêng `salanca_ordering_release_gate`; các regression
`wallet-status.mjs` và `provider-recovery.mjs` nằm trong gate. Kết quả này đóng hai failure path
vòng 7 ở mức automated integration, nhưng không thay thế browser UAT, provider sandbox thật hoặc
release rehearsal.

## Goal

- Không biến lỗi mạng/provider thành kết luận khách chưa thanh toán.
- Không tự tạo side effect provider lần hai khi lần đầu có thể đã thành công.
- Chuyển hai reproducer vòng 7 thành regression được duy trì trong `scripts/ordering`.
- Chạy lại toàn bộ core-sales audit trên một snapshot cố định, PostgreSQL riêng, rồi mới đưa snapshot sang manual UAT.
- Chốt phạm vi feature sau go-live theo nhu cầu nhà hàng, không chạy đua số lượng tính năng với WooCommerce.

## Non-goals

- Không bật provider thật hoặc ghi dữ liệu production trong đợt sửa.
- Không thêm marketplace plugin, subscription, multi-vendor, SEO storefront hay international commerce.
- Không mở thêm payment/carrier mới trước khi protocol phục hồi provider hiện tại đạt gate.
- Không coi fixture provider là UAT sandbox thật.
- Không trộn batch sửa đang có với refactor không liên quan.

## Baseline evidence before the fix

- Wallet outage: `queryCount=1`, payment đổi thành `cancelled`, không có payment event/review, lượt job sau không hỏi lại provider (`checked=0`). Nguồn lỗi ở `jobs/wallet-status.ts`; lớp HTTP chung ném `PROVIDER_UNAVAILABLE`.
- Carrier atomicity: provider fixture ghi nhận `AUDIT-ATOMIC-TRIP-1` và `AUDIT-ATOMIC-TRIP-2`; DB chỉ giữ chuyến thứ hai. Nguồn lỗi ở `services/carrier-assignment.ts`: `provider.book()` chạy trong transaction trước khi `providerReference` được commit.
- `PaymentProvider.queryTransaction` đã từng trả `NormalizedPaymentEvent | null`; contract không phân biệt `pending`, `terminal-not-found` và lỗi hạ tầng.
- `FulfillmentProvider.book` đã từng không có client reference/idempotency contract. PostgreSQL lock chỉ serialize các request nội bộ; nó không rollback hoặc dedupe side effect bên ngoài.
- Wallet refund đã có mẫu tốt hơn: ghi refund pending + stable request id, commit, rồi dispatch qua outbox. Carrier cần cùng nguyên tắc, cộng thêm trạng thái `unknown` vì provider giao hàng có thể không hỗ trợ idempotency.
- `docs/STATUS.md` trước bản sửa chỉ chứa kết quả gate của các snapshot cũ. Kết quả working tree hiện tại được ghi riêng sau khi full gate kết thúc.

## Decisions and assumptions

- Decision: `PROVIDER_UNAVAILABLE`, timeout, HTTP 5xx, response lỗi hoặc response không phân loại được đều là **unknown/retryable**; không được cancel payment hay kết luận thất bại.
- Decision: chỉ response đã được adapter map rõ thành kết quả nghiệp vụ terminal mới được đóng session.
- Decision: trạng thái query payment dùng union có phân biệt, ví dụ `event | pending | terminal-not-found`; không dùng `null` cho nhiều nghĩa.
- Decision: mọi lệnh provider có side effect phải có intent durable được commit trước outbound call.
- Decision: carrier operation unresolved chặn auto-book. Khi chưa chứng minh provider hỗ trợ idempotency hoặc lookup theo client reference, hệ thống thà yêu cầu reconcile thủ công còn hơn tạo chuyến thứ hai.
- Decision: dùng một row `provider-operation` có index/unique và vòng đời rõ, không giấu state machine trong JSON metadata của fulfillment. Tên migration lấy số kế tiếp tại lúc triển khai vì working tree đang có thay đổi song song.
- Decision: outbox chỉ điều phối lần gọi đầu và các retry đã chứng minh an toàn. Nó không tự tạo exactly-once qua biên DB/provider.
- Decision: MoMo `1005` là checkout hết hạn và được map thành payment event `failed`; response code
  không biết vẫn là `pending`. VNPay QueryDR `91` là `terminal-not-found`; lỗi transport/HTTP hoặc
  response khác hợp đồng vẫn là lỗi retryable. Mapping đã được đối chiếu với tài liệu provider chính thức.
- Owner decision required: Ahamove account/API đang dùng có idempotency key hoặc lookup theo client reference hay không. Quyết định này chỉ ảnh hưởng khả năng tự reconcile; không được hạ tiêu chuẩn chặn duplicate.

## Invariants

- Tổng captured/refunded/held của order vẫn lấy từ toàn bộ payment ledger, không từ payment đầu tiên.
- `PROVIDER_UNAVAILABLE` không bao giờ đổi payment `pending` sang `cancelled`.
- Một payment session lỗi query vẫn còn đường retry hoặc review; không biến mất khỏi reconciliation.
- Mỗi carrier book/cancel có một operation key ổn định. Retry cùng thao tác không phát sinh key mới.
- Khi outbound call có thể đã tới provider nhưng kết quả chưa commit, operation phải thành `unknown`; nút gọi xe bị chặn và Ops có cảnh báo critical.
- Không giữ PostgreSQL transaction/row lock trong lúc chờ HTTP provider.
- Provider payload, secret, số điện thoại và địa chỉ không đi vào log, alert hoặc change log.
- Reconcile/resolve thủ công cần quyền phù hợp, lý do bắt buộc và append-only change log.
- Lock order của order/group/fulfillment/payment không đảo so với quy ước hiện tại.

## Implementation steps

1. **Đóng băng baseline và tạo regression đỏ**
   - Files/modules: giữ nguyên artifact vòng 7; thêm case vào `scripts/ordering/wallet-status.mjs` và một script carrier recovery mới hoặc `scripts/ordering/ahamove.mjs`; đăng ký trong `scripts/ordering/run-all.mjs`.
   - Cases bắt buộc:
     - wallet session quá 2 giờ + `PROVIDER_UNAVAILABLE` vẫn `pending`, job sau hỏi lại được;
     - query trả `pending` không bị đóng;
     - terminal failed/not-found đã map rõ mới đóng;
     - provider book thành công + lỗi DB finalize; retry không gọi provider lần hai;
     - hai request gọi xe đồng thời chỉ có một operation;
     - crash sau commit intent nhưng trước outbound call không cho phép đường API tự tạo operation khác.
   - Verification: từng case đỏ trên code trước fix và lưu evidence ngắn trong artifact mới; không sửa artifact vòng 7 để xóa lịch sử.

2. **Sửa contract và job query ví**
   - Files/modules: `contracts/payment.ts`, `providers/momo/provider.ts`, `providers/vnpay/provider.ts`, `jobs/wallet-status.ts`, provider unit tests, `scripts/ordering/wallet-status.mjs`.
   - Thay return type mơ hồ bằng kết quả phân loại. Adapter giữ unknown result code ở `pending/review`, không tự gán failed.
   - Ghi `lastAttemptAt`, `nextAttemptAt`, số lỗi liên tiếp và error code đã lọc trong session metadata; dùng `updatedAt`/`nextAttemptAt` để quay vòng công bằng, tránh một row lỗi chiếm batch.
   - Mở alert sau ngưỡng; tự resolve khi query thành công hoặc payment rời `pending`.
   - Verification: regression bước 1 xanh; thêm batch lớn hơn giới hạn để chứng minh session phía sau không bị starvation.

3. **Thêm durable carrier operation**
   - Files/modules dự kiến: content type mới `provider-operation`, migration mới, `content-types/index.ts`, contract fulfillment, `services/carrier-assignment.ts`, `register.ts`, provider Ahamove, schema/retention tests.
   - Trạng thái tối thiểu: `prepared`, `dispatching`, `succeeded`, `rejected`, `unknown`, `resolved`.
   - Row giữ `operationKey`, `kind` (`book`/`cancel`), provider, fulfillment, request hash/sanitized request, external reference, attempts, timestamps và error code đã lọc. Unique constraint ngăn hai operation active cùng kind/fulfillment.
   - Transaction chuẩn bị: lấy lock đúng thứ tự, đọc lại order/group/fulfillment, tính COD bất biến, xử lý wallet session theo rule hiện tại, ghi operation + outbox rồi commit.
   - Consumer claim operation, đổi sang `dispatching`, commit, sau đó mới gọi provider. Thành công được finalize trong transaction mới cùng operation key.
   - Validation/rejection chắc chắn thành `rejected`. Timeout, lỗi mạng, 5xx hoặc lỗi finalize sau provider success thành `unknown`; outbox kết thúc, không retry mù.
   - Nếu provider hỗ trợ stable idempotency key, mọi retry dùng `operationKey`. Nếu provider hỗ trợ lookup, job reconcile hỏi theo key rồi finalize. Nếu không, chỉ đường Ops có kiểm soát được resolve/retry sau khi nhân viên xác minh.
   - Áp cùng protocol cho `carrierCancel`; cancel hiện cũng gọi HTTP trong transaction và có cùng cửa sổ lệch DB/provider.

4. **Thêm Ops recovery và cảnh báo**
   - Files/modules: `domain/alert-codes.ts`, `services/alert-rules.ts`, Ops status/controller/routes, Admin Ops/provider screen và translations.
   - Mã cảnh báo dự kiến: `wallet-status-provider-unavailable`, `carrier-operation-unknown`.
   - Ops hiển thị operation key, order code, provider, kind, tuổi operation và trạng thái; không hiển thị PII/secret.
   - Hành động `confirm succeeded`, `confirm rejected`, `retry after provider check` cần quyền ops, lý do và change log. Retry bị từ chối nếu không có bằng chứng provider lookup/idempotency hoặc xác nhận thủ công.
   - Verification: permission matrix, audit coverage, alert open/dedupe/resolve và response redaction.

5. **Chạy lại toàn bộ audit core-sales trên snapshot cố định**
   - Hoàn tất hoặc tách sạch batch sửa đang có; ghi commit/snapshot chính xác trước khi chạy.
   - Chuyển mọi root cause đã sửa từ artifact sang maintained regression. Chạy lại 24 failure paths lịch sử; báo cáo phân biệt `fixed on current snapshot`, `historical`, `open`.
   - Không gộp hai biểu hiện “đóng bàn” và “Thu tiền và giao” thành hai fix nếu cùng đi qua một helper thu tiền; test cả hai entry point nhưng giữ một root cause.

6. **Release gate**
   - Automated, theo thứ tự:

     ```powershell
     pnpm run build:ordering
     pnpm run lint
     pnpm run typecheck
     pnpm run typecheck:admin
     node scripts/ordering/wallet-status.mjs
     node scripts/ordering/ahamove.mjs
     node scripts/ordering/jobs.mjs
     node scripts/ordering/ops-status.mjs
     node scripts/ordering/alerts-engine.mjs
     node scripts/ordering/payment-refund.mjs
     node scripts/ordering/momo.mjs
     node scripts/ordering/vnpay.mjs
     node scripts/ordering/delivery-assignment.mjs
     pnpm run check:ordering
     ```

   - Mỗi integration run dùng PostgreSQL disposable riêng và không chạy đồng thời trên cùng DB.
   - Chạy `check:ordering` hai lượt liên tiếp sau khi targeted gates xanh để bắt state leak/idempotency.
   - Manual UAT: MoMo/VNPay sandbox gồm mất IPN + query outage + hoàn một phần; Ahamove sandbox gồm success, timeout/unknown, lookup/reconcile, cancel; browser kiểm tra nút bị chặn và Ops recovery.
   - Go-live rehearsal: backup/restore, job scheduling, alert recipient, runbook, provider credential rotation và rollback drill.

## Data and rollback

- Migration/backfill: tạo table/index mới; không backfill operation cho fulfillment đã có `providerReference`. Fulfillment không có ref nhưng đã từng bấm gọi xe trước migration phải được rà soát trước khi bật provider.
- Compatibility: public storefront API không đổi. Admin carrier action có thể trả thêm reason `operation-unknown`; OpenAPI và client mapping phải cập nhật.
- Retention: operation terminal theo policy vận hành/audit; `unknown` không được retention job xóa.
- Rollback: có thể tắt provider bằng env. Không rollback về code cũ khi còn operation `dispatching/unknown`, vì code cũ sẽ nhìn `providerReference = null` và book lại. Phải resolve hoặc giữ guard forward-compatible trước.

## So sánh phạm vi với WooCommerce

Mục tiêu đúng là đủ cho vận hành nhà hàng, không phải clone WooCommerce. WooCommerce có bề rộng ecommerce và hệ sinh thái extension lớn; Salanca đã có các luồng chuyên nhà hàng mà WooCommerce core không tự cung cấp như KDS, bàn/QR, suất bán theo ngày, đóng tiền mặt và carrier workflow. Các khoảng trống đáng làm được xếp theo giá trị/rủi ro:

| Ưu tiên | Khoảng trống | Quyết định |
| --- | --- | --- |
| Trước go-live | Provider recovery/idempotency, full audit regression, sandbox UAT, backup/restore, alert/runbook | Bắt buộc; nằm trong plan này |
| Trước bán online | Web đặt món thực tế: catalog, cart, checkout, payment return, theo dõi đơn, tài khoản khách; mobile/accessibility/error recovery | Backend hiện không thay thế storefront; làm ở phase OW sau khi core đạt gate |
| Ngay sau ổn định | Hóa đơn điện tử/biên lai và đối soát kế toán/ERP; báo cáo doanh thu-thuế-phí-hoàn theo cùng cơ sở ngày | Đề xuất phase riêng; cần kế toán chốt contract |
| Ngay sau ổn định | Modifier/combo/upsize/topping có giá, SKU và rule bếp rõ | Đề xuất nếu catalog hiện tại chỉ đủ variant cơ bản; ưu tiên cao cho nhà hàng |
| Ngay sau ổn định | Tồn nguyên liệu/BOM, hao hụt, điều chỉnh, chuyển kho và cảnh báo thấp | `daily-stock` chỉ là tồn suất bán; không được quảng cáo thành quản lý kho đầy đủ |
| Sau go-live | Vùng/phương thức/phí giao hàng cấu hình được, nhiều carrier và SLA | Làm khi có nhu cầu ngoài Ahamove/quán tự giao |
| Sau go-live | Báo cáo cohort/customer, coupon/promotion attribution, return/refund/tax drill-down và export chuẩn | Bổ sung sau khi số liệu core được chứng minh khớp sổ |
| Tích hợp | REST/OpenAPI/webhook lifecycle, retry log, ERP/CRM connector SDK | Nền O10 đã có; cần compatibility/versioning và integration certification |
| Không ưu tiên | Subscription, marketplace nhiều người bán, sản phẩm số, SEO catalog quốc tế, multi-currency/international tax | Không có bằng chứng nhu cầu nhà hàng hiện tại; thêm sớm là scope rác |

Nguồn tham chiếu phạm vi WooCommerce chính thức:

- Inventory: stock count, hold stock, backorder và low/out-of-stock notifications — <https://woocommerce.com/document/configuring-woocommerce-settings/products/>
- Variable products và tồn theo variation — <https://woocommerce.com/document/variable-product/>
- Product Add-Ons — <https://woocommerce.com/document/product-add-ons/>
- Shipping zones/methods — <https://woocommerce.com/document/setting-up-shipping-zones/>
- Analytics theo sales, returns, coupons, taxes và shipping — <https://woocommerce.com/document/woocommerce-analytics/>
- REST API và webhooks — <https://developer.woocommerce.com/docs/apis/rest-api/> và <https://woocommerce.com/document/webhooks/>
- HPOS — <https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/enable-hpos/>

## Verification

- Automated: các lệnh ở bước 6, cùng reproducer vòng 7 và matrix 24 failure paths.
- Manual UAT: provider sandbox thật, Admin/browser, thiết bị vận hành liên quan và recovery drill.
- Evidence to record: commit SHA, `git status --short`, DB name, exit code, số test, log path, provider sandbox reference đã che, từng completion marker và gate còn mở.

## Documentation impact

- Cập nhật `docs/STATUS.md` bằng snapshot mới, không sửa lịch sử thành “đã luôn đúng”.
- Cập nhật O13 provider docs, `ordering-core-contracts.md`, OpenAPI, staff guide và ops runbook cho trạng thái unknown/reconcile.
- Ghi rõ “tồn suất” khác “tồn kho nguyên liệu/SKU” trong tài liệu sản phẩm.
- Chỉ đổi trạng thái plan sang `Ready for manual UAT` khi toàn bộ automated gate trên snapshot cố định đã xanh.

## Risks and blockers

- Không provider nào cho exactly-once chỉ bằng database local. Nếu Ahamove không có idempotency/lookup, manual reconciliation là giới hạn thật của v1.
- Outbox retry mù có thể lặp side effect; consumer carrier phải phân loại unknown và dừng retry.
- Mapping sai response code ví có thể nguy hiểm ngang lỗi hiện tại. Cần fixture lấy từ tài liệu chính thức và sandbox response thật.
- Working tree đang có sửa song song. Trước implementation phải xác định ownership, tránh overwrite và tạo snapshot reviewable.
- Full gate cũ không thay thế gate sau merge; mọi con số pass phải gắn với SHA/working tree cụ thể.

## Implementation outcome and deviations

- Wallet recovery được triển khai theo contract phân loại và giữ lỗi transport ở đường retry/review.
- Carrier booking dùng durable synchronous operation: commit guard trước HTTP, gọi provider ngoài
  transaction, rồi finalize trong transaction mới. Bản này chưa dùng outbox để dispatch lần đầu vì
  provider hiện không chứng minh được lookup/idempotent retry; operation không chắc chắn bị dừng để
  staff reconcile thay vì retry mù.
- Stable `idempotencyKey` đã có trong contract (cả `book` và `cancel`) và được truyền cho provider.
  Adapter Ahamove hiện chưa có bằng chứng provider thực sự dedupe theo key, nên manual reconciliation
  vẫn là safety boundary.
- (2026-10-16) Carrier cancellation dùng cùng protocol: operation `carrier-cancel` commit trước HTTP,
  provider call ngoài transaction, finalize trong transaction mới; finalize lỗi để operation `unknown`
  và chặn hủy lại. `carrierReconcile` phân nhánh theo kind (`booked`/`not-created` cho book,
  `cancelled`/`still-booked` cho cancel). Operation `unknown` mở alert critical
  `carrier-operation-unknown` và tự đóng khi finalize/reconcile thành công; Ops status trả
  `carrierOperations` và trang Tình trạng vận hành có tab **Đối tác giao xe**.
- (2026-10-16) Tab Ops **Đối tác giao xe** có nút **Đối soát** ngay trên dòng: mở hộp thoại nhập
  kết quả kiểm tra đối tác (`booked`/`not-created` cho book, `cancelled`/`still-booked` cho cancel),
  mã chuyến khi đã tạo, và lý do bắt buộc. Gửi tới route riêng `POST /ops/carrier/:operationKey/reconcile`
  dưới quyền `ops.read` (cùng quyền với phần còn lại của tab Ops); route tra operation theo key rồi gọi
  lại đúng `carrier-assignment.carrierReconcile` (giữ kiểm scope chi nhánh, kiểm trạng thái, đối chiếu
  outcome-theo-kind và ghi change-log `carrier.reconcile`). Trước đây thao tác này chỉ có ở chi tiết đơn
  qua route `order.process`, nên nhân viên chỉ có `ops.read` không đối soát được từ Ops.

## Completion record

- [x] Hai P1 vòng 7 có reproducer trên PostgreSQL thật và report.
- [x] Kế hoạch phục hồi provider và phạm vi feature sau go-live được lập.
- [x] Regression maintained đỏ trước fix, xanh sau fix (`wallet-status.mjs`, `provider-recovery.mjs`).
- [x] Wallet query contract và retry/review path hoàn tất; batch lỗi không làm starvation.
- [x] Durable carrier operation và manual reconcile cho `carrierBook` hoàn tất.
- [x] Áp cùng durable protocol cho `carrierCancel`; external call không còn nằm trong transaction.
- [x] Cảnh báo `carrier-operation-unknown` (critical, tự đóng) và tab Ops **Đối tác giao xe** hoàn tất.
- [x] Nút reconcile trực tiếp trên tab Ops **Đối tác giao xe** (`POST /ops/carrier/:operationKey/reconcile`, quyền `ops.read`) — 2026-10-16.
- [ ] Cảnh báo tự động ngoài email alert (kênh thông báo khác) — chưa làm.
- [x] Full `check:ordering` một lượt: 106/106 script PASS trên `salanca_ordering_release_gate`.
- [ ] Full `check:ordering` lượt thứ hai liên tiếp để bắt state leak.
- [ ] Matrix 24 failure paths được ghi nhận riêng trên đúng snapshot; full gate hiện bao phủ các regression maintained nhưng chưa thay thế matrix lịch sử có mapping từng path.
- [ ] Manual browser UAT và provider sandbox UAT đạt.
- [ ] Backup/restore, alert recipient, runbook và rollback drill đạt.
- [ ] Owner ký release gate; lúc đó mới được đổi từ NO-GO.
