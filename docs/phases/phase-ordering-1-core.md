# Phase O1 — Lõi đơn hàng

Trạng thái: automated verification passed (2026-10-10), chờ UAT Admin. Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Mockup: [`plans/mockups/ordering-o1-core.html`](../plans/mockups/ordering-o1-core.html).
Kế hoạch thực hiện: [`plans/ordering-o1-core.md`](../plans/ordering-o1-core.md).
Thiết kế: [`plans/ordering-core-contracts.md`](../plans/ordering-core-contracts.md) (mục 1–8, 12, 15, 19).

## Goal

Có lõi đơn hàng chạy được bằng service và test, chưa có giao diện hay API công khai: tạo đơn từ
`Sellable` giả, tính tiền đúng tới từng đồng, chuyển trạng thái theo workflow, ghi timeline, phát event
qua outbox an toàn khi chạy nhiều server, và lọc theo chi nhánh ở tầng service. Các phase sau (catalog,
API, Admin, SePay) chỉ cắm vào lõi này.

## Điều kiện bắt đầu

- O0 đóng: báo cáo spike chốt cách build plugin, cách chạy migration, khóa dòng và claim job.

## Scope

- **Content type nội bộ** (`plugins_ordering_*`, không i18n, không Draft & Publish, ẩn khỏi Content
  Manager và Content-Type Builder): `order`, `order-line`, `order-adjustment`, `adjustment-allocation`,
  `fulfillment-group`, `fulfillment`, `fulfillment-line`, `payment`, `payment-event`, `refund`,
  `refund-line`, `order-event`, `hold`, `idempotency-key`, `outbox`, `order-job-lock`,
  `staff-location-scope`, `ops-alert` (contracts mục 5, bảng "Mô hình dữ liệu lõi").
- **Tiền:** `Money` số nguyên an toàn, kiểm `Number.isSafeInteger` ở mọi biên, đổi `biginteger` của DB
  có kiểm tra (mục 3).
- **Registry:** catalog adapter, product type (`ProductTypeDefinition`), payment/fulfillment/
  scheduling/voucher/captcha/notification provider; `bootstrap()` dừng khởi động khi code đang bật không
  có trong registry (mục 14).
- **Pipeline giá** 9 bước (mục 6): validate line, giá niêm yết, quote theo product type, phí giao, giảm
  giá/phí, phân bổ xuống line bằng phần dư lớn nhất, thuế theo line (tắt mặc định), totals và kiểm
  `Σ lineTotal + fulfillment = grandTotal`. Chưa có module khuyến mãi; chỉ có adjustment thủ công để
  test.
- **Workflow engine** (mục 7): `WorkflowDefinition` có version, kiểm graph lúc bootstrap, một hàm
  `transition()` duy nhất cho group, `order.status` là projection (`draft`/`open`/`completed`/
  `canceled`), cột cache `paymentStatus`/`fulfillmentStatus`.
- **Payment ledger** (mục 8): payment, payment-event có `providerTransactionId` unique và
  `reviewStatus`, refund, refund-line; payment status tính từ ledger. Chưa có provider thật; có provider
  `test` cho test.
- **Timeline:** `order-event` có `isPublic`, payload đã che PII.
- **Outbox và job** (mục 12): ghi outbox cùng transaction; dispatcher claim theo lô bằng
  `FOR UPDATE SKIP LOCKED` + lease 5 phút, retry có backoff; `order-job-lock` cho job đơn lẻ; bảng event.
- **Idempotency:** `Idempotency-Key` cho tạo đơn, payment action, refund; cùng key khác payload trả
  `IDEMPOTENCY_PAYLOAD_MISMATCH`.
- **Hold:** giữ chỗ có `expiresAt`, job nhả hold hết hạn.
- **Mã đơn và token:** mã đơn duy nhất từ sequence PostgreSQL; `publicToken` ngẫu nhiên, chỉ lưu hash.
- **Scope chi nhánh ở service** (mục 14, 19.2): đọc lọc `locationRef IN (...)`, ghi kiểm chi nhánh của
  chính đơn, ngoài scope trả `ORDER_NOT_FOUND`, không có scope thì từ chối; cờ `allLocations` rõ ràng.
