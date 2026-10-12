# Prompt: thực hiện Phase O6 (vận hành và go-live)

Dán nguyên phần dưới vào session mới.

---

Làm việc trong **worktree** `D:\outsource\salanca\salanca-backend-o6` (không phải `salanca-backend`). Nhiệm vụ: code **Phase O6 — Vận hành và go-live** của
plugin `ordering`. Spec, kế hoạch, mockup và đặc tả màn hình đã có; chỉ code theo đúng các tài liệu đó.

## Bước 0: worktree, nhánh, DB riêng

Worktree đã tạo sẵn, nhánh `feat/ordering-o6` từ `feat/ordering-o5` (`f9c98db`), `.env` đã copy. Thư mục
`D:\outsource\salanca\salanca-backend` là của session khác đang chạy gate O5 — **không sửa file, không chạy lệnh
hay git trong đó** (chỉ đọc file prompt này).

```bash
cd /d/outsource/salanca/salanca-backend-o6
git branch --show-current && git status --short    # feat/ordering-o6, sạch
pnpm install --frozen-lockfile
export ORDERING_TEST_DATABASE=salanca_ordering_o6   # harness tự tạo DB này lần đầu
```

**Mọi lệnh test dùng DB `salanca_ordering_o6`**, không dùng `salanca_ordering_test` (session O5 đang dùng và
`run-all.mjs` truncate bảng): script `scripts/ordering/*` và `scripts/smoke-ordering-*.mjs` đọc
`ORDERING_TEST_DATABASE`; `check:phase3`, `smoke:reservation-form` đọc `DATABASE_NAME=salanca_ordering_o6`.
UAT dùng `ORDERING_TEST_DATABASE=salanca_ordering_o6_uat` và `UAT_PORT=1351`. Trong khoảng 30 phút đầu đọc tài
liệu và code trước; chưa chạy `check:ordering`/`check:phase3`/`strapi build` (máy đang chạy gate O5, chạy chồng
dễ làm test timeout oan).

Làm toàn bộ O6 trên `feat/ordering-o6`. Không merge `main`, không push khi chủ dự án chưa nói. O5 đã code xong, đã
sửa sau review, gate tự động đạt, UAT tay đã ghi; spec O5 vẫn "chờ duyệt" (quyết định của chủ dự án). Spec O6 ghi
"O5 đóng" là điều kiện bắt đầu: chủ dự án cho làm song song. Một session khác có thể commit `fix(ordering): ...`
lên `feat/ordering-o5` (hoặc `feat/ordering-o4`); trước khi báo xong, `git merge feat/ordering-o5` vào nhánh O6
nếu O5 có commit mới (dừng và báo nếu conflict).

## Những điều phải biết trước (đã kiểm trên code)

1. **Bảng `cash-closing` CHƯA có.** Kế hoạch O6 ghi "đã có từ O1" — sai. Contracts mục 5 (dòng bảng
   `cash-closing`) và 19.3 mô tả field; plugin chưa có content type hay migration. O6 phải thêm content type
   `cash-closing` + migration `0004-o6-ops.ts` (hoặc tên theo quy ước `migrations/index.ts`), cập nhật
   `persisted-tables.ts`. Ghi lệch này vào Completion record.
2. Đã có: content type `ops-alert`, `order-job-lock`, `outbox`, `notification-delivery`, `admin-change-log`;
   `services/alert.ts` (mở/đóng alert theo key, đếm lỗi webhook trong `strapi.store`, `webhook-failing`,
   `payment-unmatched`, `reconciliation-mismatch`); job `sla-check` (`order-awaiting-acceptance`),
   `manual-confirmation` (`manual-payment-unconfirmed`), `outbox-dispatcher`, `reconciliation`,
   `payment-expiry`, `hold-expiry`, `idempotency-cleanup`. Quyền `export` và `ops.read` đã khai trong
   `register.ts` nhưng chưa có route/màn nào dùng. Còn thiếu: `outbox-stuck`, `job-heartbeat-missed`,
   `cash-closing-mismatch`, cửa sổ gộp/ngưỡng critical/"đã biết" chung, setting ngưỡng trong Admin.
