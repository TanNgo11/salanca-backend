# O6 — Vận hành và go-live: kế hoạch thực hiện

Status: In progress
Owner: tan_ngo (duyệt), Claude (thực hiện)
Last updated: 2026-10-10
Related phase: [`phases/phase-ordering-6-ops-golive.md`](../phases/phase-ordering-6-ops-golive.md)

Đặc tả màn hình: [`ordering-o6-screens.md`](ordering-o6-screens.md) (reference mục U6). Mọi màn UI làm theo file đó.

## Goal

Đủ công cụ vận hành bán online thật và qua được cổng go-live.

## Non-goals

- VAT/hóa đơn điện tử, voucher, lịch hẹn, tồn kho, khuyến mãi.

## Current evidence

- O1–O5 xong; `ops-alert`, outbox, job lock đã có từ O1; `cash-closing` chưa có — O6 thêm content type +
  migration 0004 ở bước 3.
- App đã có: xuất CSV lead theo khoảng ngày Việt Nam với giới hạn 10.000 dòng (`src/shared/csv`, lead
  export); runbook Cloudflare qua `cf` CLI (bộ nhớ dự án).
- Tham khảo cảnh báo: Saleor `AppProblem`, WooCommerce tự tắt webhook, Action Scheduler (reference C17.3).

## Decisions and assumptions

- Decision: ngưỡng cảnh báo mặc định theo bảng contracts mục 12; chỉnh trong Admin.
- Decision: cửa sổ gộp (`aggregationMinutes`) áp cả cho bản ghi đã `resolved` — mở lại trong cửa sổ tái dùng
  cùng bản ghi và **không gửi** thông báo mới; qua cửa sổ mới tạo bản ghi mới.
- Decision: `acknowledged` chỉ chặn nhắc lại cùng mức; không chặn leo thang — còn mở/đã biết mà `count` đạt
  `criticalThreshold` vẫn lên `critical` và gửi `ops-alert.escalated`.
- Decision: người nhận rule = `branch-email` hoặc action plugin (`ops.read`, `report.read`, `payment.review`,
  `order.read`); email trùng giữa nhiều action chỉ gửi một lần.
- Decision: giới hạn 500 bản ghi `ops-alert`, dọn bản `resolved` cũ nhất trước.
- Decision: nhịp job qua `order-job-lock` (`lastRunAt`, `lastDurationMs`); job không dùng lock (outbox
  dispatcher) gọi `heartbeat`; `ops-check` so nhịp theo `heartbeatMinutes`.
- Decision: danh sách job định kỳ gom trong `jobs/catalog.ts` (`ORDERING_JOBS`: name, cronKey, run, runnable)
  — bootstrap lặp mảng để đăng ký `ordering.<name>`, `ops-status` đọc cho bảng job và "Chạy ngay"; bước 6 chỉ
  thêm một dòng cho job retention.
- Decision: "Chạy ngay" (`POST /ops/jobs/:name/run`) chạy với owner `admin:<id>`, ghi change-log `ops.job-run`;
  job đang giữ lock trả `{ ran: false }` với HTTP 200 (không phải lỗi). Mọi job trong catalog đều idempotent
  nên `runnable` mặc định true.
- Decision: `POST /ops/outbox/:id/retry` reset `failed_at`/`attempts`/lease và giữ `last_error` làm ngữ cảnh;
  ghi change-log `ops.outbox-retry`.
- Decision: thời hạn lưu mặc định (raw payload 180 ngày, outbox 30/90 ngày, alert 90 ngày) là cấu hình,
  chờ pháp lý xác nhận.
- Decision: chốt tiền mặt gộp một bản `current` cho bộ (chi nhánh, ngày kinh doanh, người thu) —
  unique index dạng partial `plugins_ordering_cash_closing_current_uq`; chốt hai lần cùng bộ bị từ chối
  409 `CASH_CLOSING_EXISTS`. Sửa chỉ qua bản điều chỉnh có `adjustmentReason` bắt buộc: bản cũ chuyển
  `superseded` (giữ lịch sử), bản mới `revision + 1`, `supersedesId` trỏ bản trước.
- Decision: số hệ thống chốt luôn tính lại phía server lúc chốt/điều chỉnh (không tin số client gửi):
  tiền mặt = `payment` `provider_code 'cash'` + `status 'captured'` theo `business_date` và
  `actor_ref` (người thu — đơn giao gán cho người giao qua `assigneeCtxFor`); hoàn = `refund`
  `status 'settled'` trên payment cash theo `refund.business_date` (cột mới, ghi khi settle theo
  timezone + cutoff chi nhánh; backfill migration 0004 giả định `Asia/Ho_Chi_Minh` + 04:00 vì dữ liệu
  cũ chỉ ở DB test).
- Decision: chênh lệch ≠ 0 mở/bump alert `cash-closing-mismatch:<branch>:<date>:<collectorRef>`
  (severity warning, aggregateRef `cash-closing:<id>`); điều chỉnh về 0 thì `alert.resolve` cùng key.
  `actor_ref` null của payment nhóm thành người thu `'system'`.
- Owner decision required: kết quả của kế toán (hóa đơn điện tử, VAT) và pháp lý (thời hạn lưu, nội dung
  đồng ý) trước go-live.

## Invariants

