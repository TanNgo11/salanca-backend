# Prompt: thực hiện Phase O9 (thẻ quà tặng)

Gửi cho agent: "Đọc `C:\Users\tan_ngo\orca\workspaces\salanca-backend\ordering-o9\docs\plans\ordering-o9-handoff.md` và làm theo phần dưới dấu `---`".

---

Làm việc trong **worktree** `C:\Users\tan_ngo\orca\workspaces\salanca-backend\ordering-o9`. Đây là nhánh git `TanNgo11/ordering-o9` (Orca tạo). Khi đẩy lên origin dùng tên
`feat/ordering-o9`: `git push origin HEAD:feat/ordering-o9`.

Nhiệm vụ: code **Phase O9 — thẻ quà tặng** của plugin `ordering` (Strapi 5.51.1, local plugin `src/plugins/ordering`). Spec, kế
hoạch chi tiết và đặc tả màn hình đã có; code theo đúng các tài liệu đó, cộng phần "Thay đổi so với kế hoạch" bên dưới.

Làm **tự chủ tới hết**: không có người trả lời câu hỏi giữa chừng. Gặp chỗ mơ hồ thì chọn phương án an toàn, đơn giản, và ghi
lý do vào Completion record.

## Bước 0: môi trường

Worktree tách từ `origin/feat/ordering` tại `d292229` (gồm O1–O8, O10, O11, O14, O15 và các bản sửa sau review), `.env` đã
copy.

