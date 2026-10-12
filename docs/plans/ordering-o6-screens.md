# O6 — Đặc tả màn hình (vận hành, chốt tiền, báo cáo)

Ngày: 2026-10-10. Bổ sung cho spec [`phases/phase-ordering-6-ops-golive.md`](../phases/phase-ordering-6-ops-golive.md),
kế hoạch [`ordering-o6-ops-golive.md`](ordering-o6-ops-golive.md), mockup [`mockups/ordering-o6-ops-golive.html`](mockups/ordering-o6-ops-golive.html).
Nghiên cứu: [`ordering-reference.md` mục U6](ordering-reference.md). **Quy ước chung** như mục đầu của
[`ordering-o3-screens.md`](ordering-o3-screens.md).

## V1. Tình trạng vận hành

- Route: `/plugins/ordering/ops`. Quyền `ops.read` (cả link điều hướng lẫn `Page.Protect`; route server đi qua
  `admin::isAuthenticatedAdmin` + `hasPermissions ops.read`).
- API (đã có ở bước 2): `GET /ordering/ops/status` → `{ now, outbox, webhooks, reconciliation, alerts, jobs,
  failedOutbox }`; `POST /ordering/ops/jobs/:name/run` (tên lạ → 404 `JOB_NOT_FOUND`, job đang giữ lock → 200
  `{ result: { ran: false } }`); `POST /ordering/ops/outbox/:id/retry` (không tồn tại → 404, không ở trạng thái
  lỗi → 409 `INVALID_TRANSITION`). Danh sách job lấy từ `jobs/catalog.ts` — cùng mảng `ORDERING_JOBS` mà
  bootstrap đăng ký cron.
- `nextRunAt`: đọc `nextInvocation()` của job trong `strapi.cron.jobs` (node-schedule). Khi cron tắt
  (`jobs.enabled`/`server.cron.enabled`) cột "Lần tới" hiện `—`.
- Hàng thẻ: Outbox đang chờ (số + tuổi cũ nhất, đỏ khi `stuck` — tuổi > ngưỡng rule `outbox-stuck` hoặc có row
  lỗi); Webhook theo từng provider có capability ký webhook (badge Bình thường / Chậm / Lỗi); Đối soát gần nhất
  và lần tới (tắt khi provider sepay không đăng ký); Cảnh báo đang mở (số, nghiêm trọng, link sang Cảnh báo).
- Bảng job: tên (`ops.job.<name>` dịch, fallback tên), lần chạy gần nhất, kết quả (Thành công / Lỗi + lỗi rút
  gọn / Chưa chạy / Đang chạy), thời lượng, lần tới; **Chạy ngay** qua `Dialog` xác nhận, ghi change-log
  `ops.job-run`.
- Bảng outbox lỗi (tab "Lỗi"): loại event, mã đơn (tra từ `aggregateType='order'` hoặc `payload.orderId`), số
  lần thử, lỗi gần nhất (message đã che PII); **Thử lại** đưa row về pending (reset attempts, change-log
  `ops.outbox-retry`).
- Tự làm mới mỗi 30 giây; có nút làm mới.

## V2. Cảnh báo

- Route: `/plugins/ordering/alerts`. Quyền: xem theo vai trò người nhận (mục 19.2) — server lọc theo `recipients`
  của rule (`ops.read`/`report.read`/`payment.review`/`order.read` hoặc `branch-email`+`order.read`) và theo scope
  chi nhánh (`staff-location-scope`); `ops.read` thấy hết. Route đi qua policy `has-alert-access`.
- API (đã có ở bước 1): `GET /ordering/alerts?status=open|acknowledged|resolved&page=&pageSize=` →
  `{ rows, total, page, pageSize }` (mỗi row kèm `recipients` từ rule), `POST /ordering/alerts/:id/acknowledge`
  (ngoài scope trả 404), `GET`/`PUT /ordering/settings/alert-rules` (quyền `settings.manage`).
- Bảng (theo Saleor AppProblem): mức (`Badge` Nghiêm trọng / Cảnh báo), nội dung, số lần, lần đầu / gần nhất, gửi tới,
  trạng thái; thao tác **Đã biết** (ghi người và thời điểm).
- Ngưỡng: Settings → Bán hàng (S9 của O3) thêm khối "Cảnh báo": bảng rule (bật, ngưỡng, ngưỡng nghiêm trọng, cửa sổ
  gộp, người nhận theo vai trò), đọc/ghi qua `/ordering/settings/alert-rules`.

## V3. Chốt tiền mặt cuối ngày