3. `businessDate`: `domain/business-date.ts` (+ test) và field trên `order`. Báo cáo/chốt tiền dùng nó, không
   tự tính lại theo giờ máy.
4. Thu tiền mặt: `admin-orders.cashHandover` ghi payment `cash` với `actorRef` là **người giao** cho đơn giao
   (O5), là nhân viên bấm cho đơn tự lấy. Hoàn tiền mặt (`refund` `settled`) trừ vào số tiền nhân viên giữ.
   Hoàn chuyển khoản là phiếu `pending` tới khi ghi mã ngân hàng — không phải tiền mặt.
5. **Không có dữ liệu thật** cho: kế toán (hóa đơn điện tử, VAT), pháp lý (thời hạn lưu, nội dung đồng ý),
   tài khoản SePay thật, danh mục xã/phường chính thức, bảng phí giao. Thời hạn lưu dùng mặc định trong cấu
   hình (180/30/90/90 ngày) và ghi "chờ pháp lý". Không bịa các quyết định này.

## Đọc trước khi code (theo thứ tự)

1. `AGENTS.md`, `PLANS.md`, `docs/STATUS.md` (mục O3–O5 mới nhất).
2. `docs/phases/phase-ordering-6-ops-golive.md` (spec, gồm "Bổ sung sau review" và "Cổng go-live").
3. `docs/plans/ordering-o6-ops-golive.md` (kế hoạch 10 bước).
4. **`docs/plans/ordering-o6-screens.md`**: V1–V5 (route, quyền, API, field, trạng thái). Đổi tên API thì sửa file
   này trong cùng commit. Quy ước chung ở đầu `ordering-o3-screens.md` (route Admin `/ordering/...`).
5. `docs/plans/mockups/ordering-o6-ops-golive.html`; `docs/plans/ordering-reference.md` mục U6, C17.3.
6. `docs/plans/ordering-core-contracts.md` mục 12 (outbox, cron, bảng alert + ngưỡng), 15 (PII, migration),
   19.2 (vai trò nhận cảnh báo), 19.3 (tiền mặt, chốt ca), 19.9, 21.4 (bằng chứng đồng ý, `policyVersion`), 21.9.
7. Completion record của `ordering-o3-pickup-cash.md`, `ordering-o4-sepay.md`, `ordering-o5-delivery.md`;
   `docs/ordering-payments-runbook.md`, `docs/ordering-staff-guide.md`, `docs/ordering-api-contract.md`.
8. Xuất CSV lead có sẵn của app (`src/shared/csv`, lead export) — **chỉ đọc để học**; plugin không import code app,
   viết CSV riêng trong plugin (BOM UTF-8 cho Excel, chặn công thức `= + - @` đầu ô).

## Đã có từ O0–O5 (dùng lại, không làm lại)

- Outbox + dispatcher nhiều process (lease, backoff, `failed_at`), job lock một process (`services/job-lock.ts`,
  mẫu dùng trong `jobs/sla-check.ts`; cron đăng ký ở `bootstrap.ts`). Lần chạy gần nhất của job: xem `order-job-lock`; nếu thiếu dữ liệu
  cho heartbeat thì thêm field có lý do.
- Thông báo: `services/notification.ts` + `NotificationProvider`; email nhân viên theo vai trò.
- Scope chi nhánh: `services/scope.ts` (404 ngoài scope; `allLocations`). Báo cáo/chốt tiền phải lọc theo scope.
- Change log: `services/change-log.ts` — đổi ngưỡng cảnh báo, chốt tiền ghi vào đây.
- Admin: menu con "Bán hàng" (`admin/src/pages/App.tsx`, nhóm Vận hành / Món / Cấu hình); màn mới ẩn theo quyền.
  Chuỗi giao diện `translations/o6.ts` dạng `[vi, en]`, merge trong `registerTrads` như `o3.ts`–`o5.ts`.
