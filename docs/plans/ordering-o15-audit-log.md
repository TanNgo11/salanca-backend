# O15 — Lịch sử thay đổi: kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt), AI thực hiện
Last updated: 2026-10-12
Related phase: [`phases/phase-ordering-15-audit-log.md`](../phases/phase-ordering-15-audit-log.md)

Mockup: [`mockups/ordering-o15-audit-log.html`](mockups/ordering-o15-audit-log.html). Đặc tả màn hình ở mục cuối.

## Đã đổi khi code O15 (2026-10-12)

- **Log catalog đã có từ O2** (`catalogChangeLog` trong `register.ts`, 8 bảng catalog) — "Current evidence" bên dưới viết sai.
  O15 không viết lại mà sửa lỗi **ghi trùng**: service `catalog-category` ghi dòng riêng *và* middleware ghi thêm một dòng.
  Service bọc lệnh Document Service bằng `withAuditSuppressed` (`domain/audit/suppress.ts`, AsyncLocalStorage) → middleware
  bỏ qua. Middleware thêm `entityLabel` (tên VI/SKU) và `locationRef` (khi bảng có, ví dụ `catalog-location-state`).
- **Mã thao tác lạ không ném lỗi**: `record` ghi `category: 'other'` + cảnh báo log; `domain/audit/actions.test.ts` quét mọi
  `record({ action: '…' })` và `audit('…')` trong source + tổ hợp middleware → thiếu mã là test đỏ.
- **Log luồng đơn móc ở một chỗ**: `timeline.record` (actor là nhân viên) → `auditActionForTimeline` ánh xạ
  `fulfillment-group.transitioned` (→ `order.transition|reject|cancel|complete`, `delivery.dispatch|fail|retry`),
  `order.line.canceled`, `payment.captured` (tiền mặt), `order.confirmed`. Chỉ lưu **mã** lý do, không lưu lý do/ghi chú gõ tay.
  Thêm `record` riêng cho `payment-link.issue`; `refund.*`, `payment-manual.record` thêm `orderId`.
- **Chuỗi băm không khóa lúc ghi**: job `audit-chain` (5 phút) điền `prevHash`/`hash` sau khi commit (dòng cũ hơn 30 giây,
  nối vào đỉnh chuỗi theo id), kiểm 2.000 dòng mới nhất + 200 dòng ngẫu nhiên và kiểm mọi `prevHash` còn tồn tại → alert
  `audit-tampered` (mã cảnh báo thứ 9, luôn critical, `ops.read`). Bỏ khóa advisory toàn cục trong transaction ghi.
- `requestId` lấy lười từ `strapi.requestContext` (một id mỗi request admin); job/script không có request → null.
- Migration `0005-o15-audit-log` (tên khác `0005-o7-…` của O7 — runner chạy theo tên); backfill chỉ `category`.
- Quyền `audit.read`; xuất CSV cần thêm `export`. Ngày lọc theo giờ Việt Nam (+07:00). Link "Lịch sử thay đổi" trong chi tiết
  đơn (S4) mở `?q=<mã đơn>`; không có link từ form món (form món là Content Manager).

## Goal

Màn xem/lọc/xuất change-log và bù đủ log cho thao tác nhạy cảm.

## Non-goals

- Log mọi lần đọc; undo từ log.

## Current evidence

- `content-types/admin-change-log`: `actorRef`, `action`, `entityType`, `entityId`, `locationRef`, `occurredAt`, `changes`
  (diff `{ field: { before, after } }` đã che PII bằng `maskPayload`). `services/change-log.ts` `record(...)`, phát
  `ordering.admin.changed` qua eventHub; append-only (không có route sửa/xóa).
- Đang ghi: `alert-rules.update`, `branch.create/update`, `cash-closing.close/adjust`, `catalog-availability.toggle`,
  `catalog-category.create/update/move/delete`, `ops.job-run`, `ops.outbox-retry`, `payment-manual.record`, `refund.create`,
  `refund.settle`, `scope.update`, `settings.update`, `payment-review.*` (một phần).