- Route: `/plugins/ordering/cash-closing`. Quyền `report.read`.
- API (đã có ở bước 3): `GET /ordering/reports/branches` → `{ branches: [{ code, name, timezone, businessDateToday }] }`
  (chi nhánh trong scope, ngày kinh doanh hôm nay của từng chi nhánh); `GET /ordering/cash-closing?branch=&businessDate=`
  (alias `/cash-closing/summary`) → `{ branch, businessDate, isToday, rows, totals }`; `POST /ordering/cash-closing`
  `{ branch, businessDate, collectorRef, countedAmount, note? }` — chênh ≠ 0 mà thiếu `note` → 400 `field: 'note'`,
  trùng chốt → 409 `CASH_CLOSING_EXISTS`; `POST /ordering/cash-closing/:id/adjust` `{ countedAmount, note?, reason }`
  — thiếu `reason` → 400, tạo bản `revision + 1` và bản cũ `superseded`.

Bố cục (theo Odoo "Closing Register"):

| Cột | Nội dung |
| --- | --- |
| Người thu | nhân viên quầy / người giao |
| Số đơn | |
| Hệ thống tính | tổng tiền mặt đã ghi |
| Hoàn tiền mặt | âm |
| Phải có | = hệ thống − hoàn |
| Đếm được * | `NumberInput` |
| Chênh lệch | tự tính; đỏ khi khác 0 |

- Ô ghi chú bắt buộc khi có chênh lệch. Nút **Chốt** (xác nhận "Sau khi chốt không sửa được; sai thì tạo bản điều
  chỉnh có lý do"). Đã chốt: bảng chỉ đọc + người chốt + thời điểm; nút "Điều chỉnh" tạo bản ghi điều chỉnh.
- Chọn chi nhánh và ngày kinh doanh ở đầu trang; ngày đã chốt có `Badge`.

## V4. Báo cáo

- Route: `/plugins/ordering/reports`. Quyền `report.read`. API thật:
  `GET /ordering/reports/sales?branch=&from=&to=&groupBy=` (không có tiền tố `/admin`).
- `from`/`to` là ngày kinh doanh `YYYY-MM-DD`, bắt buộc cả hai, `from ≤ to`, tối đa 366 ngày (quá → 400
  `VALIDATION_ERROR`, `details.field: 'to'`). `groupBy` ∈ `day | category | product | payment | receive`
  (mặc định `day`; khác → 400). `branch` tùy chọn — bỏ trống lọc theo scope của nhân viên (không scope → 403
  `SCOPE_REQUIRED`; ngoài scope → 404).
- Trả `{ range, branch, groupBy, summary, rows, generatedAt }`. `summary`: `revenue` = Σ `payment.captured_amount`
  đã captured trong khoảng (ledger — mọi provider, không lọc theo trạng thái đơn); `refunded` = Σ `refund.amount`
  đã settled theo `refund.business_date`; `orders`/`gross` = số đơn và tổng tiền của đơn "đã bán"
  (`open`/`completed`); `averageOrder` = gross/orders (0 khi không có đơn); `net` = revenue − refunded.
- `rows` theo `groupBy`: `day` — mỗi ngày kinh doanh có dữ liệu `{key: ngày, orders, gross, revenue, refunded}`
  (Σ revenue các dòng = summary.revenue); `payment` — theo `provider_code` `{orders, revenue, refunded}`;
  `receive` — theo `receiveMethod.kind` `{orders, gross}`; `category` — danh mục đầu của `categoriesSnapshot`
  `{quantity, orders, gross}` (không có danh mục → `uncategorized`); `product` — theo `sellableUid` (+ `variantUid`)
  `{quantity, orders, gross}`, label là `titleSnapshot` của lần xuất hiện gần nhất.
- Lọc: chi nhánh ("Tất cả trong phạm vi" + danh sách `/ordering/reports/branches`), khoảng ngày kinh doanh
  (mặc định 7 ngày gần nhất tới `businessDateToday`), nhóm theo. Nút "Xuất CSV" chừa chỗ (bước 5).
- Thẻ tổng: doanh thu, số đơn, giá trị đơn trung bình, đã hoàn (+ dòng nhỏ "Thực thu: net"). Bảng theo nhóm đã
  chọn. Ghi chú nhỏ: "Theo ngày kinh doanh và tên tại lúc đặt" — tên món/danh mục đọc từ snapshot trên
  `order-line`, không đọc catalog hiện tại.

## V5. Xuất CSV đơn

`Modal` (theo lead export đã có của app): từ ngày, đến ngày (ngày kinh doanh), chi nhánh; cảnh báo "File có tên và số
điện thoại khách. Tối đa 10.000 dòng."; nút Tải. Quyền `export`. API `GET /ordering/admin/orders/export?from=&to=&branch=`.
