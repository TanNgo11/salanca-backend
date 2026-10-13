# Prompt: thực hiện Phase O10 (nền mở rộng)

Dán nguyên phần dưới vào session mới (hoặc gửi: "Đọc `D:\outsource\salanca\salanca-backend-o10\docs\plans\ordering-o10-handoff.md`
và làm theo phần dưới dấu `---`").

---

Làm việc trong **worktree** `D:\outsource\salanca\salanca-backend-o10`. Nhiệm vụ: code **Phase O10 — Nền mở rộng** của plugin
`ordering`: webhook ra ngoài có ký, OpenAPI, nhập/xuất catalog CSV, mẫu email sửa trong Admin. Spec, kế hoạch chi tiết, đặc tả màn
hình và mockup đã có; chỉ code theo đúng các tài liệu đó.

## Bước 0: worktree, nhánh, DB riêng

Worktree đã tạo sẵn: nhánh `feat/ordering-o10` từ nhánh tích hợp `feat/ordering` (`25cbbf4`, gồm O1–O6 + O15), `.env` đã copy.
Các thư mục `salanca-backend`, `salanca-backend-o6`, `salanca-backend-o7` (O7 đang code), `salanca-backend-o15` là của session
khác — **không sửa file, không chạy lệnh hay git trong đó**.

```bash
cd /d/outsource/salanca/salanca-backend-o10
git branch --show-current && git status --short    # feat/ordering-o10, sạch
pnpm install --frozen-lockfile
export ORDERING_TEST_DATABASE=salanca_ordering_o10   # harness tự tạo DB này lần đầu
```

Mọi lệnh test dùng DB `salanca_ordering_o10` (UAT nếu cần: `ORDERING_TEST_DATABASE=salanca_ordering_o10_uat UAT_PORT=1353`).
Không chạm `salanca_ordering_test`, `salanca_ordering_o6*`, `salanca_ordering_o7*`, `salanca_ordering_o15`, `salanca_cms`,
production.

**Nhánh:** khi xong và gate đạt → `git fetch origin && git merge origin/feat/ordering` (O7 có thể đã merge trước — giải conflict,
thường chỉ là các dòng cùng thêm vào routes/register/errors/menu/bản dịch/danh sách migration), chạy lại gate có chọn lọc, rồi
merge `feat/ordering-o10` vào `feat/ordering` và `git push origin feat/ordering-o10 feat/ordering` (chủ dự án đã cho phép push
theo luồng này). **Không** merge vào `main`.

## Đọc trước khi code (theo thứ tự)

1. `AGENTS.md`, `PLANS.md`, `docs/STATUS.md` (mục O5, O6, O15 mới nhất).
2. **`docs/phases/phase-ordering-10-extensibility.md`** (spec, test bắt buộc, UAT).
3. **`docs/plans/ordering-o10-extensibility.md`** (kế hoạch 9 bước: data model, API, mã lỗi, quyết định, file từng bước).
4. **`docs/plans/ordering-o10-screens.md`** (X1–X4) + quy ước chung đầu `ordering-o3-screens.md` + mục "Đã đổi khi code" của
   O3/O5/O6 screens. Đổi tên API thì sửa screens trong cùng commit.
5. `docs/plans/mockups/ordering-o10-extensibility.html`; `docs/plans/ordering-reference.md` mục U10.
6. `docs/plans/ordering-core-contracts.md` mục 12 (outbox), 13 (API), 15 (PII), 21.6 (change-log).
7. `docs/plans/ordering-o15-audit-log.md` mục "Đã đổi khi code O15" (cách ghi lịch sử thay đổi — O10 phải dùng).

## Thay đổi so với kế hoạch (đã biết trước khi code)

- **Migration** đặt tên `0006-o10-extensibility` (kế hoạch ghi `0008`; `0005-o7-…` và `0005-o15-audit-log` đã dùng số 5 —
  runner chạy theo tên, không theo số).
- **Lịch sử thay đổi (O15):** mọi thao tác Admin mới (tạo/sửa/xoay bí mật/bật tắt webhook, gửi lại, nhập catalog, lưu/khôi phục mẫu
  email) ghi `change-log.record` với mã mới — **thêm mã vào `server/src/domain/audit/actions.ts`** (nhóm `config` cho webhook và
  mẫu email, `catalog` cho nhập CSV). Test `domain/audit/actions.test.ts` quét source sẽ đỏ nếu thiếu. Nhập catalog qua service
  catalog sẽ đi qua middleware Document Service và tự ghi một dòng mỗi bản ghi — nếu muốn chỉ một dòng tóm tắt `catalog.import`,
  bọc lệnh bằng `withAuditSuppressed(uid, fn)` (`domain/audit/suppress.ts`) như `catalog-category.ts`.
- **Mã cảnh báo mới** (`webhook-endpoint-disabled`, `notification-template-broken`): thêm đủ 4 chỗ như O15 làm với
  `audit-tampered` — `domain/alert-codes.ts` (danh sách + nhãn), `services/alert-rules.ts` (mặc định), `admin/src/pages/Settings/
  index.tsx` (`ALERT_CODES`), `admin/src/translations/o6.ts` (`alert.code.*`). Alert do job/consumer mở thì tự truyền `severity`
  (chỉ rule đếm sự kiện thật mới nâng theo `count` — xem `COUNT_ESCALATED` trong `services/alert.ts`).
- **Job mới** (`webhook-dispatcher`): thêm vào `server/src/jobs/catalog.ts` (`ORDERING_JOBS`), cron trong `config/index.ts`
  (`jobs.*Cron`, `heartbeatMinutes`), nhãn `ops.job.<name>` trong bản dịch.

## Đã có từ O0–O6, O15 (dùng lại, không làm lại)

- Outbox `services/outbox.ts` (`enqueue` trong transaction, `dispatch` claim `FOR UPDATE SKIP LOCKED` + lease, backoff,
  `registry.registerOutboxConsumer`); job lock `services/job-lock.ts` (`withLock`, `heartbeat`).
- CSV ghi: `domain/csv.ts` (`buildCsv`, `escapeCsvCell`, BOM) — O10 thêm `parseCsv`. Giới hạn xuất `shared/export-limits.ts`.
- Mã hóa bí mật: `domain/token-cipher.ts` (`encryptSecret/decryptSecret`, `encryptionKey`); hash `domain/hashing.ts`; che PII
  `domain/pii.ts` (`maskPayload`).
- Email: `domain/notifications/templates.ts` (`TemplateCode`, `renderTemplate`, `renderOpsAlert`), `services/notification.ts`
  (`deliver` dedupe), provider `providers/email-notification.ts`.
- Catalog: service `catalog-category`, `catalog-slug`, middleware Document Service trong `register.ts` (`catalogIntegrity`,
  `catalogChangeLog`), quyền `catalog.manage`.
- Routes `routes/index.ts` (`publicRoute`, `adminRoute(method, path, handler, ...actions)` — nhiều quyền là tham số rời, không
  phải mảng); controller dùng `adminAction` (`controllers/http.ts`); tải file như `controllers/admin-orders.ts` `exportOrders`
  (Admin tải bằng `responseType: 'blob'` như `components/OrderExportModal.tsx`).
- Admin: menu con "Bán hàng" (`admin/src/pages/App.tsx`, nhóm Vận hành / Báo cáo / Món / Cấu hình), `lib/permissions.ts`
  (`useRBAC` nhận mảng hằng), bản dịch `translations/o10.ts` dạng `[vi, en]` merge trong `lib/i18n.ts` + `index.ts`
  `registerTrads`, thêm `pages/<Trang>` vào `O3_DIRS` của `translations/o3.test.ts`.
- Harness: `scripts/ordering/_harness.mjs` (`withApp`, `seedBranches`, `seedMenu`, `seedAdminHttpStaff` — `ORDERING_ACTIONS` thêm
  quyền mới `webhook.manage`), thêm script mới vào `run-all.mjs`.

## Những điều đã chứng minh (không đọc lại source để cãi)

- Strapi 5.51.1 không tạo unique index cho `unique: true` → constraint/index bằng migration plugin.
- `strapi.db.transaction` lồng nhau dùng lại transaction ngoài; `onCommit` chạy sau commit ngoài cùng.
- `db.raw`/knex có thể trả cột JSON dạng **chuỗi** — parse khi đọc qua raw SQL. Tên bảng plugin là số ít
  (`plugins_ordering_<content-type>`, ví dụ `plugins_ordering_admin_change_log`).
- `@strapi/utils` dùng API zod 4 (`.prefault`) — kiểm `z.toJSONSchema` có dùng được không trước khi dựa vào.
- Code admin không import `server/**` hay `@strapi/utils`; logic dùng chung ở `src/plugins/ordering/shared/`.
- Trong `Modal` không dùng `SimpleMenu`/dropdown mới (đã treo trang ở O3); dùng nút/panel. `SingleSelect` ngoài Modal thì được.
- Field tên `locale` bị Strapi dành cho i18n (dùng `messageLocale` cho mẫu email như kế hoạch).
- Không có ESLint plugin `react-hooks` — đừng thêm `eslint-disable react-hooks/...`.
- Test nhiều process phải có barrier (xem `outbox-two-process.mjs`); lease/khóa trong test dài hơn thời gian process kia chạy.
- Gọi HTTPS tới IP đã kiểm (chống SSRF/DNS rebinding) dùng `node:https` `request` với tùy chọn `lookup` trả IP đã kiểm — **không**
  đặt header `Host` lên URL IP (hỏng SNI/TLS). Không thêm dependency (không `undici` riêng).
- Cảnh báo `pg` "client.query() when the client is already executing a query" đến từ populate của `@strapi/database` — không sửa.

## Cách làm

- Đi đúng thứ tự 9 bước của `ordering-o10-extensibility.md`. Mỗi bước: code → test → một commit trên `feat/ordering-o10` (kết thúc
  bằng dòng `Co-Authored-By` theo quy ước repo). Ghi bảng bước → commit vào Completion record.
- Bảo mật là phần chính: viết `url-guard` + test dải IP cấm trước khi viết dispatcher; payload webhook mặc định không có dữ liệu cá
  nhân; bí mật chỉ trả một lần; không log URL query string, bí mật, body phản hồi.
- Không log tên, số điện thoại, địa chỉ khách.

## Quy tắc bắt buộc

- Plugin không import code app. Không sửa content type, seed hay dữ liệu Salanca. **Không chạy `pnpm export:cms-seed`.**
- Không thêm dependency khi chưa hỏi. Không chép code GPL (WooCommerce, TastyIgniter) — chỉ học.
- Đổi schema thì sinh lại `types/generated/contentTypes.d.ts` với `ORDERING_ENABLED=true pnpm exec strapi ts:generate-types`.
- Không dùng `git stash` trần. Không in mật khẩu/token/bí mật webhook ra chat.

## Cổng kiểm tra (có chọn lọc — quy ước chủ dự án từ O7)

**Không** chạy lại toàn bộ gate (`check:ordering` ×2, `check:phase3` tắt/bật, bộ smoke) — tốn ~1 giờ mỗi lượt. Chạy:

```bash
export ORDERING_TEST_DATABASE=salanca_ordering_o10
pnpm run lint && pnpm run typecheck
pnpm exec vitest run src/plugins/ordering          # unit test plugin + test dịch admin
pnpm run build:ordering
node scripts/ordering/<mỗi script mới của O10>.mjs  # webhooks-out, openapi, catalog-csv, email-templates
node scripts/ordering/<script cũ bị ảnh hưởng>.mjs  # ít nhất: schema, notifications, alerts-engine, ops-status,
                                                    # catalog-categories, catalog-api, audit-coverage, audit-log
ORDERING_ENABLED=true pnpm exec strapi build        # có màn Admin mới
```

Lỗi ở bước nào thì sửa rồi **chỉ chạy lại bước đó**, không chạy lại từ đầu. Không UAT giao diện trên Chrome — chủ dự án tự UAT sau.
Ghi lệnh và kết quả thật vào Completion record của `ordering-o10-extensibility.md` (ghi rõ "targeted gates") và một mục O10 trong
`docs/STATUS.md`. Viết `docs/ordering-integrations.md` (đăng ký webhook, kiểm chữ ký mẫu Node/PHP, danh mục sự kiện, OpenAPI, CSV
mẫu), cập nhật `docs/ordering-staff-guide.md` (nhập/xuất menu, sửa mẫu email), `docs/ordering-api-contract.md`,
`docs/security-baseline.md` (SSRF, dữ liệu ra ngoài), mục "Đã đổi khi code O10" trong `ordering-o10-screens.md`.

## Báo cáo khi xong

Danh sách commit, kết quả từng lệnh gate (số thật), chỗ lệch kế hoạch/đặc tả (kèm lý do), `z.toJSONSchema` có dùng được không,
conflict khi merge `feat/ordering` (nếu có) và cách giải, trạng thái push.
