# Spike plugin `ordering` trống (Mốc 0)

Status: Draft
Owner: tan_ngo (duyệt), Claude (thực hiện)
Last updated: 2026-10-10
Related phase: [`phases/phase-ordering-0-spike.md`](../phases/phase-ordering-0-spike.md) (O0,
`docs/plans/ordering-roadmap.md`).

## Goal

Chứng minh bằng code chạy thật rằng Strapi 5.51.1 của repo này làm được các việc mà
`ordering-core-contracts.md` giả định, trước khi viết nghiệp vụ. Kết quả là báo cáo
`docs/plans/ordering-spike-report.md`: mỗi mục kiểm có kết quả đạt, không đạt hoặc cách thay thế, cùng
quyết định cách đóng gói plugin.

## Non-goals

- Không viết nghiệp vụ: không tính giá, không workflow thật, không SePay thật, không web.
- Không sửa content type, seed bundle hay dữ liệu của Salanca (`menu-item`… giữ nguyên).
- Không merge vào `main`. Code nằm trên nhánh `spike/ordering-plugin`; giữ hay bỏ quyết định sau báo cáo.
- Các mục kiểm thuộc nghiệp vụ trong contracts mục 17 (6: response SePay/VNPAY/MoMo; 7: mixed product
  type, voucher, appointment; 9: làm tròn) chuyển sang unit test của Mốc 1, không làm ở spike.

## Current evidence

- Strapi `5.51.1`, TypeScript, pnpm `11.7.0` (`package.json`), PostgreSQL 16 qua `compose.yaml`
  (cổng 5433), deploy bằng Nixpacks trên Dokploy (`nixpacks.toml`: `pnpm install --frozen-lockfile`
  rồi `pnpm run build`).
- `pnpm-workspace.yaml` chỉ có package `.`; chưa có `src/plugins/`.
- `config/plugins.ts`, `config/middlewares.ts` có test đi kèm (`plugins.test.ts`, `middlewares.test.ts`).
  `strapi::cors` cho 4 header; `strapi::body` có `jsonLimit`/`formLimit`, chưa bật `includeUnparsed`.
- `config/server.ts` chưa bật cron.
- Script smoke khởi động Strapi bằng `compileStrapi()` + `createStrapi(appContext).load()`
  (`scripts/smoke-content-crud.mjs`).
- Đã đọc trong source local (reference C11, C18–C20): thứ tự register/bootstrap, `applyUserConfig`,
  `applyUserExtension`, condition engine, `koa-body` `includeUnparsed`, i18n coi relation là theo ngôn
  ngữ, plugin không nạp component, registry custom field.

## Decisions and assumptions

- Decision: plugin local tại `src/plugins/ordering`, UID `plugin::ordering.*`, không import code app
  (`ordering-plugin-direction`, contracts mục 1).
- Decision: chạy spike trên database riêng `salanca_ordering_spike`, không dùng DB dev hay production.
- Decision: plugin bật bằng `ORDERING_ENABLED` (mặc định `false`), để nhánh spike dù có merge cũng
  không đổi hành vi production.
- Assumption: cần `@strapi/sdk-plugin` để build plugin TypeScript có admin. Kiểm ở bước 1 bằng cách so
  hai cách (build riêng bằng SDK, hoặc để build của app biên dịch); chọn cách chạy được trên Nixpacks.
- Assumption: Strapi 5 không có cơ chế migration riêng cho plugin. Kiểm ở bước 8; nếu đúng, chọn giữa
  migration của app (`database/migrations`) do plugin cung cấp file mẫu, hoặc DDL idempotent trong
  bootstrap có khóa advisory.
- Owner decision required: không có quyết định chặn. Cần bạn chạy bước 11 (deploy staging) hoặc cấp
  quyền Dokploy.

## Invariants

- Không thay đổi dữ liệu, schema hay API hiện có của Salanca. `pnpm run check` của `main` vẫn đạt trên
  nhánh spike khi `ORDERING_ENABLED=false`.
- Không log dữ liệu cá nhân, không đưa secret thật vào repo; secret thử nghiệm sinh ngẫu nhiên trong
  script.
- Route public của plugin mặc định từ chối; không mở quyền Public/Authenticated.

## Implementation steps

1. **Khung plugin và build** (mục kiểm 1, 10, 19)
   - Files: `src/plugins/ordering/{package.json, server/src/index.ts, server/src/config/index.ts,
     admin/src/index.ts}`, `config/plugins.ts` (+ test), `pnpm-workspace.yaml` nếu cần.
   - Làm: `default` + `validator` (zod) trong config của plugin; app thêm
     `ordering: { enabled: env.bool('ORDERING_ENABLED', false), resolve: './src/plugins/ordering', config }`.
     Log thứ tự register plugin → register app → bootstrap plugin → bootstrap app.
   - Verification: `pnpm run build` đạt; `ORDERING_ENABLED=true pnpm run develop` nạp plugin; config sai
     làm Strapi dừng với `Error regarding ordering config`; log đúng thứ tự lifecycle; Admin hiện mục
     plugin. Ghi lại cách build được chọn.