Đang có 2 agent khác làm song song: O12 (nhà hàng) ở `ordering-o12` và O13 (provider) ở `ordering-o13`. Mọi thư mục khác dưới `D:\outsource\salanca\` và
`C:\Users\tan_ngo\orca\workspaces\salanca-backend\` là của session khác — **không sửa file, không chạy lệnh hay git trong đó**.

```bash
cd "C:/Users/tan_ngo/orca/workspaces/salanca-backend/ordering-o9"
git status --short                                   # sạch
pnpm install --frozen-lockfile                       # repo có .npmrc trỏ npm công khai; KHÔNG sửa .npmrc, pnpm-workspace.yaml
pnpm run build:ordering                              # bắt buộc trước script / ts:generate-types
export ORDERING_TEST_DATABASE=salanca_ordering_o9   # harness tự tạo DB này lần đầu
```

**DB:**
- Mọi lệnh test dùng `salanca_ordering_o9`. UAT seed nếu cần: `ORDERING_TEST_DATABASE=salanca_ordering_o9_uat UAT_PORT=1357`.
- **Tuyệt đối không** chạy lệnh nào nhắm DB dev `salanca_cms` hay production — kể cả `check:phase3`, `smoke:*`, `strapi develop`.
- Lệnh nào đọc `DATABASE_NAME` thì đặt rõ `DATABASE_NAME=salanca_ordering_o9`.

**Nhánh, merge, push — khi xong và gate đạt:**

1. `git fetch origin && git merge origin/feat/ordering`, vì phase khác có thể đã vào trước. Giải conflict bằng cách lấy **cả
   hai** bên. Các file hay conflict:
   - routes, register, errors, config, menu `App.tsx`, bản dịch;
   - chuỗi `messagesOf` trong `admin/src/lib/i18n.ts` — **chỉ dùng `??`**; trộn `||` thì esbuild chết;
   - `translations/o3.test.ts` (`O3_DIRS`, `DYNAMIC`);
   - `migrations/index.ts`, `persisted-tables.ts`;
   - `audit/actions.ts`;
   - bộ 4 chỗ của alert: `alert-codes`, `alert-rules`, Settings `ALERT_CODES`, `translations/o6.ts`;
   - bộ mẫu email: `TEMPLATE_CODES`/`_allCodes`/`TEMPLATE_NAMES` và số mẫu trong `scripts/ordering/email-templates.mjs`;
   - `openapi/operations.ts`, `run-all.mjs`, `schema.mjs`, `ORDERING_ACTIONS` trong `_harness.mjs`, STATUS.
2. `pnpm run build:ordering`, rồi chạy lại gate gọn (chỉ phần đụng conflict).
3. `git push origin HEAD:feat/ordering-o9` rồi `git push origin HEAD:feat/ordering`. Nếu push `feat/ordering` bị từ chối vì
   phase khác vừa push: fetch, merge lại, gate gọn, push lại.
4. **Không** merge vào `main`, không force push.

## Đọc trước khi code (theo thứ tự)

1. `AGENTS.md`, `PLANS.md`, `docs/STATUS.md` (các mục 2026-10-13).
2. **`docs/plans/ordering-decisions-2026-10-13.md`** — quyết định mặc định của chủ dự án; **thắng** mọi chỗ "chờ quyết định" trong
   spec/plan.
3. **`docs/phases/phase-ordering-9-gift-cards.md`** (spec, test bắt buộc, UAT).
4. **`docs/plans/ordering-o9-gift-cards.md`** (kế hoạch 7 bước, data model, API, quyết định).
5. **`docs/plans/ordering-o9-screens.md`** + quy ước đầu `docs/plans/ordering-o3-screens.md`.
6. `docs/plans/ordering-core-contracts.md` §10 (VoucherProvider), §19.9 câu 2; Completion record của O8, O11, O14
   (`docs/plans/ordering-o8-promotions-rating.md`, `ordering-o11-customers-cart.md`, `ordering-o14-price-lists.md`).


## Thay đổi so với kế hoạch (đã biết trước khi code)

**Migration**
- Đặt tên `0010-o9-gift-cards`. Kế hoạch ghi `0007`, nhưng `0007`–`0009` đã dùng. O12 dùng `0011`, O13 dùng `0012`.

**Quyết định đã chốt** (`ordering-decisions-2026-10-13.md`)
- Hạn 12 tháng (`giftCards.validityMonths`). Không hoàn tiền thẻ chưa dùng (`giftCards.refundable=false`).
- Không xuất hóa đơn lúc bán; báo cáo tách "Bán thẻ" khỏi doanh thu và có báo cáo "Số dư thẻ hết hạn".
- **Có thẻ giấy:**
  - Admin sinh lô N mã để in (xuất CSV một lần, mã gốc chỉ có trong file đó) hoặc nhập lô CSV mã in sẵn;
  - mỗi thẻ có mệnh giá, trạng thái `inactive`;
  - kích hoạt khi bán ở quầy (đơn hộ + thu tiền mặt, nhập mã thẻ giấy) — đổi sang `active`, ghi sổ `issue`, hạn tính từ lúc
    kích hoạt;
  - quyền `gift-card.manage`; change-log chỉ ghi số lượng và 4 ký tự cuối.
  - Đây là bước mới chèn giữa bước 5 và 6 của kế hoạch.

**Nhập mã thẻ** (lúc báo giá, giỏ, tạo đơn)
- Mã thẻ là thứ khách nhập để đoán được → dùng **cùng bộ chặn đoán mã theo IP** như mã khuyến mãi (captcha sau 3 lần sai,
  429 tại ngưỡng).
- Báo giá chỉ hiện "thẻ hợp lệ, số dư áp dụng tối đa X". Không trả số dư chính xác cho mã sai.
- Lỗi chung `GIFT_CARD_INVALID` cho mã không có / đã khóa / hết hạn, để không lộ trạng thái.

**Đụng phase khác**
- **Giỏ O11** (`services/cart.ts`): thêm `giftCardCode` giống `promotionCode` (PATCH, quote, checkout, chặn đoán mã) nếu kịp.
  Không kịp thì ghi "để sau".
- **Thứ tự tiền:** khuyến mãi O8 áp trước (giảm tổng); thẻ là **cách thanh toán** sau cùng, trên số còn phải trả. Không dùng thẻ
  mua thẻ.
- **Kênh giá O14:** `priceChannelOf` cần hiểu `receiveMethod.kind = 'digital'`. Thẻ không theo bảng giá; giá thẻ = mệnh giá
  biến thể.
- **Xóa dữ liệu khách O11** (`services/data-rights.ts`): xóa email/tên/lời chúc người nhận trên thẻ mua bởi khách đó; giữ số
  dư, sổ, mã băm. Thêm ca vào `data-rights.mjs`.
- **Sửa đơn O7:** đơn thẻ (workflow `gift-card`) không sửa được.
- **Báo cáo O6 và chốt tiền mặt:** tách theo provider `gift-card`; chốt tiền mặt không tính thẻ.

**Danh mục dùng chung**
- Mã audit mới (nhóm `money`): `gift-card.issue`, `gift-card.block`, `gift-card.unblock`, `gift-card.extend`,
  `gift-card.adjust`, `gift-card.batch-create`, `gift-card.batch-import`, `gift-card.activate`.
- Alert dò mã → thêm mã alert đủ 4 chỗ.
- Mẫu email `customer.gift-card` → thêm đủ chỗ, tăng số mẫu.
- Quyền `gift-card.manage`, `gift-card.adjust` → `register.ts`, `ORDERING_ACTIONS`, `admin/src/lib/permissions.ts`, App.tsx.
- Job `gift-card-expiry` → `jobs/catalog.ts`, cron, heartbeat, nhãn `ops.job.*`.

**Gate:** bỏ "`check:ordering` 2 lượt" trong kế hoạch, dùng gate gọn bên dưới.


## Đã có (dùng lại)

- **Thanh toán:**
  - registry (`registerProductType`, `registerPaymentProvider`, `registerFulfillmentProvider`);
  - `PaymentProvider` (`contracts/payment.ts`);
  - `services/refund.ts`;
  - `admin-orders.refundHeld` — hoàn mọi payment còn giữ khi hủy/từ chối/hết hạn;
  - workflow `domain/workflow/definitions.ts`.
- **Bảo mật:** `domain/hashing.ts`, `domain/token-cipher.ts`, `encryptionKey` cho HMAC mã.
- **Chặn đoán mã:** `controllers/storefront-guard.ts`; xem `controllers/storefront.ts` `quote` và `controllers/cart.ts` `patch`.
- **Báo cáo:** `services/reports.ts`, `cash-closing.ts`, `order-export.ts`, `domain/csv.ts` (BOM, chống công thức).
- **Admin:** menu `admin/src/pages/App.tsx`; bản dịch `translations/o9.ts` nối vào `lib/i18n.ts` (chỉ `??`) và `admin/src/index.ts`;
  thêm thư mục trang vào `O3_DIRS`.

## Những điều đã chứng minh (không đọc lại source để cãi)

**DB và content type**
- Strapi 5.51.1 không tạo unique index cho `unique: true` → constraint, index, CHECK làm bằng migration plugin.
- Tên bảng plugin số ít (`plugins_ordering_<content-type>`); bảng nối relation là `plugins_ordering_<a>_<field>_lnk`.
- Đổi content type thì `pnpm run build:ordering` **trước**, rồi `ORDERING_ENABLED=true pnpm exec strapi ts:generate-types`. Không
  build trước thì types **mất** field mới; kiểm `git diff types/`.

**Transaction và SQL**
- `strapi.db.transaction` lồng nhau dùng lại transaction ngoài; `onCommit` chạy sau commit ngoài cùng.
- knex/`db.raw` có thể trả JSON dạng **chuỗi** — parse khi đọc qua raw SQL.
- Giữ chỗ hay trừ số dư có giới hạn: dùng một câu SQL có điều kiện (`UPDATE … WHERE balance >= n`, `INSERT … ON CONFLICT … WHERE`)
  hoặc `FOR UPDATE` theo thứ tự id cố định. Không đọc rồi ghi ngoài khóa.
- Test tranh chấp 2 process có barrier như `scripts/ordering/promotion-race.mjs`.

**Kiểm tra mà root không làm**
- `pnpm run typecheck` ở root **không** kiểm server lẫn admin của plugin:
  - lỗi server chỉ hiện ở `pnpm run build:ordering`;
  - lỗi admin ở `pnpm run typecheck:admin`.
- Route mới phải khai trong `server/src/openapi/operations.ts`, không thì `openapi.mjs` đỏ.
- Mọi `change-log.record` mới cần mã trong `server/src/domain/audit/actions.ts`; `actions.test.ts` quét source.
- Alert mới phải thêm đủ 4 chỗ, mẫu email mới phải thêm `templates.ts` + 3 chỗ trong `template-vars.ts` + số mẫu trong
  `email-templates.mjs` (hiện 18) — danh sách file ở mục merge phía trên.

**Admin (design-system 2.2.3)**
- **Không có `Dialog.Title`** — dùng nó thì dialog crash khi mở; tiêu đề đặt thẳng trong `<Dialog.Header>`.
- `NumberInput` dùng `min`/`max`, không có `minValue`/`maxValue`.
- `Table` cần `rowCount`; `Alert` cần children.
- Trong `Modal` không dùng dropdown; `SingleSelect` ngoài Modal thì được.
- Không có ESLint plugin `react-hooks`.
- Code admin không import `server/**`; logic dùng chung đặt ở `src/plugins/ordering/shared/`.

**Báo giá, mã khách nhập, giá dòng**
- Báo giá công khai **không nhận số điện thoại** (O8). Thứ gì phụ thuộc lịch sử của một số điện thoại thì chỉ quyết lúc tạo
  đơn (có captcha) hoặc theo phiên khách OTP (O11).
- Mã do khách nhập (mã khuyến mãi, mã thẻ) đi qua bộ chặn đoán mã theo IP trong `controllers/storefront-guard.ts`. Xem cách
  `quote` (`controllers/storefront.ts`) và `patch` (`controllers/cart.ts`) dùng nó.
- Giá dòng do `productType.quoteLine` quyết; giá đã chọn theo ngữ cảnh (O14) đi vào `sellable.listPrice` qua `sellableForLine`.

**Linh tinh**
- `adminRoute(method, path, handler, ...actions)` — nhiều quyền là tham số rời, không phải mảng.
- Field tên `locale` bị Strapi i18n dành.
- `fetch().text()` bỏ BOM; kiểm CSV BOM bằng `arrayBuffer` + `TextDecoder(..., { ignoreBOM: true })`.
- Cảnh báo `pg` "client.query() when the client is already executing a query" đến từ populate của `@strapi/database` — không sửa.

## Cách làm

- Đi đúng thứ tự các bước của file kế hoạch. Mỗi bước là code → test → **một commit**; message kết thúc bằng
  `Co-Authored-By: Devin <noreply@cognition.ai>`. Ghi bảng bước → commit vào Completion record.
- Tiền và bảo mật là phần chính. Hàm thuần phải có unit test trước khi nối service; chỗ tranh chấp phải có test 2 process.
- Không log tên, số điện thoại, email, địa chỉ, mã thẻ hay mã khuyến mãi đầy đủ (chỉ 4 ký tự cuối), token, OTP.

## Quy tắc bắt buộc

- Plugin không import code app; không dùng `users-permissions`. Không sửa content type, seed hay dữ liệu Salanca.
  **Không chạy `pnpm export:cms-seed`.**
- Không thêm hay nâng dependency. Không sửa `.npmrc`, `pnpm-workspace.yaml`. Không chép code GPL — chỉ học.
- Không dùng `git stash` (stash dùng chung giữa các worktree). Muốn cất tạm thì commit WIP.
- Không in mật khẩu, token, khóa bí mật ra terminal.

## Cổng kiểm tra (gọn — chủ dự án không muốn chạy cả loạt)

**Không** chạy `check:ordering`, `check:phase3`, smoke, hay hàng chục script "cho chắc". Mỗi bước chỉ chạy phần nó đụng tới.
Cuối phase chạy **một lần**:

```bash
export ORDERING_TEST_DATABASE=salanca_ordering_o9
pnpm run lint && pnpm run typecheck && pnpm run typecheck:admin
pnpm exec vitest run src/plugins/ordering
pnpm run build:ordering
node scripts/ordering/gift-card-ledger.mjs gift-card-sale.mjs gift-card-redeem.mjs gift-card-race.mjs gift-card-admin.mjs gift-card-report.mjs  # mới (chạy từng file)
node scripts/ordering/<bị ảnh hưởng>.mjs   # create-order, storefront, promotions, payment-refund, reports, cash-closing, data-rights, email-templates, audit-coverage, schema
node scripts/ordering/openapi.mjs --write
ORDERING_ENABLED=true pnpm exec strapi build    # một lần, vì có màn Admin mới
```

- Lỗi ở bước nào thì sửa rồi **chỉ chạy lại bước đó**.
- Script không tự mở tab trình duyệt (harness đặt `admin.autoOpen=false`).
- Không UAT giao diện trên trình duyệt — chủ dự án tự UAT.

Ghi lệnh và kết quả thật vào Completion record của file kế hoạch (ghi "targeted gates") và một mục O9 trong
`docs/STATUS.md`. Cập nhật thêm:
- `docs/ordering-api-contract.md` (bán/dùng thẻ, lỗi `GIFT_CARD_*`);
- `docs/ordering-staff-guide.md` (bán thẻ quầy, thẻ giấy, tra/khóa/gia hạn);
- `docs/security-baseline.md` (mã chỉ lưu băm, chặn dò);
- `uat-server.mjs` (một thẻ còn số dư, một lô thẻ giấy).

## Báo cáo khi xong

Ghi ở cuối Completion record, rồi in ra terminal cùng nội dung:

- danh sách commit;
- kết quả từng lệnh gate (số thật);
- chỗ lệch kế hoạch, kèm lý do;
- việc để lại;
- conflict khi merge `feat/ordering` và cách giải;
- trạng thái push.
