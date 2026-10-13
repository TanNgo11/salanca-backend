# Prompt: thực hiện Phase O14 (bảng giá theo kênh, nhóm khách, khung giờ)

Dán nguyên phần dưới vào session mới (hoặc gửi: "Đọc `D:\outsource\salanca\salanca-backend-o14\docs\plans\ordering-o14-handoff.md`
và làm theo phần dưới dấu `---`").

---

Làm việc trong **worktree** `D:\outsource\salanca\salanca-backend-o14`. Nhiệm vụ: code **Phase O14 — Bảng giá theo kênh, nhóm
khách, khung giờ** của plugin `ordering`:

- kênh chuẩn cho giá;
- rule ngày trong tuần / khung giờ (happy hour);
- bảng giá `override` / `adjust`;
- nhóm khách (thủ công + tự động);
- xem trước giá;
- màn Admin L1–L3.

Spec, kế hoạch chi tiết và đặc tả màn hình đã có; chỉ code theo đúng các tài liệu đó cộng phần "Thay đổi so với kế hoạch" bên dưới.

## Bước 0: worktree, nhánh, DB riêng

Worktree đã tạo sẵn: nhánh `feat/ordering-o14` từ nhánh tích hợp `feat/ordering` (`e692713`, gồm O1–O8, O10, O11, O15 và đợt
hoàn thiện sau O8/O11), `.env` đã copy. Các thư mục `salanca-backend`, `salanca-backend-docs`, `salanca-backend-o6`,
`salanca-backend-o7`, `salanca-backend-o8`, `salanca-backend-o10`, `salanca-backend-o11`, `salanca-backend-o15`,
`salanca-backend-finish` là của session khác — **không sửa file, không chạy lệnh hay git trong đó**.

```bash
cd /d/outsource/salanca/salanca-backend-o14
git branch --show-current && git status --short    # feat/ordering-o14, sạch
pnpm install --frozen-lockfile                     # repo có .npmrc trỏ npm công khai; KHÔNG sửa .npmrc/pnpm-workspace.yaml
pnpm run build:ordering                            # bắt buộc trước script / ts:generate-types (đọc dist của plugin)
export ORDERING_TEST_DATABASE=salanca_ordering_o14 # harness tự tạo DB này lần đầu
```

**DB:**
- Mọi lệnh test dùng `salanca_ordering_o14`. UAT nếu cần: `ORDERING_TEST_DATABASE=salanca_ordering_o14_uat UAT_PORT=1356`.
- **Tuyệt đối không** chạy lệnh nào nhắm DB dev `salanca_cms` hay production — kể cả `check:phase3`, `smoke:*`, `strapi develop`.
- Lệnh nào đọc `DATABASE_NAME` thì đặt rõ `DATABASE_NAME=salanca_ordering_o14`.

**Nhánh — khi xong và gate đạt:**
1. `git fetch origin && git merge origin/feat/ordering`. Giải conflict bằng cách lấy **cả hai** bên: routes, register, errors,
   config, menu, bản dịch, chuỗi `messagesOf` trong `lib/i18n.ts`, `translations/o3.test.ts`, danh sách migration,
   `audit/actions.ts`, `run-all.mjs`, `schema.mjs`, STATUS.
2. Chạy `pnpm run build:ordering` rồi gate gọn.
3. Merge `feat/ordering-o14` vào `feat/ordering` và `git push origin feat/ordering-o14 feat/ordering` (chủ dự án đã cho phép
   push theo luồng này).
4. **Không** merge vào `main`.

**Chuỗi i18n chỉ dùng `??`.** Trộn `||` với `??` thì esbuild từ chối và `strapi build` chết; lỗi này đã xảy ra một lần lúc merge.

## Đọc trước khi code (theo thứ tự)

1. `AGENTS.md`, `PLANS.md`, `docs/STATUS.md` (các mục 2026-10-13 mới nhất: O8, O11, đợt hoàn thiện).
2. **`docs/phases/phase-ordering-14-price-lists.md`** (spec, test bắt buộc, UAT).
3. **`docs/plans/ordering-o14-price-lists.md`**: kế hoạch 6 bước, data model, API, quyết định, đặc tả màn L1–L3 ngay trong file.
4. Quy ước màn hình đầu `docs/plans/ordering-o3-screens.md` + mục "Đã đổi khi code" của O8/O11 screens.
5. `docs/plans/ordering-o8-promotions-rating.md` Completion record (quote không nhận số điện thoại, `pendingPromotions`) và
   `docs/plans/ordering-o11-customers-cart.md` Completion record (phiên khách OTP, `customerId` trên đơn, giỏ).
6. Code hiện có:
   - `domain/catalog/price-selection.ts`;
   - `providers/ordering-catalog/adapter.ts` (đang truyền `channel: ctx.channel` = `consent.channel`);
   - `content-types/catalog-price/schema.ts`;
   - `services/order.ts` (`prepareOrder`);
   - `controllers/catalog.ts`;
   - `controllers/storefront.ts` (`sessionFor`).

## Thay đổi so với kế hoạch (đã biết trước khi code)

- **Migration:** đặt tên `0009-o14-price-lists`. Kế hoạch ghi `0012`, nhưng `0008-o8-promotions-rating` là số cuối hiện có;
  runner chạy theo tên. Thêm vào cuối `migrations/index.ts`, `persisted-tables.ts`, ledger trong `scripts/ordering/schema.mjs`.
- **Giá theo nhóm khách chỉ dựa trên danh tính đã xác thực.** O8 đã bỏ số điện thoại khỏi báo giá công khai để không ai dò
  được "số này từng đặt chưa". O14 giữ nguyên nguyên tắc đó:
  - **Khách đăng nhập OTP:** nhóm lấy từ phiên `X-Customer-Token` (`sessionFor`), ở cả `GET /catalog/*`, `POST /quote`, giỏ và
    `POST /orders`. Quote và create cùng phiên phải ra cùng giá.
  - **Khách vãng lai:** luôn giá thường, kể cả khi số điện thoại khớp một hồ sơ trong nhóm. Không suy nhóm từ số điện thoại ở
    luồng công khai.
  - **Đơn hộ (staff draft):** nhân viên đã đăng nhập Admin, nên được dùng nhóm của hồ sơ khách gắn với đơn, nếu có.
  - **Sửa đơn O7** (`services/order-edit.ts`, dòng thêm mới): dùng kênh của đơn và nhóm của `order.customer` lúc sửa. Ghi rõ lựa
    chọn này vào Completion record.
- **Cache catalog công khai.** `controllers/catalog.ts` đang trả `Cache-Control: public, max-age=30`. Khi request có phiên khách
  (giá có thể khác theo nhóm), phải trả `private, no-store`. Không để CDN cache giá riêng của một khách rồi đưa cho người khác.
  Thêm test cho chuyện này.
- **Kênh chuẩn:**
  - giá trị: `pickup` | `delivery` | `dine-in` | `staff`;
  - đơn hộ là `staff` (`origin.kind = 'staff-draft'`);
  - migration chuyển rule kênh cũ (`web-checkout`/`phone-staff`) theo kế hoạch;
  - `dine-in` chưa có luồng (O12): chỉ cần chấp nhận giá trị, không làm luồng.
- **Thứ tự tiền:** bảng giá quyết `unitAmount` → pipeline → khuyến mãi O8 áp trên giá đó. Test bắt buộc:
  - một mã 10% trên món đang có giá happy hour giảm đúng 10% của giá happy hour;
  - `promotions.mjs` và `promotion-money.mjs` vẫn xanh.
- **Xóa dữ liệu khách (O11, `services/data-rights.ts`):** khi ẩn danh, gỡ khách khỏi mọi `customer-group`, rồi thêm ca vào
  `data-rights.mjs`. Nhóm tự động tính lại hằng ngày không được kéo khách đã xóa trở lại.
- **Job mới `customer-group-refresh` (hằng ngày):**
  - thêm vào `server/src/jobs/catalog.ts`;
  - cron trong `config/index.ts` (`jobs.*Cron`, `heartbeatMinutes`);
  - nhãn `ops.job.customer-group-refresh` trong bản dịch;
  - khóa job như các job khác;
  - chạy theo lô, không quét cả bảng đơn trong một transaction.
- **Quyền mới `price.manage`:**
  - `register.ts`;
  - `ORDERING_ACTIONS` trong `scripts/ordering/_harness.mjs`;
  - hằng RBAC trong `admin/src/lib/permissions.ts`;
  - `useRBAC` + danh sách `loading` trong `admin/src/pages/App.tsx`.
- **Lịch sử thay đổi (O15):** mọi thao tác Admin mới ghi `change-log.record`; thêm mã vào `server/src/domain/audit/actions.ts`.
  - Mã cần có: `price-list.create`, `price-list.update`, `price-list.active`, `customer-group.create`, `customer-group.update`,
    `customer-group.members`.
  - Nhóm audit: `catalog` cho bảng giá; nhóm khách chọn `access` hoặc `promotion`, ghi lý do.
  - Test `domain/audit/actions.test.ts` quét source sẽ đỏ nếu thiếu mã.
  - `audit-coverage.mjs` thêm ít nhất 1 ca bảng giá.
  - Không log thông tin cá nhân của thành viên nhóm; log số lượng thêm/bớt.
- **OpenAPI (O10):** route mới phải khai báo trong `server/src/openapi/operations.ts`, không thì `openapi.mjs` đỏ. Chạy
  `node scripts/ordering/openapi.mjs --write` để sinh lại `docs/ordering-admin-openapi.json`.
- **Webhook ra ngoài:** không bắt buộc trong O14.
- **Gate cuối bước 6** của kế hoạch ghi "`check:ordering` 2 lượt" — **bỏ**, dùng gate gọn bên dưới.

## Đã có (dùng lại, không làm lại)

- **Giá:** `domain/catalog/price-selection.ts` (`selectCatalogPrice`: rule khớp hết → priority → minQuantity → giá thấp),
  `catalog-price` có `rules`/`priority`/`validFrom`/`validTo`/`compareAtAmount`; pipeline `domain/pricing/pipeline.ts`.
- **Khách O11:**
  - `services/customer.ts`, `services/customer-auth.ts`;
  - phiên `X-Customer-Token` (`sessionFor` trong controllers);
  - `order.customer`;
  - màn Khách hàng ở `admin/src/pages/Customers/` (L3 đặt cạnh màn này, và tìm khách để thêm vào nhóm dùng lại API tìm khách của O11).
- **Khuyến mãi O8:**
  - `services/promotion.ts`;
  - `domain/promotions/evaluate.ts`: target theo `sellableUid`/danh mục — dùng lại cách chọn món/danh mục;
  - `GET /promotions/targets`: chi nhánh, món, danh mục từ catalog adapter — L1 có thể gọi lại hoặc tách hàm dùng chung.
- **Admin:**
  - menu con "Bán hàng" (`admin/src/pages/App.tsx`);
  - bản dịch `translations/o14.ts` dạng `[vi, en]`, nối vào `lib/i18n.ts` (chỉ `??`) và `admin/src/index.ts`;
  - thêm `pages/PriceLists`, `pages/CustomerGroups` vào `O3_DIRS` của `translations/o3.test.ts`, khóa động vào `DYNAMIC`.
- **Harness:** `withApp`, `seedBranches`, `seedMenu`, `seedAdminHttpStaff`. Script mới thêm vào `run-all.mjs`.

## Những điều đã chứng minh (không đọc lại source để cãi)

- **DB và content type:**
  - Strapi 5.51.1 không tạo unique index cho `unique: true` → constraint/index bằng migration plugin.
  - Tên bảng plugin số ít (`plugins_ordering_<content-type>`); bảng nối của relation dạng `plugins_ordering_<a>_<field>_lnk`.
  - Đổi content type thì sinh lại types bằng `ORDERING_ENABLED=true pnpm exec strapi ts:generate-types`.
- **Transaction và SQL thô:**
  - `strapi.db.transaction` lồng nhau dùng lại transaction ngoài; `onCommit` chạy sau commit ngoài cùng.
  - knex/`db.raw` có thể trả cột JSON dạng **chuỗi** — parse khi đọc qua raw SQL.
- **Build và kiểm tra:**
  - `pnpm run typecheck` ở root **không** kiểm server lẫn admin của plugin. Lỗi server chỉ hiện ở `pnpm run build:ordering`;
    lỗi admin ở `pnpm run typecheck:admin`.
  - `ts:generate-types` đọc `dist` của plugin → chạy `build:ordering` trước, nếu không types sinh ra **mất** field mới. Kiểm
    `git diff types/` trước khi commit.
- **Admin (design-system 2.2.3):**
  - **Không có `Dialog.Title`.** Dùng nó thì dialog crash khi mở; tiêu đề đặt thẳng trong `<Dialog.Header>`.
  - `NumberInput` dùng `min`/`max`, không có `minValue`/`maxValue`.
  - `Table` cần `rowCount`.
  - Trong `Modal` không dùng `SimpleMenu`/dropdown; `SingleSelect` ngoài Modal thì được.
  - Không có ESLint plugin `react-hooks`.
  - Code admin không import `server/**` hay `@strapi/utils`; logic dùng chung ở `src/plugins/ordering/shared/`.
- **Linh tinh:**
  - Field tên `locale` bị Strapi dành cho i18n.
  - `adminRoute(method, path, handler, ...actions)` — nhiều quyền là tham số rời, không phải mảng.
  - `fetch().text()` bỏ BOM; kiểm CSV BOM thì đọc `arrayBuffer` với `TextDecoder(..., { ignoreBOM: true })`.
  - Cảnh báo `pg` "client.query() when the client is already executing a query" đến từ populate của `@strapi/database` — không sửa.

## Cách làm

- Đi đúng thứ tự 6 bước của `ordering-o14-price-lists.md`. Mỗi bước là code → test → một commit trên `feat/ordering-o14`, kết thúc
  bằng dòng `Co-Authored-By` theo quy ước repo. Ghi bảng bước → commit vào Completion record.
- **Tiền là phần chính.** Bước 1 (hàm thuần, ≥ 25 ca) phải xong và xanh trước khi nối service. Bất biến:
  - giá không âm;
  - quote = create cùng ngữ cảnh/giờ;
  - đơn đã đặt không đổi khi bảng giá hay nhóm đổi;
  - khuyến mãi áp sau bảng giá;
  - khung giờ qua nửa đêm theo giờ chi nhánh;
  - nhiều nhóm → giá thấp nhất.
- Không log số điện thoại, email, tên khách.

## Quy tắc bắt buộc

- Plugin không import code app; không dùng `users-permissions`. Không sửa content type, seed hay dữ liệu Salanca.
  **Không chạy `pnpm export:cms-seed`.**
- Không thêm hay nâng dependency khi chưa hỏi. Không sửa `.npmrc` và `pnpm-workspace.yaml`. Không chép code GPL — chỉ học.
- Không dùng `git stash` trần. Không in mật khẩu/token/OTP ra chat.

## Cổng kiểm tra (gọn — chủ dự án không muốn chạy cả loạt)

**Không** chạy `check:ordering`, `check:phase3`, smoke, hay hàng chục script "cho chắc". Mỗi bước chỉ chạy phần nó đụng tới; cuối
phase chạy một lần:

```bash
export ORDERING_TEST_DATABASE=salanca_ordering_o14
pnpm run lint && pnpm run typecheck && pnpm run typecheck:admin
pnpm exec vitest run src/plugins/ordering
pnpm run build:ordering
node scripts/ordering/price-lists.mjs          # mới (+ customer-groups.mjs nếu tách)
node scripts/ordering/<5–8 script bị ảnh hưởng>.mjs
#   catalog-api, catalog-adapter, create-order, storefront, promotions, cart,
#   data-rights, schema, audit-coverage, openapi --write
ORDERING_ENABLED=true pnpm exec strapi build   # một lần, vì có màn Admin mới
```

- Lỗi ở bước nào thì sửa rồi **chỉ chạy lại bước đó**.
- Script không tự mở tab trình duyệt nữa (harness đặt `admin.autoOpen=false`). Nếu tab lại bật, kiểm chỗ đó trước.
- Không UAT giao diện trên Chrome — chủ dự án tự UAT sau.

**Ghi kết quả:**
- Lệnh và kết quả thật vào Completion record của `ordering-o14-price-lists.md` (ghi rõ "targeted gates"), và một mục O14 trong
  `docs/STATUS.md`.
- Cập nhật:
  - `docs/ordering-catalog-guide.md` (bảng giá);
  - `docs/ordering-api-contract.md` (kênh, giá theo phiên khách, `Cache-Control` khi có phiên);
  - `docs/ordering-staff-guide.md` (bảng giá, nhóm khách);
  - `docs/security-baseline.md` (giá nhóm chỉ theo danh tính đã xác thực, không cache công khai);
  - mục "Đã đổi khi code O14" trong file kế hoạch;
  - `uat-server.mjs`: một bảng giá happy hour đồ uống và một nhóm khách có thành viên.

## Báo cáo khi xong

- Danh sách commit.
- Kết quả từng lệnh gate (số thật).
- Chỗ lệch kế hoạch/đặc tả (kèm lý do), nhất là quyết định nhóm khách khi sửa đơn và với đơn hộ.
- Việc để lại cho O16 (hạng thành viên gắn nhóm giá) và O12 (`dine-in`).
- Conflict khi merge `feat/ordering` (nếu có) và cách giải.
- Trạng thái push.