2. **Content type tối thiểu** (mục kiểm 2, 3, 19)
   - Files: `src/plugins/ordering/server/src/content-types/{order, order-line, payment-event, outbox,
     job-lock, staff-location-scope, catalog-product}`.
   - Làm: `collectionName` tiền tố `plugins_ordering_`, tắt Draft & Publish và i18n, ẩn khỏi
     Content-Type Builder; bảng nội bộ ẩn khỏi Content Manager; `catalog-product` hiện ở Content Manager.
   - Verification: `psql` thấy bảng `plugins_ordering_*` và bảng nối relation; Content Manager chỉ hiện
     `catalog-product`; Content-Type Builder không hiện type nào của plugin; `curl` các đường
     `/api/...` đoán theo tên type trả 404.
3. **Transaction, khóa dòng, sequence** (mục kiểm 2)
   - Files: `server/src/services/spike-tx.ts`, `scripts/spike-ordering/tx.mjs`.
   - Làm: `strapi.db.transaction` + `forUpdate()` trên dòng order; 20 lần cập nhật song song không mất
     lần nào; sequence PostgreSQL cho mã đơn gọi `nextval` trong transaction; `onCommit` chạy sau commit,
     `onRollback` khi lỗi.
   - Verification: script in số cuối = 20; mã đơn không trùng qua 200 lần tạo song song; rollback không
     để lại dòng.
4. **Document Service middleware và đường vượt** (mục kiểm 3)
   - Files: `server/src/register.ts`, `scripts/spike-ordering/middleware.mjs`.
   - Làm: middleware chặn `update` order qua `strapi.documents`; thử cùng thao tác qua `strapi.db.query`.
   - Verification: Document Service bị chặn, `db.query` đi qua; ghi kết luận vào báo cáo.
5. **Permission và condition theo chi nhánh** (mục kiểm 8, 13)
   - Files: `server/src/bootstrap.ts` (đăng ký action, condition `same-location`),
     `scripts/spike-ordering/scope.mjs`.
   - Làm: hai admin user thuộc hai chi nhánh qua `staff-location-scope`; handler async trả query object;
     thử handler trả `false` và trả `null`.
   - Verification: user A chỉ thấy đơn chi nhánh A; không có scope thì bị từ chối; handler trả `null` thì
     engine cấp quyền không điều kiện (xác nhận rủi ro đã ghi ở C17.1).
6. **Cron và claim khi chạy 2 process** (mục kiểm 4)
   - Files: `server/src/services/spike-dispatcher.ts`, cron trong config plugin hoặc
     `strapi.cron.add`, `scripts/spike-ordering/dispatch.mjs`.
   - Làm: 100 dòng outbox; hai process `strapi start` cùng DB, cổng khác nhau; claim theo lô bằng
     `FOR UPDATE SKIP LOCKED` + lease 30 giây; tắt một process giữa chừng.
   - Verification: mỗi dòng giao đúng một lần; dòng của process bị tắt được process còn lại nhận sau khi
     lease hết hạn.
7. **Body gốc cho webhook và CORS** (mục kiểm 11, 12)
   - Files: `config/middlewares.ts` (+ test), route `POST /api/ordering/webhooks/spike`.
   - Làm: bật `includeUnparsed: true` cho `strapi::body`; route tính HMAC kiểu SePay trên
     `{timestamp}.{raw_body}`; thêm `X-Order-Token`, `Idempotency-Key` vào header CORS.
   - Verification: `curl` có chữ ký đúng → 200, sửa 1 byte body → 401; route trả lỗi rõ khi thiếu body
     gốc; preflight `OPTIONS` có hai header mới; upload media và form đặt bàn vẫn chạy
     (`pnpm run smoke:reservation-form`).
8. **Migration của plugin** (mục kiểm 5)
   - Files: tùy kết quả: `database/migrations/` của app, hoặc `server/src/migrations/` + runner.
   - Làm: thêm cột nullable vào bảng có dữ liệu cũ, backfill theo lô, rồi mới thêm ràng buộc; chạy hai
     lần liên tiếp và khi hai process khởi động cùng lúc.
   - Verification: dữ liệu cũ còn nguyên; chạy lại không lỗi; hai process không chạy trùng migration.
9. **Catalog trên Strapi** (mục kiểm 15–18)
   - Files: custom field `localized-text` (server register + admin input), field JSON `modifierGroups`,
     `src/extensions/ordering/strapi-server.ts`.
   - Làm: nhập tên VI/EN trong một ô custom field; tìm product theo `slug.vi` bằng truy vấn `jsonb`; app
     thêm field `isFeatured` qua extension; nâng phiên bản plugin (đổi một attribute khác) và khởi động
     lại.
   - Verification: Content Manager hiện ô nhập theo ngôn ngữ; truy vấn trả đúng product; field của app
     còn sau khi đổi plugin; Content Manager của content Salanca (đang bật i18n) không bị ảnh hưởng.
