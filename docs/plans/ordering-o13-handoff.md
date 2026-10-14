# Prompt: thực hiện Phase O13 (provider: MoMo, VNPay, Ahamove, Zalo ZNS, SMS — build adapter trước)

Gửi cho agent: "Đọc `C:\Users\tan_ngo\orca\workspaces\salanca-backend\ordering-o13\docs\plans\ordering-o13-handoff.md` và làm theo phần dưới dấu `---`".

---

Làm việc trong **worktree** `C:\Users\tan_ngo\orca\workspaces\salanca-backend\ordering-o13`. Đây là nhánh git `TanNgo11/ordering-o13` (Orca tạo). Khi đẩy lên origin dùng tên
`feat/ordering-o13`: `git push origin HEAD:feat/ordering-o13`.

Nhiệm vụ: code **Phase O13 — provider: MoMo, VNPay, Ahamove, Zalo ZNS, SMS — build adapter trước** của plugin `ordering` (Strapi 5.51.1, local plugin `src/plugins/ordering`). Spec, kế
hoạch chi tiết và đặc tả màn hình đã có; code theo đúng các tài liệu đó, cộng phần "Thay đổi so với kế hoạch" bên dưới.

Làm **tự chủ tới hết**: không có người trả lời câu hỏi giữa chừng. Gặp chỗ mơ hồ thì chọn phương án an toàn, đơn giản, và ghi
lý do vào Completion record.

## Bước 0: môi trường

Worktree tách từ `origin/feat/ordering` tại `d292229` (gồm O1–O8, O10, O11, O14, O15 và các bản sửa sau review), `.env` đã
copy.