- **Ngày kinh doanh:** `order.businessDate` tính một lần lúc đặt theo timezone và giờ chốt (mục 9).
- **Lỗi chuẩn:** `ApiError` có `code`, `requestId`.
- **Migration:** theo cách đã chốt ở O0; forward-only, thêm cột nullable trước.

## Non-goals

- Catalog (O2), API công khai và Admin (O3), SePay (O4), giao hàng (O5), báo cáo và trang vận hành (O6).
- Khuyến mãi, VAT bật, voucher, đặt lịch hẹn, tồn kho đếm số lượng.

## Acceptance

### Automated

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check:phase3   # app Salanca không đổi
```

Test bắt buộc (Vitest, cùng các script tích hợp trên DB riêng):

- Tiền: vượt safe integer bị từ chối; `biginteger` từ DB đổi đúng.
- Phân bổ giảm giá: nhiều line, giảm %, phí, VAT gồm/không gồm, luôn khớp tổng; hoàn một món dùng số
  đã phân bổ (contracts mục 17, mục kiểm 9).
- Workflow: graph sai bị chặn lúc bootstrap; transition không hợp lệ bị từ chối; `order.status` đúng với
  mọi tổ hợp group/payment trong bảng projection.
- Mixed product type: `allowMixedProductTypes = false` từ chối, `true` tạo nhiều group (mục kiểm 7).
- Ledger: event trùng `providerTransactionId` không ghi tiền lần hai; payment status đúng sau capture,
  refund một phần, refund hết.
- Idempotency: cùng key trả cùng kết quả; khác payload trả lỗi.
- Outbox: 2 process cùng DB, mỗi event giao đúng một lần; process chết thì event được nhận lại sau lease.
- Scope: hai chi nhánh, hai nhân viên; đọc, chuyển bước, refund đều bị chặn ngoài scope.
- `businessDate`: 01:30 thứ Bảy với giờ chốt 04:00 thuộc thứ Sáu.

### Manual UAT

- Không có giao diện. Kiểm bằng Admin rằng các bảng nội bộ không hiện ở Content Manager và
  Content-Type Builder.

## Bổ sung sau review (2026-10-10)

Theo contracts mục 21:

- Content type `branch` (21.1) thuộc O1 vì order và scope trỏ tới nó; màn hình sửa chi nhánh ở O3.
- `order` thêm `consentSnapshot` (21.4), `customerNote`, relation `branch` + `locationRef` snapshot.
- Mã đơn theo `orderCodeTemplate` (21.9).
- Service hủy một phần line kèm refund theo số đã phân bổ (21.5).
- Bảng `admin-change-log` + `strapi.eventHub.emit('ordering.admin.changed')` (21.6).
- Tùy chọn `cashRounding` theo chi nhánh trong pipeline (adjustment `rounding`), mặc định tắt.
- Bộ khung test tích hợp dùng chung (boot Strapi, kiểm tên DB, xóa dữ liệu plugin, fixture chi nhánh và
  nhân viên).

## Rollback

Tắt `ORDERING_ENABLED`. Từ commit `bce6979`, bảng `plugins_ordering_*` được ghi vào core store
`persisted_tables` nên tắt plugin không làm Strapi drop bảng (trước đó schema sync sẽ xóa bảng đã được theo
dõi mà không còn trong schema). Muốn bỏ hẳn thì drop bảng và sequence `plugins_ordering_order_code_seq` bằng
tay sau khi đã sao lưu.

## Rủi ro

- Workflow engine viết tay có thể thiếu trường hợp; giữ engine nhỏ, test bằng bảng tổ hợp.
- Hiệu năng projection khi đơn có nhiều group: tính lại trong cùng transaction, đo ở test tích hợp.