- **Chưa ghi** (chỉ có timeline đơn `order-event` hoặc không có gì): sửa `catalog-product`/`catalog-variant`/`catalog-price`/
  `catalog-modifier*` qua Content Manager; hủy đơn, hủy bớt món, từ chối, chuyển bước; `cash-handover`; phát link thanh toán;
  gán/giao/thất bại chặng giao; sửa đơn (O7 kế hoạch có).
- `register.ts` có Document Service middleware (khóa mã chi nhánh) — chỗ móc log cho catalog.
- O6: `domain/csv.ts` (xuất), `shared/export-limits.ts`, scope service, quyền `export`.
- App có `audit-event` append-only (AGENTS.md) — plugin không dùng chung bảng (plugin không import code app).

## Decisions and assumptions

- Decision: giữ `admin-change-log` là nguồn duy nhất; thêm cột `category` (`money` \| `order` \| `catalog` \| `delivery` \|
  `config` \| `access` \| `ops`), `entityLabel` (mã đơn/tên món lúc ghi, để lọc và hiển thị khi đối tượng đã đổi tên),
  `orderId?` (lọc theo đơn), `requestId?` (gom các dòng của một thao tác), `prevHash?`, `hash?`.
- Decision: danh mục thao tác cố định trong `domain/audit/actions.ts` (mã → nhóm, nhãn VI/EN, đối tượng); `record` từ chối mã
  ngoài danh mục (test bắt). Phase sau thêm mã mới vào danh mục.
- Decision: log catalog từ Document Service middleware cho `plugin::ordering.catalog-*` (create/update/delete/publish) với
  diff field; giá ghi số tiền trước/sau.
- Decision: thao tác đơn ghi cả timeline (cho khách/nhân viên xem trên đơn) **và** change-log (cho tra soát); change-log chỉ
  giữ field liên quan (trạng thái, số tiền, lý do), không lặp nội dung món.
- Decision: chuỗi băm tùy chọn (`config.audit.hashChain`, mặc định bật): `hash = sha256(prevHash + canonicalJSON(row không
  hash))`; ghi trong transaction với khóa advisory `audit-chain` để giữ thứ tự; job `audit-verify` hằng ngày kiểm 10.000 dòng
  mới nhất + mẫu ngẫu nhiên → alert `audit-tampered`.
- Decision: quyền mới `audit.read` (xem trong scope) và dùng `export` cho xuất. Log không có `locationRef` (cấu hình chung,
  quyền, ops) chỉ người `allLocations` thấy.
- Owner decision required: thời hạn giữ log (mặc định giữ hết; nếu đặt hạn thì job xóa theo lô và ghi mốc vào chuỗi băm).
- Assumption: Strapi 5.51.1 không phát sự kiện đăng nhập admin cho plugin dùng ổn định → truy vết đăng nhập là non-goal (kiểm
  khi code; có thì thêm `access.login`).

## Invariants

- Không route/service nào sửa hoặc xóa dòng log (trừ job thời hạn nếu chủ dự án bật).
- Không lưu dữ liệu cá nhân thô trong `changes`/`entityLabel` (che bằng `maskPayload`; mã đơn được phép).
- Mọi thao tác trong danh mục ghi đúng một dòng (hoặc một nhóm dòng cùng `requestId`).

## Data model

| Field mới trên `admin-change-log` | Mô tả |
| --- | --- |
| `category` | nhóm thao tác (enum) |
| `entityLabel` | nhãn lúc ghi (mã đơn, tên món VI), ≤ 120 |
| `orderId` | integer, null |
| `requestId` | uuid, null |
| `prevHash`, `hash` | hex, null khi tắt chuỗi băm |

