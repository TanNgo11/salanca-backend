# Prompt: thực hiện Phase O11 (khách hàng, giỏ hàng, quyền dữ liệu)

Dán nguyên phần dưới vào session mới (hoặc gửi: "Đọc `D:\outsource\salanca\salanca-backend-o11\docs\plans\ordering-o11-handoff.md`
và làm theo phần dưới dấu `---`").

---

Làm việc trong **worktree** `D:\outsource\salanca\salanca-backend-o11`. Nhiệm vụ: code **Phase O11 — Khách hàng, giỏ hàng, quyền
dữ liệu cá nhân** của plugin `ordering`: hồ sơ khách + đăng nhập OTP, sổ địa chỉ, đơn của tôi + đặt lại, giỏ hàng lưu ở server,
nhắc giỏ bỏ dở, xem/xuất/xóa dữ liệu khách (Nghị định 13). Spec, kế hoạch chi tiết, đặc tả màn hình và mockup đã có; chỉ code theo
đúng các tài liệu đó.

## Bước 0: worktree, nhánh, DB riêng

Worktree đã tạo sẵn: nhánh `feat/ordering-o11` từ nhánh tích hợp `feat/ordering` (`5963f79`, gồm O1–O6, O10, O15), `.env` đã copy.
Các thư mục `salanca-backend`, `salanca-backend-o6`, `salanca-backend-o7` (O7 đang code), `salanca-backend-o10`,
`salanca-backend-o15` là của session khác — **không sửa file, không chạy lệnh hay git trong đó**.

```bash
cd /d/outsource/salanca/salanca-backend-o11
git branch --show-current && git status --short    # feat/ordering-o11, sạch
pnpm install --frozen-lockfile
export ORDERING_TEST_DATABASE=salanca_ordering_o11   # harness tự tạo DB này lần đầu
```

**DB:** mọi lệnh test dùng `salanca_ordering_o11` (UAT nếu cần: `ORDERING_TEST_DATABASE=salanca_ordering_o11_uat UAT_PORT=1354`).
**Tuyệt đối không** chạy lệnh nào nhắm DB dev `salanca_cms` hay production — kể cả `check:phase3`, `smoke:*`, `strapi develop`.
Lệnh nào đọc `DATABASE_NAME` thì đặt rõ `DATABASE_NAME=salanca_ordering_o11` (phiên O10 từng chạy nhầm vào `salanca_cms`).

**Nhánh:** khi xong và gate đạt → `git fetch origin && git merge origin/feat/ordering` (O7 có thể đã merge trước — giải conflict,
thường chỉ là các dòng cùng thêm vào routes/register/errors/menu/bản dịch/danh sách migration/`audit/actions.ts`), chạy lại gate có
chọn lọc, rồi merge `feat/ordering-o11` vào `feat/ordering` và `git push origin feat/ordering-o11 feat/ordering` (chủ dự án đã cho
phép push theo luồng này). **Không** merge vào `main`.

## Đọc trước khi code (theo thứ tự)

1. `AGENTS.md`, `PLANS.md`, `docs/STATUS.md` (mục O5, O6, O10, O15 mới nhất).
2. **`docs/phases/phase-ordering-11-customers-cart.md`** (spec, test bắt buộc, UAT).
3. **`docs/plans/ordering-o11-customers-cart.md`** (kế hoạch 8 bước: data model, API, mã lỗi, quyết định, file từng bước).
4. **`docs/plans/ordering-o11-screens.md`** (C1–C3 Admin, W1–W4 phía khách) + quy ước chung đầu `ordering-o3-screens.md` + mục "Đã
   đổi khi code" của O3/O5/O6/O10 screens. Đổi tên API thì sửa screens trong cùng commit.
5. `docs/plans/mockups/ordering-o11-customers-cart.html`; `docs/plans/ordering-reference.md` mục U11.
6. `docs/plans/ordering-core-contracts.md` mục 15 (PII), 21.4 (bằng chứng đồng ý), 21.9.
7. `docs/plans/ordering-o15-audit-log.md` mục "Đã đổi khi code O15" và `docs/plans/ordering-o10-extensibility.md` Completion record
   (webhook ra ngoài, mẫu email sửa được — O11 cắm vào cả hai).

## Thay đổi so với kế hoạch (đã biết trước khi code)

- **Migration** đặt tên `0007-o11-customers` (kế hoạch ghi `0009`; số 5 và 6 đã dùng — runner chạy theo tên).
- **O8 (khuyến mãi) và O9 (thẻ quà tặng) chưa có.** Giỏ hàng **chưa** có `promotionCode`/`giftCardCode` (bỏ khỏi schema giỏ và API
  ở O11, ghi "thêm ở O8/O9" trong Completion record). Phần ẩn danh khi xóa dữ liệu bỏ qua đánh giá (O8 chưa có bảng `order-rating`).
- **Kênh OTP:** chỉ `email` ở O11 (SMS/Zalo là O13). Thiết kế `channel` để O13 thêm được, nhưng API chỉ chấp nhận `email`.
- **Mẫu email mới** (`customer.otp`, `customer.cart-reminder`): thêm theo cách O10 làm — `TemplateCode` + nội dung mặc định trong
  `domain/notifications/templates.ts`, biến cho phép trong `domain/notifications/template-vars.ts` (để sửa được ở Admin X4).
- **Webhook ra ngoài (O10):** thêm sự kiện `customer.created`, `customer.erased` vào `domain/webhooks/events.ts` (`PUBLIC_EVENTS`),
  payload **không** có dữ liệu cá nhân (chỉ id/hash); có test trong `events.test.ts`.
- **Lịch sử thay đổi (O15):** mọi thao tác Admin mới (sửa khách, hiện SĐT đầy đủ, xuất dữ liệu, tạo/xử lý/từ chối yêu cầu xóa) ghi
  `change-log.record` với mã mới — **thêm mã vào `server/src/domain/audit/actions.ts`** (nhóm `access` cho hiện SĐT/xuất, nhóm mới
  hoặc `config` cho yêu cầu dữ liệu — chọn và ghi lý do). Test `domain/audit/actions.test.ts` quét source sẽ đỏ nếu thiếu.
- **Job mới** (`cart-expiry`, `cart-reminder`, `data-request-waiting`): thêm vào `server/src/jobs/catalog.ts`, cron trong
  `config/index.ts` (`jobs.*Cron`, `heartbeatMinutes`), nhãn `ops.job.<name>` trong bản dịch. Retention O6: xóa `customer-otp` hết hạn,
  `customer-session` thu hồi/hết hạn, giỏ `expired` quá 30 ngày (mở rộng `jobs/retention.ts`, có test trong `retention.mjs`).

## Đã có từ O0–O6, O10, O15 (dùng lại, không làm lại)

- Đặt đơn: `services/order.ts` (`prepareOrder` dùng chung quote/create, `createOrder` idempotent `order.create`), `services/storefront.ts`
  (`aggregateByToken`, `lookup` so sha256 hằng thời gian), `domain/storefront/parse.ts`, `controllers/storefront.ts` (`verifyCaptcha`),
  rate limit `controllers/storefront-guard.ts` (429 `RATE_LIMITED`, bucket theo IP), CORS header `X-Order-Token` (thêm
  `X-Customer-Token`, `X-Cart-Token` cùng chỗ).
- Liên hệ: `order.contactSnapshot { name, phone (E.164), email? }`, `shared/contact/phone.ts` (`normalizeVietnamesePhone`), địa chỉ O5
  (`domain/contact/address.ts`, danh mục xã/phường), `token-cipher`, `hashing`, `pii.ts` (`maskPayload`).
- Thông báo: `services/notification.ts` (`deliver` dedupe), outbox `availableAt` để gửi trễ, mẫu email O10 (sửa được, render an toàn).
- Scope chi nhánh `services/scope.ts`; báo cáo/chốt tiền O6 (ẩn danh **không** được đổi số liệu — test trước/sau).
- Admin: menu con "Bán hàng" (`admin/src/pages/App.tsx`), `lib/permissions.ts` (`useRBAC` mảng hằng), bản dịch `translations/o11.ts`
  dạng `[vi, en]` merge trong `lib/i18n.ts` + `index.ts`, thêm `pages/<Trang>` vào `O3_DIRS` của `translations/o3.test.ts`.
- Harness: `scripts/ordering/_harness.mjs` (`withApp`, `seedBranches`, `seedMenu`, `seedAdminHttpStaff` — thêm quyền mới vào
  `ORDERING_ACTIONS`), thêm script mới vào `run-all.mjs`.

## Những điều đã chứng minh (không đọc lại source để cãi)

- Strapi 5.51.1 không tạo unique index cho `unique: true` → constraint/index bằng migration plugin. Tên bảng plugin số ít
  (`plugins_ordering_<content-type>`).
- `strapi.db.transaction` lồng nhau dùng lại transaction ngoài; `onCommit` chạy sau commit ngoài cùng.
- knex/`db.raw` có thể trả cột JSON dạng **chuỗi** — parse khi đọc qua raw SQL.
- Code admin không import `server/**` hay `@strapi/utils`; logic dùng chung ở `src/plugins/ordering/shared/`.
- Trong `Modal` không dùng `SimpleMenu`/dropdown mới (đã treo trang ở O3); `SingleSelect` ngoài Modal thì được.
- Field tên `locale` bị Strapi dành cho i18n. Không có ESLint plugin `react-hooks`.
- `adminRoute(method, path, handler, ...actions)` — nhiều quyền là tham số rời, không phải mảng.
- Test nhiều process phải có barrier (xem `outbox-two-process.mjs`).
- Cảnh báo `pg` "client.query() when the client is already executing a query" đến từ populate của `@strapi/database` — không sửa.

## Cách làm

- Đi đúng thứ tự 8 bước của `ordering-o11-customers-cart.md`. Mỗi bước: code → test → một commit trên `feat/ordering-o11` (kết thúc
  bằng dòng `Co-Authored-By` theo quy ước repo). Ghi bảng bước → commit vào Completion record.
- Bảo mật là phần chính: viết `domain/customers/otp.ts` + test (sinh mã `crypto.randomInt`, HMAC với `encryptionKey`, so hằng thời
  gian, hạn, số lần thử) trước khi nối API; OTP/tra cứu không bao giờ lộ "có tồn tại hay không"; token phiên/OTP chỉ lưu hash.
- Ẩn danh (bước 6) chạm sổ sách: test so báo cáo O6 + chốt tiền trước/sau bằng nhau trước khi coi là xong.
- Không log tên, số điện thoại, email, địa chỉ khách, mã OTP, token.

## Quy tắc bắt buộc

- Plugin không import code app; không dùng `users-permissions`. Không sửa content type, seed hay dữ liệu Salanca.
  **Không chạy `pnpm export:cms-seed`.**
- Không thêm dependency khi chưa hỏi. Không chép code GPL — chỉ học.
- Đổi schema thì sinh lại `types/generated/contentTypes.d.ts` với `ORDERING_ENABLED=true pnpm exec strapi ts:generate-types`.
- Không dùng `git stash` trần. Không in mật khẩu/token/OTP ra chat.

## Cổng kiểm tra (có chọn lọc — quy ước chủ dự án từ O7)

**Không** chạy lại toàn bộ gate (`check:ordering` ×2, `check:phase3` tắt/bật, bộ smoke). Chạy:

```bash
export ORDERING_TEST_DATABASE=salanca_ordering_o11
pnpm run lint && pnpm run typecheck
pnpm exec vitest run src/plugins/ordering          # unit test plugin + test dịch admin + audit catalog
pnpm run build:ordering
node scripts/ordering/<mỗi script mới của O11>.mjs  # customers, customer-auth, cart, cart-checkout, data-rights
node scripts/ordering/<script cũ bị ảnh hưởng>.mjs  # ít nhất: schema, storefront, create-order, idempotency, lookup-drafts,
                                                    # notifications, reports, cash-closing, retention, webhooks-out,
                                                    # email-templates, audit-coverage
ORDERING_ENABLED=true pnpm exec strapi build        # có màn Admin mới
```

Lỗi ở bước nào thì sửa rồi **chỉ chạy lại bước đó**, không chạy lại từ đầu. Không UAT giao diện trên Chrome — chủ dự án tự UAT sau.
Ghi lệnh và kết quả thật vào Completion record của `ordering-o11-customers-cart.md` (ghi rõ "targeted gates") và một mục O11 trong
`docs/STATUS.md`. Cập nhật `docs/ordering-api-contract.md` (auth, giỏ, `/me`), `docs/ordering-staff-guide.md` (tra khách, xử lý yêu
cầu xóa), `docs/security-baseline.md` (OTP, phiên, dữ liệu cá nhân), `docs/ordering-integrations.md` (sự kiện `customer.*`), mục "Đã
đổi khi code O11" trong `ordering-o11-screens.md`.

## Báo cáo khi xong

Danh sách commit, kết quả từng lệnh gate (số thật), chỗ lệch kế hoạch/đặc tả (kèm lý do), việc để lại cho O8/O9/O13 (mã khuyến mãi,
thẻ quà tặng trong giỏ, OTP SMS/Zalo), conflict khi merge `feat/ordering` (nếu có) và cách giải, trạng thái push.