Đang có 2 agent khác làm song song: O9 (thẻ quà tặng) ở `ordering-o9` và O12 (nhà hàng) ở `ordering-o12`. Mọi thư mục khác dưới `D:\outsource\salanca\` và
`C:\Users\tan_ngo\orca\workspaces\salanca-backend\` là của session khác — **không sửa file, không chạy lệnh hay git trong đó**.

```bash
cd "C:/Users/tan_ngo/orca/workspaces/salanca-backend/ordering-o13"
git status --short                                   # sạch
pnpm install --frozen-lockfile                       # repo có .npmrc trỏ npm công khai; KHÔNG sửa .npmrc, pnpm-workspace.yaml
pnpm run build:ordering                              # bắt buộc trước script / ts:generate-types
export ORDERING_TEST_DATABASE=salanca_ordering_o13   # harness tự tạo DB này lần đầu
```

**DB:**
- Mọi lệnh test dùng `salanca_ordering_o13`. UAT seed nếu cần: `ORDERING_TEST_DATABASE=salanca_ordering_o13_uat UAT_PORT=1359`.
- **Tuyệt đối không** chạy lệnh nào nhắm DB dev `salanca_cms` hay production — kể cả `check:phase3`, `smoke:*`, `strapi develop`.
- Lệnh nào đọc `DATABASE_NAME` thì đặt rõ `DATABASE_NAME=salanca_ordering_o13`.

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
3. `git push origin HEAD:feat/ordering-o13` rồi `git push origin HEAD:feat/ordering`. Nếu push `feat/ordering` bị từ chối vì
   phase khác vừa push: fetch, merge lại, gate gọn, push lại.
4. **Không** merge vào `main`, không force push.

## Đọc trước khi code (theo thứ tự)

1. `AGENTS.md`, `PLANS.md`, `docs/STATUS.md` (các mục 2026-10-13).
2. **`docs/plans/ordering-decisions-2026-10-13.md`** — quyết định mặc định của chủ dự án; **thắng** mọi chỗ "chờ quyết định" trong
   spec/plan.
3. **`docs/phases/phase-ordering-13-providers.md`** (spec, test bắt buộc).
4. **`docs/plans/ordering-o13-providers.md`** (kế hoạch 8 bước, data model, API, quyết định).
5. **`docs/plans/ordering-o13-screens.md`** + quy ước đầu `docs/plans/ordering-o3-screens.md`.
6. Code SePay O4 làm mẫu: `server/src/providers/sepay/`, `services/payment-review.ts`, `services/payment-matching.ts`,
   `jobs/` reconciliation; thông báo `services/notification.ts`, `services/notification-template.ts` (O10);
   OTP `services/customer-auth.ts` (O11); giao `services/delivery-assignment.ts` (O5).


## Thay đổi so với kế hoạch (đã biết trước khi code)

**Không có tài khoản sandbox — build adapter trước** (quyết định 2026-10-13, thay dòng "thiếu sandbox thì bỏ provider").
- Bước 1 vẫn bắt buộc: đọc tài liệu chính thức hiện hành của từng hãng, ghi `docs/providers/<code>.md`:
  - URL tài liệu, phiên bản API, ngày đọc;
  - thuật toán chữ ký, trường bắt buộc, mã kết quả;
  - IP nguồn, giới hạn tần suất, URL sandbox.
- Test bằng **server giả lập** trong `scripts/ordering/` (HTTP server nội bộ), trả fixture lấy **nguyên văn từ ví dụ trong tài
  liệu** — kể cả chữ ký mẫu nếu tài liệu có. Tài liệu không có ví dụ chữ ký thì tự ký bằng khóa test và ghi rõ "chưa đối chiếu
  sandbox".
- Mỗi provider **tắt mặc định** (`providers.<code>.enabled = false`, bí mật chỉ từ env). Trang Admin provider hiện trạng thái
  "Chưa kiểm sandbox".
- Không đọc được tài liệu một hãng (mạng chặn, tài liệu đóng): làm phần còn lại, ghi provider đó là "chưa làm" kèm lý do.
  **Không bịa** endpoint hay chữ ký.

**Phạm vi**
- Gồm MoMo, VNPay, Ahamove, Zalo ZNS, SMS **eSMS.vn**.
- **Không làm GHN.** Giữ interface để thêm sau.
- Phí giao: cấu hình `feeSource: 'zone' | 'carrier'`, mặc định `'zone'`.

**Migration và giới hạn**
- Đặt tên `0012-o13-providers`. Kế hoạch ghi `0011`, nhưng O9 dùng `0010`, O12 dùng `0011`.
- Giới hạn gửi `notifications.dailyLimit = 2000`. Ước tính phí theo tin là cấu hình.

**Đụng phase khác**
- **OTP O11:** thêm kênh `sms` (và `zalo` khi bật) cho OTP. `email` vẫn mặc định. Giới hạn OTP hiện có áp cho mọi kênh. Thêm ca
  vào `customer-auth.mjs`.
- **Ví (thanh toán):**
  - đi chung khung SePay: event thô, khớp mã, capture một lần, lệch tiền → hàng duyệt O4, return URL chỉ để hiển thị;
  - hoàn qua API refund của hãng;
  - job `wallet-status-check` (mỗi 2 phút) + đối soát hằng ngày — khóa job, heartbeat.
- **Webhook vào:**
  - route công khai riêng từng hãng, kiểm chữ ký **trước** khi đọc dữ liệu;
  - so thời gian hằng số;
  - IP allowlist cấu hình được (hãng có công bố thì làm);
  - replay idempotent theo mã giao dịch hãng.
- **Hãng giao:**
  - `FulfillmentProvider` `ahamove`;
  - "Gọi xe" do nhân viên bấm, idempotent (2 lần bấm → 1 chuyến);
  - webhook trạng thái → `delivery-assignment`.
- **Thông báo:**
  - rule kênh theo mẫu, dự phòng khi kênh lỗi, dedupe như O3;
  - mẫu email O10 không đổi;
  - map biến ZNS theo `templateId`.
  - Không gửi số điện thoại hay nội dung tin vào log.

**Danh mục dùng chung**
- Mã audit: `provider.config`, `notification-channel.update`, `carrier.book`, `carrier.cancel`.
- Alert khi provider lỗi liên tiếp: dùng mã sẵn có `webhook-failing` nếu hợp, nếu không thì thêm mã mới đủ 4 chỗ.

**Gate:** bỏ "`check:ordering` 2 lượt" trong kế hoạch, dùng gate gọn bên dưới. Không có UAT sandbox trong lần này.


## Đã có (dùng lại)

- **SePay O4:**
  - provider + webhook (`server/src/providers/sepay/`);
  - `payment-event` lưu thô;
  - khớp `services/payment-matching.ts`;
  - hàng duyệt `services/payment-review.ts`;
  - đối soát và alert `webhook-failing`.
- **Registry:** `registerPaymentProvider`, `registerFulfillmentProvider`, `registerNotificationProvider` (`register.ts`, `services/registry.ts`).
- **Gọi HTTP ra ngoài an toàn (O10):** `domain/webhooks/url-guard.ts` (SSRF, ghim IP), `postOnce` (timeout cứng) — dùng lại cho
  gọi API hãng.
- **Admin:** `translations/o13.ts` nối vào `lib/i18n.ts` (chỉ `??`) và `admin/src/index.ts`; thêm thư mục trang vào `O3_DIRS`.

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
export ORDERING_TEST_DATABASE=salanca_ordering_o13
pnpm run lint && pnpm run typecheck && pnpm run typecheck:admin
pnpm exec vitest run src/plugins/ordering
pnpm run build:ordering
node scripts/ordering/momo.mjs vnpay.mjs wallet-status.mjs ahamove.mjs zalo-zns.mjs sms.mjs   # mới, server giả lập (chạy từng file)
node scripts/ordering/<bị ảnh hưởng>.mjs   # sepay-webhook, sepay-refund, payment-refund, delivery-assignment, notifications, customer-auth, email-templates, audit-coverage, schema
node scripts/ordering/openapi.mjs --write
ORDERING_ENABLED=true pnpm exec strapi build    # một lần, vì có màn Admin mới
```

- Lỗi ở bước nào thì sửa rồi **chỉ chạy lại bước đó**.
- Script không tự mở tab trình duyệt (harness đặt `admin.autoOpen=false`).
- Không UAT giao diện trên trình duyệt — chủ dự án tự UAT.

Ghi lệnh và kết quả thật vào Completion record của file kế hoạch (ghi "targeted gates") và một mục O13 trong
`docs/STATUS.md`. Cập nhật thêm:
- `docs/ordering-integrations.md` (cách viết provider);
- `docs/providers/*.md`;
- `docs/security-baseline.md` (chữ ký webhook, bí mật chỉ env, SSRF);
- `docs/ordering-ops-runbook.md` (bật provider sau UAT sandbox);
- `docs/ordering-staff-guide.md` (Gọi xe).

## Báo cáo khi xong

Ghi ở cuối Completion record, rồi in ra terminal cùng nội dung:

- danh sách commit;
- kết quả từng lệnh gate (số thật);
- chỗ lệch kế hoạch, kèm lý do;
- việc để lại;
- conflict khi merge `feat/ordering` và cách giải;
- trạng thái push.