Migration (số theo thứ tự khi làm): cột mới; backfill `category`/`entityLabel` từ `action`; index `(occurred_at desc)`,
`(actor_ref, occurred_at)`, `(category, occurred_at)`, `(location_ref, occurred_at)`, `(order_id)`, `(entity_type, entity_id)`.

## API

| Method | Path | Quyền | Mô tả |
| --- | --- | --- | --- |
| GET | `/ordering/audit-log?from=&to=&actor=&category=&action=&branch=&entity=&orderCode=&page=` | `audit.read` | danh sách mới nhất trước, 50/trang, lọc scope |
| GET | `/ordering/audit-log/:id` | `audit.read` | chi tiết + các dòng cùng `requestId` |
| GET | `/ordering/audit-log/actors` | `audit.read` | người đã có log (cho bộ lọc) |
| GET | `/ordering/audit-log/export?…` | `audit.read` + `export` | CSV, ≤ 92 ngày, ≤ 10.000 dòng |

Lỗi mới: `AUDIT_ACTION_UNKNOWN` 500 (lỗi lập trình — test bắt).

## Implementation steps

1. **Danh mục thao tác + cột mới**
   - Files: `domain/audit/actions.ts` (+ test mã duy nhất, nhãn đủ VI/EN), schema + migration, `change-log.ts` (`category`,
     `entityLabel`, `orderId`, `requestId`, kiểm mã trong danh mục), cập nhật mọi chỗ gọi `record` hiện có.
   - Verification: `pnpm run test`; `check:ordering` xanh (không đổi hành vi).
2. **Bù log catalog**
   - Files: Document Service middleware trong `register.ts` (hoặc `services/catalog-audit.ts`) cho `catalog-product`,
     `catalog-variant`, `catalog-price`, `catalog-modifier-group`, `catalog-modifier`: đọc bản trước, chạy action, ghi diff.
   - Verification: `scripts/ordering/audit-coverage.mjs` (mới): sửa giá qua Content Manager API → dòng log đúng số.
3. **Bù log đơn, tiền, giao**
   - Files: `admin-orders.ts` (transition/reject/cancel/cancelLine/cashHandover/paymentLink), `payment-review.ts` (mọi thao tác),
     `delivery-assignment.ts` (dispatch/markFailed/markDelivered/retry), `order-edit.ts` (O7 nếu đã có) — `requestId` chung cho
     các dòng của một request (từ `ctx`).
   - Verification: `audit-coverage.mjs` chạy từng thao tác trong danh mục qua HTTP → đúng một dòng/nhóm, PII đã che.
4. **Chuỗi băm + job kiểm**
   - Files: `services/change-log.ts` (khóa advisory + hash), `jobs/audit-verify.ts` (`ORDERING_JOBS`), alert `audit-tampered`.
   - Verification: script: sửa trực tiếp một dòng bằng SQL → job mở alert; 2 process ghi song song → chuỗi vẫn liên tục.
5. **API + Admin (A1–A2)**
   - Files: `services/audit-log.ts` (lọc + scope + nhãn), routes, `admin/src/pages/AuditLog/`, nhóm menu **Cấu hình**,
     `register.ts` (`audit.read`), `translations/o15.ts`, link "Lịch sử thay đổi" từ chi tiết đơn S4 (lọc theo mã đơn) và từ
     form món (lọc theo món).
   - Verification: `scripts/ordering/audit-log.mjs`: lọc từng tiêu chí, scope, xuất CSV, 403/404.
6. **Tài liệu, gate**
   - Files: staff guide (tra lịch sử), ops runbook (cảnh báo `audit-tampered`), security baseline, STATUS, Completion record;
     ghi chú cho O7+: thêm mã thao tác mới vào `domain/audit/actions.ts`.
   - Verification: gate đầy đủ, `check:ordering` 2 lượt.

## Đặc tả màn hình

Quy ước chung như [`ordering-o3-screens.md`](ordering-o3-screens.md); chuỗi trong `translations/o15.ts`.