- Báo cáo đọc từ snapshot và ledger, không đọc lại catalog.
- Job xóa dữ liệu chỉ xóa field cá nhân, giữ id, số tiền, thời gian; chạy lại an toàn.
- CSV có dữ liệu cá nhân chỉ cho quyền `export`, có giới hạn.

## Implementation steps

1. **Bộ máy cảnh báo đầy đủ**
   - Files: `services/alert.ts` (cửa sổ gộp, ngưỡng critical, "đã biết", giới hạn số bản ghi),
     `content-types/alert-rule-settings` hoặc setting trong `strapi.store`, `admin/src/pages/Alerts/`.
   - Làm: đủ 8 rule; người nhận theo vai trò (mục 19.2); gửi qua `NotificationProvider`.
   - Verification: tích hợp mỗi rule: một bản ghi theo key, lên critical đúng ngưỡng, không gửi trùng.
2. **Trang "Tình trạng vận hành"**
   - Files: `services/ops-status.ts`, `routes/admin.ts`, `admin/src/pages/OpsStatus/`.
   - Làm: outbox đang chờ và tuổi lâu nhất, webhook thành công gần nhất theo provider, lần chạy gần nhất của
     từng job, alert đang mở; quyền `ops.read`.
   - Verification: UAT khi tắt dispatcher thấy tuổi outbox tăng.
3. **Chốt tiền mặt**
   - Files: `services/cash-closing.ts`, `admin/src/pages/CashClosing/`.
   - Làm: số tiền hệ thống theo nhân viên/người giao và `businessDate`; nhập số đếm; lưu `cash-closing`; chênh
     lệch thì alert `cash-closing-mismatch`.
   - Verification: tích hợp với đơn tiền mặt mẫu; chốt hai lần cùng ngày bị từ chối hoặc ghi bản sửa có lý
     do (chọn khi làm, ghi vào Completion record).
4. **Báo cáo**
   - Files: `services/reports.ts` (SQL tổng hợp theo `businessDate`, chi nhánh, danh mục, cách thanh toán,
     cách nhận), `admin/src/pages/Reports/`.
   - Verification: tổng báo cáo ngày khớp tổng ledger trên dữ liệu mẫu có đơn qua nửa đêm.
5. **Xuất CSV đơn**
   - Files: `services/order-export.ts`, `routes/admin.ts`; viết CSV trong plugin (không import
     `src/shared/csv` của app).
   - Verification: thiếu quyền → 403; khoảng ngày và số dòng bị giới hạn; Excel mở đúng tiếng Việt.
6. **Thời hạn lưu**
   - Files: `jobs/retention.ts`.
   - Verification: tích hợp: raw payload quá hạn bị xóa field cá nhân, giữ phần đối soát; chạy lại không lỗi.
7. **Hạ tầng và go-live**
   - Làm: Cloudflare rule cho route webhook (không cache, không challenge) bằng `cf` CLI; backup DB trước
     go-live; kiểm SSE qua proxy; bật `ORDERING_ENABLED` trên production.
   - Verification: gửi webhook thử qua domain thật; `/_health` 204; Admin hiện plugin.
8. **Runbook**
   - Files: `docs/ordering-staff-guide.md` (hoàn thiện), `docs/ordering-payments-runbook.md` (đối soát, khôi
     phục), `docs/ordering-ops-runbook.md` (cảnh báo, job).
   - Verification: một người không tham gia code làm theo được một lần đối soát.
9. **Cổng go-live**
   - Làm: checklist trong spec O6; ghi kết quả vào `docs/STATUS.md`.

10. **Bổ sung sau review (2026-10-10)**
    - Files: `docs/ordering-ops-runbook.md` (export/transfer có dữ liệu cá nhân), `docs/STATUS.md` (bảng gate
      O1–O6), setting `policyVersion`.
    - Verification: checklist go-live có đủ mục 21.4 và 21.9.

## Data and rollback

- Migration/backfill: `0004-o6-ops` tạo index cho `cash-closing` (bảng mới ở O6, không phải O1 như bản
  nháp trước ghi), `payment(provider_code, business_date)`, `ops-alert(status, last_seen_at)` và
  backfill `refund.business_date` cho refund đã settled; setting cảnh báo mới.
- Rollback: tắt từng job; tắt `ORDERING_ENABLED` trên production nếu cần dừng bán.

## Verification

- Automated: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`,
  `pnpm run check:phase3`.
- Manual UAT: theo spec O6.
- Evidence to record: Completion record, `docs/STATUS.md` (cổng go-live).

## Documentation impact

- Ba runbook, `docs/STATUS.md`, `docs/security-baseline.md` (route webhook, dữ liệu cá nhân).

## Risks and blockers

- Chờ kế toán và pháp lý.
- Thay đổi Cloudflare production cần chủ dự án đăng nhập `cf` CLI.

## Completion record

- Bước 1 (bộ máy cảnh báo) xong — commit `97b72ae`.
- Bước 2 (trang vận hành + Admin V1/V2 + khối Cảnh báo trong Settings) xong — commit `d84ed09`.
- Bước 3 (chốt tiền mặt) xong: content type `cash-closing`, `refund.business_date`, migration
  `0004-o6-ops`, `services/cash-closing.ts`, routes `report.read`, trang Admin `CashClosing`,
  test `scripts/ordering/cash-closing.mjs`. Chọn: chốt hai lần cùng (chi nhánh, ngày, người thu) bị
  từ chối 409; sửa qua bản điều chỉnh có lý do, bản cũ giữ `superseded`.