- Harness test: `scripts/ordering/_harness.mjs` (`withApp`, `seedBranches`, `seedMenu`, `seedAdminHttpStaff`),
  `pnpm run check:ordering` chạy mọi script trong `run-all.mjs` — thêm script mới vào đó.
- UAT: `scripts/ordering/uat-server.mjs` (mặc định cổng 1350, DB `salanca_ordering_uat`; trong O6 chạy với
  `UAT_PORT=1351 ORDERING_TEST_DATABASE=salanca_ordering_o6_uat`) — mở rộng seed cho ops/báo cáo/chốt tiền.

## Những điều đã chứng minh (không đọc lại source để cãi)

- Strapi 5.51.1 không tạo unique index cho `unique: true` → constraint bằng migration plugin.
- `strapi.db.transaction` lồng nhau dùng lại transaction ngoài; `onCommit` chạy sau commit ngoài cùng.
- Tranh chấp: khóa dòng (`repo.lockGroup`, `FOR UPDATE`) hoặc `pg_advisory_xact_lock`; khóa theo cùng một thứ tự.
- `db.raw` trả cột JSON dạng **chuỗi**, ORM trả object — parse khi đọc qua raw SQL.
- Cảnh báo `pg` "client.query() when the client is already executing a query" đến từ populate của
  `@strapi/database` (`Promise.all`); `pg` khóa 8.20.0. Không cần sửa trong O6; đừng thêm populate nhiều relation
  trong transaction nóng nếu tránh được.
- Code admin không import `server/**` hay `@strapi/utils`; logic dùng chung ở `src/plugins/ordering/shared/`.
- Trong `Modal` không dùng `SimpleMenu`/dropdown mới (đã treo trang ở O3); dùng nút/panel.
- `useRBAC` nhận mảng hằng (`lib/permissions.ts`). Lỗi HTTP đọc bằng `httpStatusOf` (`lib/api.ts`). Mã lỗi mới
  thêm vào `domain/errors.ts` (kèm HTTP status) và `error.<CODE>` trong translations.
- Test HTTP gửi tiếng Việt bằng node `fetch`, không bằng curl trong Git Bash.
- Test phụ thuộc giờ: `now` cố định; kiểm đơn qua nửa đêm (`businessDate` ≠ ngày lịch UTC).
- Test nhiều process phải có barrier (xem `outbox-two-process.mjs`), không dựa vào thời gian boot.
- Hủy đơn chỉ qua `POST /orders/:id/cancel`; `transition { to: canceled }` bị từ chối.

## Cách làm

- Đi đúng thứ tự bước 1–6 và 8, 10 của `ordering-o6-ops-golive.md`. Mỗi bước: code → test → gate liên quan → một
  commit trên `feat/ordering-o6` (kết thúc bằng dòng `Co-Authored-By` theo quy ước repo). Ghi bảng bước → commit
  vào Completion record khi làm.
- **Bước 7 (hạ tầng, Cloudflare, backup, bật production) và bước 9 (cổng go-live) KHÔNG tự làm.** Chỉ viết
  checklist/runbook và lệnh `cf` CLI đề xuất vào tài liệu; chủ dự án đăng nhập và chạy. Không đụng production.
- Chốt tiền hai lần cùng ngày/cùng người: chọn một (từ chối hoặc bản sửa có lý do), ghi vào Completion record.
- Báo cáo đọc từ snapshot và ledger (payment/refund), không đọc lại catalog. Tổng ngày phải khớp ledger.
- Job retention chỉ xóa field cá nhân trong raw payload (tên người chuyển, số tài khoản, nội dung chuyển khoản…),
  giữ id, số tiền, thời gian, mã tham chiếu cần cho đối soát/dedupe (`referenceCode`, `accountKey`, `memoCode`);
  chạy lại an toàn; theo lô, có giới hạn.
