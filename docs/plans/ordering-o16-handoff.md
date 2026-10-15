# Prompt: thực hiện Phase O16 (tích điểm và hạng thành viên)

Gửi cho agent: "Đọc `docs/plans/ordering-o16-handoff.md` trong worktree O16 của bạn và làm theo phần dưới dấu `---`".

---

Làm việc trong **worktree riêng** `C:\Users\tan_ngo\orca\workspaces\salanca-backend\ordering-o16` (nhánh git `TanNgo11/ordering-o16`,
tách từ `origin/feat/ordering`). Khi đẩy lên origin dùng tên `feat/ordering-o16`: `git push origin HEAD:feat/ordering-o16`.

Nhiệm vụ: code **Phase O16 — tích điểm và hạng thành viên** của plugin `ordering` (Strapi 5.51.1, local plugin
`src/plugins/ordering`). Spec, kế hoạch 7 bước, mô hình dữ liệu, API và đặc tả màn hình **đã đối chiếu với code ngày 2026-10-15**; code
đúng theo kế hoạch đó, cộng phần "Đã biết trước khi code" bên dưới.

Làm **tự chủ tới hết**: không có người trả lời câu hỏi giữa chừng. Gặp chỗ mơ hồ thì chọn phương án an toàn, đơn giản và ghi lý do
vào Completion record. Chỉ dừng hỏi khi cần đổi tham số chương trình đã chốt hoặc phải sửa thứ nằm ngoài phase.

## Bước 0: môi trường

Worktree phải tách từ `origin/feat/ordering` **đã chứa** commit của file kế hoạch này (`docs/plans/ordering-o16-loyalty.md` và
file handoff này). Nếu `git log` không thấy chúng, dừng lại báo — không tự tạo lại kế hoạch.

```bash
cd "C:/Users/tan_ngo/orca/workspaces/salanca-backend/ordering-o16"
git status --short                                   # sạch
test -f docs/plans/ordering-o16-loyalty.md           # phải có
pnpm install --frozen-lockfile                       # KHÔNG sửa .npmrc, pnpm-workspace.yaml
pnpm run build:ordering                              # bắt buộc trước script / ts:generate-types
export ORDERING_TEST_DATABASE=salanca_ordering_o16   # harness tự tạo DB này lần đầu
```

**DB:** mọi lệnh test dùng `salanca_ordering_o16`. **Tuyệt đối không** nhắm DB dev `salanca_cms`, `salanca_ordering_uat` hay production
(kể cả `check:phase3`, `smoke:*`, `strapi develop`). Lệnh nào đọc `DATABASE_NAME` thì đặt rõ `salanca_ordering_o16`.