10. **Ngày kinh doanh** (mục kiểm 14)
    - Files: `server/src/domain/business-date.ts` + test Vitest.
    - Làm: hàm thuần dùng `Intl.DateTimeFormat` với `Asia/Ho_Chi_Minh`, giờ chốt 04:00, giờ mở 22:00–02:00.
    - Verification: `pnpm run test` có ca 01:30 thứ Bảy → thứ Sáu, ca 04:00 đúng biên, server chạy UTC.
11. **Deploy staging** (mục kiểm 1)
    - Làm: Nixpacks build cả plugin; bật `ORDERING_ENABLED=true` trên staging với DB staging.
    - Verification: build Dokploy đạt, Admin hiện plugin, `/_health` trả 204. Cần bạn chạy hoặc cấp quyền.
12. **Báo cáo**
    - Files: `docs/plans/ordering-spike-report.md`, cập nhật contracts mục 17 và roadmap.
    - Verification: mỗi mục kiểm 1–5, 8, 10–19 có kết quả và bằng chứng (lệnh, output rút gọn).

13. **Bổ sung sau review (2026-10-10)**
    - Làm: so `types/generated/contentTypes.d.ts` sau hai lần chạy với plugin bật; chạy `verify:schema`,
      `check:phase3` với plugin bật; plugin phát `strapi.eventHub.emit('ordering.admin.changed')`, listener
      thử trong app nhận được.
    - Verification: file types không đổi giữa hai lần; hai gate đạt; listener in event.

## Data and rollback

- Migration/backfill: chỉ trên DB `salanca_ordering_spike` (bước 8).
- Compatibility: `ORDERING_ENABLED=false` mặc định; khi tắt, app như `main`.
- Rollback: xóa nhánh `spike/ordering-plugin`, `DROP DATABASE salanca_ordering_spike`. Không đụng DB dev.

## Verification

- Automated: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`; với
  `ORDERING_ENABLED=false` thêm `pnpm run check:phase3`; các script `node scripts/spike-ordering/*.mjs`
  chạy với `DATABASE_NAME=salanca_ordering_spike ORDERING_ENABLED=true`.
- Manual UAT: mở Admin xem Content Manager, Content-Type Builder, ô nhập custom field, menu plugin.
- Evidence to record: `ordering-spike-report.md`.

## Documentation impact

- `docs/plans/ordering-spike-report.md` (mới); contracts mục 17 (kết quả từng mục kiểm); roadmap
  (Mốc 0 xong hay chưa). `docs/STATUS.md` chỉ cập nhật khi mở phase chính thức.

## Risks and blockers

- `includeUnparsed` giữ thêm một bản body trong bộ nhớ cho mọi request: đo trên route upload và form;
  nếu ảnh hưởng, cân nhắc chỉ bật khi plugin có provider cần chữ ký.
- Build admin của plugin làm `pnpm run build` chậm hơn: ghi thời gian trước/sau.
- Strapi không có migration cho plugin: đã có hai phương án thay thế ở "Decisions and assumptions".
- Custom field nhiều ngôn ngữ cần viết ô nhập React; nếu tốn quá nhiều công, dùng ô JSON thô cho spike
  và ghi lại ước lượng.
- Bước 11 cần quyền Dokploy.

## Completion record

- Bước 1 đã làm một phần trước khi spec được duyệt (2026-10-10), rồi dừng theo yêu cầu chủ dự án. Code
  nằm trong `git stash` "ordering O0 spike step 1 (plugin skeleton, config, load script)"; lấy lại bằng
  `git stash list` rồi `git stash apply <ref>` trên nhánh spike. DB `salanca_ordering_spike` đã tạo trên
  Postgres local.
- Đã xác nhận bằng code chạy thật (ghi lại vào báo cáo khi làm tiếp):
  - Thứ tự lifecycle: plugin register → app register → plugin bootstrap (log từ
    `scripts/spike-ordering/load.mjs`).
  - Strapi chỉ nạp server entry `.js`/`.json` (`@strapi/core/dist/utils/load-config-file.js`); plugin
    TypeScript phải build server bằng `tsc` riêng (`src/plugins/ordering/server/tsconfig.json`, output
    `dist/server`). Thiếu bản build thì Strapi **bỏ qua plugin không báo lỗi** (`loaders/plugins/index.js`
    kiểm `pathExists` rồi `continue`), nên `config/plugins.ts` phải tự báo lỗi khi bật mà chưa build.
  - Admin đọc thẳng source TS qua `exports['./strapi-admin'].import` (`@strapi/strapi/dist/src/node/core/plugins.js`);
    `tsconfig.json` của app đã loại `src/plugins/**`, `src/admin/tsconfig.json` đã gồm
    `../plugins/**/admin/src/**/*`.
  - Không thêm dependency: zod lấy từ `@strapi/utils` (`export { z }`, zod v4). Chưa cần `@strapi/sdk-plugin`.
  - `pnpm run build` có plugin: 52 giây (không plugin: 49 giây); bundle admin có trang của plugin.
  - Test: validator config (4), khai báo plugin trong config app (3), typecheck sạch.