- CSV: quyền `export`, giới hạn khoảng ngày và số dòng như lead export (10.000), lọc theo scope chi nhánh.
- Ca test bắt buộc: mọi mục "Test bắt buộc" của spec O6. Thêm: mỗi rule cảnh báo mới không gửi email trùng khi
  điều kiện còn; "đã biết" không mở lại cho tới khi điều kiện hết rồi quay lại; chốt tiền tính đúng tiền mặt của
  người giao (O5) và trừ hoàn tiền mặt; hai quản lý chốt cùng lúc → một thắng; CSV ngoài scope không lộ đơn.
- Không log tên, số điện thoại, địa chỉ, số tài khoản hay nội dung chuyển khoản.

## Quy tắc bắt buộc

- Plugin không import code app. Không sửa content type, seed hay dữ liệu Salanca. **Không chạy `pnpm export:cms-seed`.**
- Chỉ dùng DB `salanca_ordering_o6` (UAT: `salanca_ordering_o6_uat`); không chạm `salanca_ordering_test`,
  `salanca_ordering_uat`, `salanca_cms` hay production. `check:phase3` và `smoke:reservation-form` luôn chạy với
  `DATABASE_NAME=salanca_ordering_o6`.
- Không thêm dependency khi chưa hỏi (biểu đồ báo cáo: bảng/số trước; cần thư viện chart thì hỏi). Không chép code
  GPL (Vendure, WooCommerce, TastyIgniter, Action Scheduler) — chỉ học cách làm.
- Đổi schema thì sinh lại `types/generated/contentTypes.d.ts` với `ORDERING_ENABLED=true` (`strapi ts:generate-types`).
- Không dùng `git stash` trần. Không in mật khẩu/token ra chat.
- Non-goals: VAT/hóa đơn điện tử, voucher, lịch hẹn, tồn kho, khuyến mãi.

## Cổng kiểm tra trước khi báo xong

```bash
export ORDERING_TEST_DATABASE=salanca_ordering_o6
pnpm run lint && pnpm run typecheck && pnpm run test
pnpm run check:ordering
DATABASE_NAME=salanca_ordering_o6 ORDERING_ENABLED=false pnpm run check:phase3
DATABASE_NAME=salanca_ordering_o6 ORDERING_ENABLED=true  pnpm run check:phase3
DATABASE_NAME=salanca_ordering_o6 ORDERING_ENABLED=true  pnpm run smoke:reservation-form
pnpm run smoke:ordering-pickup
node scripts/smoke-ordering-sepay.mjs
node scripts/smoke-ordering-delivery.mjs
ORDERING_ENABLED=true pnpm exec strapi build && ORDERING_ENABLED=false pnpm exec strapi build
```

Tất cả exit 0. Chạy tuần tự (build xóa `dist` giữa chừng làm test khác hỏng). Chạy `check:ordering` ít nhất hai
lượt liên tiếp; một lượt đạt không chứng minh hết chập chờn. Ghi số thật vào Completion record của
`ordering-o6-ops-golive.md` và `docs/STATUS.md` (kèm bảng gate O1–O6 theo "Bổ sung sau review"). Viết
`docs/ordering-ops-runbook.md`, hoàn thiện `docs/ordering-staff-guide.md` (chốt tiền, báo cáo) và
`docs/ordering-payments-runbook.md` (đối soát, khôi phục), cập nhật `docs/security-baseline.md`. UAT trên Chrome
(nếu được): dùng `uat-server.mjs` mở rộng; liệt kê rõ phần đã làm / chưa làm.

## Báo cáo khi xong

Danh sách commit, số test, kết quả từng gate, chỗ lệch kế hoạch/đặc tả (kèm lý do, gồm bảng `cash-closing`), lựa
chọn chốt tiền hai lần, danh sách cổng go-live còn chờ chủ dự án/kế toán/pháp lý, lệnh `cf`/backup đề xuất chưa chạy.