Các thư mục khác dưới `D:\outsource\salanca\` và `C:\Users\tan_ngo\orca\workspaces\salanca-backend\` là của session khác — **không
sửa file, không chạy lệnh hay git trong đó**. Riêng thư mục `artifacts/` (nếu thấy trong repo) là của agent khác, không đụng, không commit.

**Nhánh, merge, push — khi xong và gate đạt:**

1. `git fetch origin && git merge origin/feat/ordering`; giải conflict bằng cách lấy **cả hai** bên. File hay conflict: routes,
   `register.ts`, errors, `config/index.ts`, `App.tsx`, translations, chuỗi `messagesOf` trong `admin/src/lib/i18n.ts` (**chỉ dùng `??`**,
   trộn `||` thì esbuild chết), `translations/o3.test.ts`, `migrations/index.ts`, `persisted-tables.ts`, `domain/audit/actions.ts`,
   bộ 4 chỗ của alert (`alert-codes`, `alert-rules`, Settings `ALERT_CODES`, `translations/o6.ts`), bộ mẫu email (`TEMPLATE_CODES`/`_allCodes`/
   `TEMPLATE_NAMES` + số mẫu trong `scripts/ordering/email-templates.mjs`), `openapi/operations.ts`, `run-all.mjs`, `schema.mjs`,
   `ORDERING_ACTIONS` trong `_harness.mjs`, STATUS.
2. `pnpm run build:ordering`, chạy lại gate gọn phần đụng conflict.
3. `git push origin HEAD:feat/ordering-o16` rồi `git push origin HEAD:feat/ordering`. Bị từ chối vì phase khác vừa push: fetch, merge, gate
   gọn, push lại.
4. **Không** merge vào `main`, không force push.

## Đọc trước khi code (theo thứ tự)

1. `AGENTS.md`, `PLANS.md`, `docs/STATUS.md` (các mục 2026-10-14 và 2026-10-15).
2. **`docs/plans/ordering-decisions-2026-10-13.md`** — mục O16; **thắng** mọi chỗ "chờ quyết định" trong spec/plan.
3. **`docs/plans/ordering-o16-loyalty.md`** — kế hoạch chính (Decisions, Invariants, Data model, API, 7 bước, màn hình Y1–Y4).
4. `docs/phases/phase-ordering-16-loyalty.md` (spec, test bắt buộc, UAT) và `docs/plans/mockups/ordering-o16-loyalty.html`.
5. Tiền lệ gần nhất: `docs/plans/ordering-o9-gift-cards.md` + Completion record (sổ cái, job hết hạn, quyền, báo cáo), và
   `scripts/ordering/gift-card-ledger.mjs`, `promotion-race.mjs`, `core-sales-fixes.mjs` (test tranh chấp có barrier).
6. Completion record O8 (khuyến mãi), O11 (khách, OTP, giỏ), O14 (nhóm khách).

## Đã biết trước khi code

**Số đúng theo quyết định 2026-10-13 (bản nháp cũ ghi sai):** 1 điểm / 10.000đ; **1 điểm = 100đ**; tối thiểu 50 điểm/lần; tối đa 50% tiền món;
hạn 12 tháng; nhắc trước 14 ngày; ân hạn 30 ngày; trần 2.000 điểm/khách/ngày; hạng Thành viên 0đ ×1.0 / Bạc 2.000.000đ ×1.2 / Vàng
5.000.000đ ×1.5. Chương trình **mặc định tắt**.

**Migration**
- Tên `0013-o16-loyalty` (`0012` là O13). Strapi 5.51.1 không tạo unique index cho `unique: true`; Strapi lưu relation ở bảng `*_lnk` nên
  không đặt được unique/partial index trên relation. Vì vậy bảng sổ và bảng lô lưu `customerId`, `orderId`, `lotId` là **cột integer thường**
  (tiền lệ `customer-group-member`); unique, CHECK, partial index làm bằng migration.
- Đổi content type thì `pnpm run build:ordering` **trước**, rồi `ORDERING_ENABLED=true pnpm exec strapi ts:generate-types`; kiểm `git diff types/`.

**Tiền (phần dễ sai nhất — đọc kỹ)**
- Sau bản sửa core-sales (2026-10-14/15): `order.totalAmount` là snapshot lúc đặt; số còn phải trả = `totalAmount − order.canceledAmount`
  (`domain/payable.ts`: `payableTotal`, `amountOwed`). Mọi chỗ tính "còn phải trả" dùng các hàm này, **không** tự trừ `totalAmount − captured`.
- Dòng sau khi sửa đơn (O7) được định giá cho `pricedQuantity` đơn vị; chia tiền theo dòng dùng `domain/refund-amount.ts`
  (`lineRemovalAmount`, `liveLineAmount`), không tự chia theo `quantity`.
- **Cơ sở tích điểm = Σ `(baseAmount + discountAmount)` của dòng còn sống**, không phải `lineTotalAmount` (đã gồm phí và làm tròn).
- Giảm giá điểm là adjustment `discount` số tiền cố định, `target: order`, `sourceRef: 'loyalty'`, áp sau khuyến mãi (`services/order.ts`
  `prepareOrder`). Order-edit mang theo adjustment số tiền cố định → phải thu về trần và trả lại điểm chênh (bước 4).
- `order.completed` là trạng thái cấp đơn, đặt trong `order.recomputeProjection`. `line-cancel` và đường hoàn tiền gọi nó **mà không**
  enqueue `order.transitioned`, nên tích điểm cần cả consumer lẫn job quét `loyalty-earn-sweep` (unique `earn` giữ idempotent).

**Khóa (bắt buộc đúng thứ tự — vừa sửa 3 lỗi deadlock/race vì chuyện này)**
- `repo.lockOrder(trx, orderId)` (advisory lock theo đơn) lấy **trước** mọi khóa hàng; `lockGroup/lockLine/lockPayment` tự lấy nó.
- Thứ tự: **mutex đơn → `lockCustomer` (`services/customer-lock.ts`) → hàng lô**. `earn`, `release`, `reverse` lấy mutex đơn trước.
  Job hết hạn/hạng chỉ khóa khách. Không bao giờ giữ khóa khách rồi xin mutex của một đơn đã tồn tại.
- Test tranh chấp phải có barrier và **phải đỏ khi tắt khóa** (xem cách `core-sales-fixes.mjs` mục 15–17 làm và kiểm).

**Ràng buộc code khác**
- Mọi `change-log.record` mới cần mã trong `domain/audit/actions.ts` (`actions.test.ts` quét source).
- Route mới phải khai trong `openapi/operations.ts`; sau đó `pnpm run ordering:openapi` để sinh lại `docs/ordering-admin-openapi.json` (`openapi.mjs`
  đỏ nếu lệch).
- Job mới: `jobs/catalog.ts`, khóa cron + lease trong `config/index.ts`, heartbeat, nhãn `ops.job.*`. Alert mới (nếu có) đủ 4 chỗ; mẫu email
  mới đủ `templates.ts` + 3 chỗ `template-vars.ts` + số mẫu trong `email-templates.mjs`.
- `customer-group.refreshAuto` chỉ động tới nhóm có rule `auto`; nhóm gắn hạng để `auto = null` và do tier job quản lý (`source:'auto'`).
- Hạng và điều kiện khuyến mãi dùng nhóm O14; khách chưa đăng nhập không có nhóm. Báo giá công khai **không** nhận số điện thoại: mọi thứ
  của điểm chỉ theo phiên khách (`X-Customer-Token`), `customer.status = 'active'` mới tích/dùng.
- Xóa dữ liệu khách (`services/data-rights.ts`, `/me/erase`, `/me/data-export`): ghi `forfeit`, đưa lô về 0, thêm sổ điểm vào xuất dữ liệu; thêm ca vào `data-rights.mjs`.
- Số điện thoại, email, tên, địa chỉ, token, OTP **không** vào log, payload sổ hay webhook.

**Kiểm tra mà root không làm**
- `pnpm run typecheck` ở root không kiểm server lẫn admin của plugin: lỗi server chỉ hiện ở `pnpm run build:ordering`, lỗi admin ở `pnpm run typecheck:admin`.
- knex/`db.raw` có thể trả JSON dạng chuỗi — parse khi đọc qua raw SQL. Trừ/giữ có giới hạn dùng một câu SQL có điều kiện hoặc
  `FOR UPDATE` theo thứ tự id cố định; không đọc rồi ghi ngoài khóa.
- File `.ts`/`.mjs` trong repo lẫn CRLF và LF: giữ nguyên kiểu xuống dòng của file khi sửa (không đổi cả file).
- Cảnh báo `pg` "client.query() when the client is already executing a query" đến từ populate của `@strapi/database` — không sửa.

**Admin (design-system 2.2.3)**
- **Không có `Dialog.Title`** (dialog crash) — tiêu đề đặt trong `<Dialog.Header>`. `NumberInput` dùng `min`/`max`. `Table` cần `rowCount`;
  `Alert` cần children. Trong `Modal` không dùng dropdown. Không có ESLint plugin `react-hooks`.
- Code admin không import `server/**`; logic dùng chung đặt ở `src/plugins/ordering/shared/`. Bản dịch `translations/o16.ts` nối vào
  `lib/i18n.ts` (chỉ `??`) và `admin/src/index.ts`; thêm thư mục trang vào `O3_DIRS`.

## Cách làm

- Đi đúng thứ tự 7 bước trong kế hoạch. Mỗi bước là code → test → **một commit** (migration là một commit riêng); message kết thúc bằng
  `Co-Authored-By: <tên model của bạn> <noreply@...>`. Ghi bảng bước → commit vào Completion record của kế hoạch.
- Hàm thuần có unit test **trước** khi nối service. Chỗ tranh chấp có test hai luồng/hai process có barrier.
- Bản sửa lỗi phát hiện giữa chừng ở code cũ: sửa nhỏ + test hồi quy + ghi vào Completion record; đừng mở rộng phạm vi.

## Quy tắc bắt buộc

- Plugin không import code app; không dùng `users-permissions`. Không sửa content type, seed hay dữ liệu Salanca. **Không chạy `pnpm export:cms-seed`.**
- Không thêm hay nâng dependency. Không sửa `.npmrc`, `pnpm-workspace.yaml`. Không chép code GPL — chỉ học.
- Không dùng `git stash` (dùng chung giữa các worktree); muốn cất tạm thì commit WIP. Không in mật khẩu, token, khóa bí mật ra terminal.
- Không làm phần OW (màn hình khách ở repo web), OP, tip. Không mở chương trình cho khách thật (`enabled` mặc định false).

## Cổng kiểm tra (gọn — chủ dự án không muốn chạy cả loạt)

**Không** chạy `check:ordering`, `check:phase3`, smoke hay hàng chục script "cho chắc". Mỗi bước chỉ chạy phần nó đụng tới. Cuối phase
chạy **một lần**:

```bash
export ORDERING_TEST_DATABASE=salanca_ordering_o16
pnpm run lint && pnpm run typecheck && pnpm run typecheck:admin
pnpm exec vitest run src/plugins/ordering config
pnpm run build:ordering
node scripts/ordering/loyalty-earn.mjs      # mới — chạy từng file: loyalty-earn, loyalty-redeem, loyalty-race, loyalty-expiry, loyalty-tiers, loyalty-admin
node scripts/ordering/<bị ảnh hưởng>.mjs    # create-order, storefront, cart-checkout, cart-promotion, order-edit, payment-refund, sepay-refund,
                                            # core-sales-fixes, customers, customer-auth, data-rights, reports, price-lists,
                                            # promotions, promotion-money, promotion-race, promotions-admin, email-templates, audit-coverage, schema
pnpm run ordering:openapi && node scripts/ordering/openapi.mjs
ORDERING_ENABLED=true pnpm exec strapi build    # một lần, vì có màn Admin mới
```

Thêm 6 script `loyalty-*` vào `scripts/ordering/run-all.mjs`. Không UAT trình duyệt bằng AI; Completion record ghi rõ phần UAT thủ công còn mở
(danh sách ở spec) và các quyết định chủ dự án còn chặn mở cho khách thật (điều khoản chương trình, hạch toán điểm lưu hành).

## Khi xong

Cập nhật: Completion record + trạng thái trong kế hoạch, spec phase, `docs/STATUS.md` (mục mới đầu file), `docs/plans/ordering-roadmap.md`
(dòng O16), staff guide, `ordering-api-contract.md`, `ordering-integrations.md`, contracts. Báo cáo cuối: lệnh đã chạy + kết quả, commit,
việc còn mở, và mọi chỗ bạn lệch kế hoạch (kèm lý do).