### A1. Lịch sử thay đổi (Cấu hình → Lịch sử thay đổi)

- Route `/plugins/ordering/audit-log`. Quyền `audit.read`.
- Bộ lọc (một hàng, không dropdown trong Modal): khoảng ngày (`TextInput type="date"` × 2, mặc định 7 ngày), **Người làm**
  (`Combobox` từ `/audit-log/actors`), **Nhóm** (nút: Tất cả · Tiền · Đơn · Món · Giao hàng · Cấu hình · Quyền · Vận hành),
  **Chi nhánh**, ô tìm "Mã đơn / tên món / mã đối tượng". Nút "Xuất CSV" (cần `export`).
- Bảng: **Lúc** (giờ chi nhánh), **Người** (tên + `admin:<id>`; `Hệ thống` cho job), **Thao tác** (nhãn: "Sửa giá", "Hủy đơn",
  "Hoàn tiền mặt", "Chốt tiền mặt"…), **Đối tượng** (nhãn + link: đơn → S4, món → form O2, chi nhánh → S7), **Chi nhánh**,
  **Tóm tắt** ("Giá 65.000 → 60.000", "Lý do: khách đổi ý", "Hoàn 30.000đ"). Nhóm Tiền tô nhãn màu.
- Bấm dòng → A2. Phân trang Trước/Sau. Trống: "Không có thay đổi nào trong khoảng này."

### A2. Chi tiết thay đổi (`Modal` chỉ đọc)

- Đầu: thao tác, người, lúc, chi nhánh, đối tượng (link), mã yêu cầu.
- Bảng **Trước → Sau** theo field (field đã che hiện "[đã ẩn]"); số tiền định dạng `175.000đ`; JSON lồng hiện thu gọn.
- "Cùng thao tác" — các dòng cùng `requestId` (ví dụ hủy đơn + hoàn tiền + trả giới hạn ngày).

## Data and rollback

- Migration thêm cột/index (backfill theo lô). Rollback: ẩn màn bằng quyền; tắt chuỗi băm bằng cấu hình (dòng mới không băm).

## Verification

- Automated: lint, typecheck, test, `check:ordering` 2 lượt, `check:phase3` tắt/bật, build tắt/bật.
- Manual UAT: theo spec.

## Documentation impact

- Spec + mockup O15, staff guide, ops runbook, security baseline, STATUS, roadmap.

## Risks and blockers

- Middleware Document Service phải đọc bản trước trong cùng transaction (không chậm thao tác Content Manager đáng kể) — đo thời
  gian lưu món trước/sau.

Ước lượng thô: 1–1,5 tuần (1: 1 ngày; 2–3: 3 ngày; 4: 1 ngày; 5: 2 ngày; 6: 1 ngày).

## Completion record

Trạng thái: **implemented, targeted gates passed** (quy ước từ O7: không chạy lại toàn bộ gate, UAT giao diện do chủ dự án
làm sau). Nhánh `feat/ordering-o15` (worktree `salanca-backend-o15`, DB `salanca_ordering_o15`), merge vào `feat/ordering`.

- Gate (2026-10-12): `pnpm run lint`, `pnpm run typecheck`, unit test plugin (`vitest run src/plugins/ordering` — gồm
  `domain/audit/*.test.ts` mới, test dịch admin), `scripts/ordering/audit-coverage.mjs`, `audit-log.mjs` (mới), các script
  bị ảnh hưởng: `schema`, `review-additions`, `admin-orders`, `sepay-review`, `sepay-manual`, `payment-refund`,
  `cash-closing`, `catalog-availability`, `catalog-categories`, `delivery-assignment`, `alerts-engine`, `ops-status`;
  `strapi build` bật plugin. Kết quả ghi ở `docs/STATUS.md`.
- Chưa làm: UAT giao diện (chủ dự án); thời hạn giữ log (mặc định giữ hết — chờ chủ dự án).
