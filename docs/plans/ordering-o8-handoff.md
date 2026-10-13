# Prompt: thực hiện Phase O8 (khuyến mãi và đánh giá đơn)

Dán nguyên phần dưới vào session mới (hoặc gửi: "Đọc `D:\outsource\salanca\salanca-backend-o8\docs\plans\ordering-o8-handoff.md`
và làm theo phần dưới dấu `---`").

---

Làm việc trong **worktree** `D:\outsource\salanca\salanca-backend-o8`. Nhiệm vụ: code **Phase O8 — Khuyến mãi và đánh giá đơn**
của plugin `ordering`: mã giảm giá (một mã / sinh hàng loạt), khuyến mãi tự động, miễn phí giao, giảm theo món/danh mục, giới hạn
lượt (tổng, mỗi mã, mỗi khách), đơn đầu tiên; đánh giá đơn 1–5 sao + nhãn + bình luận, email mời đánh giá, alert `low-rating`,
màn Admin khuyến mãi và đánh giá, báo cáo giảm giá. Spec, kế hoạch chi tiết, đặc tả màn hình và mockup đã có; chỉ code theo đúng
các tài liệu đó.

## Bước 0: worktree, nhánh, DB riêng

Worktree đã tạo sẵn: nhánh `feat/ordering-o8` từ nhánh tích hợp `feat/ordering` (`342ff5e`, gồm O1–O7, O10, O15), `.env` đã copy.
Các thư mục `salanca-backend`, `salanca-backend-docs`, `salanca-backend-o6`, `salanca-backend-o7`, `salanca-backend-o10`,
`salanca-backend-o11` (O11 đang code song song), `salanca-backend-o15` là của session khác — **không sửa file, không chạy lệnh hay
git trong đó**.

```bash
cd /d/outsource/salanca/salanca-backend-o8
git branch --show-current && git status --short    # feat/ordering-o8, sạch
pnpm install --frozen-lockfile
pnpm run build:ordering                            # bắt buộc trước script/ts:generate-types (đọc dist của plugin)
export ORDERING_TEST_DATABASE=salanca_ordering_o8  # harness tự tạo DB này lần đầu
```

**DB:** mọi lệnh test dùng `salanca_ordering_o8` (UAT nếu cần: `ORDERING_TEST_DATABASE=salanca_ordering_o8_uat UAT_PORT=1355`).
**Tuyệt đối không** chạy lệnh nào nhắm DB dev `salanca_cms` hay production — kể cả `check:phase3`, `smoke:*`, `strapi develop`.
Lệnh nào đọc `DATABASE_NAME` thì đặt rõ `DATABASE_NAME=salanca_ordering_o8` (phiên O10 từng chạy nhầm vào `salanca_cms`).

**Nhánh:** khi xong và gate đạt → `git fetch origin && git merge origin/feat/ordering` (O11 có thể đã merge trước — giải conflict,
thường chỉ là các dòng cùng thêm vào routes/register/errors/menu/bản dịch/`lib/i18n.ts`/`translations/o3.test.ts`/danh sách
migration/`audit/actions.ts`/`alert-codes`/`TEMPLATE_CODES`/`run-all.mjs`/`schema.mjs`/STATUS — lấy **cả hai** bên), chạy
`pnpm run build:ordering` rồi gate có chọn lọc, rồi merge `feat/ordering-o8` vào `feat/ordering` và
`git push origin feat/ordering-o8 feat/ordering` (chủ dự án đã cho phép push theo luồng này). **Không** merge vào `main`.

## Đọc trước khi code (theo thứ tự)

1. `AGENTS.md`, `PLANS.md`, `docs/STATUS.md` (mục O7, O10, O15 mới nhất).
2. **`docs/phases/phase-ordering-8-promotions-rating.md`** (spec, test bắt buộc, UAT).
3. **`docs/plans/ordering-o8-promotions-rating.md`** (kế hoạch 9 bước: pipeline `target`, data model, API, mã lỗi, quyết định).
4. **`docs/plans/ordering-o8-screens.md`** (K1–K4 khuyến mãi, R1–R2 đánh giá, phần thêm vào S4/Reports/Settings) + quy ước chung
   đầu `ordering-o3-screens.md` + mục "Đã đổi khi code" của O3/O5/O6/O7/O10 screens. Đổi tên API thì sửa screens cùng commit.
5. `docs/plans/mockups/ordering-o8-promotions-rating.html`; `docs/plans/ordering-reference.md` mục U8.
6. `docs/plans/ordering-core-contracts.md` (pipeline giá, adjustment, phân bổ, hoàn tiền) và `docs/plans/ordering-o7-ops-extras.md`
   Completion record (sửa đơn — O8 phải giữ khuyến mãi khi sửa đơn).

## Thay đổi so với kế hoạch (đã biết trước khi code)

- **Migration** đặt tên `0008-o8-promotions-rating` (kế hoạch ghi `0006`; `0005-*`, `0006-o10-extensibility` đã dùng, `0007` để dành
  cho O11 đang code song song — runner chạy theo tên). Thêm vào cuối `migrations/index.ts`, `persisted-tables.ts`, ledger trong
  `scripts/ordering/schema.mjs`.
- **Sửa đơn O7 đã có** (`services/order-edit.ts`): bước 4 nối vào đó — giữ adjustment khuyến mãi, tính lại số giảm từ `ruleSnapshot`
  trên dòng còn lại, không bỏ khuyến mãi khi xuống dưới điều kiện (`warnings: ['promotion-kept']`). Phần chênh/hoàn của O7 phải tính
  trên tổng **sau** giảm. Chạy lại `order-edit.mjs` và `line-cancel`-liên quan sau khi nối.
- **Giới hạn phần mỗi ngày O7** (`services/daily-stock.ts`): khuyến mãi không đổi số phần; chỉ cần `daily-stock.mjs` vẫn xanh.
- **Giỏ hàng O11 chưa có trên `feat/ordering`.** O8 **không** thêm `promotionCode` vào giỏ. Nếu khi merge cuối mà O11 đã vào
  `feat/ordering` thì vẫn không thêm trong O8 — ghi "giỏ nhận `promotionCode`: việc nối sau" vào Completion record. Khóa khách
  (`customerKey` = HMAC số điện thoại) giữ đúng kế hoạch, không phụ thuộc tài khoản khách O11.
- **Thẻ quà tặng (O9) chưa có.** Không thêm gì cho thẻ.
- **Mẫu email mới** `customer.rating-invite`: thêm theo cách O10 làm — `TemplateCode` + nội dung mặc định trong
  `domain/notifications/templates.ts`, **và** cả 3 chỗ trong `domain/notifications/template-vars.ts` (`TEMPLATE_CODES`, `_allCodes`,
  `TEMPLATE_NAMES`; thêm biến riêng nếu cần, vd. `{{rateLink}}`), sửa số mẫu trong `scripts/ordering/email-templates.mjs` (đang 15).
  Lưu ý: `pnpm run typecheck` ở root **không** kiểm server plugin — lỗi thiếu mã chỉ hiện ở `pnpm run build:ordering`.
- **Alert `low-rating`:** thêm đủ 4 chỗ — `domain/alert-codes.ts`, mặc định trong `services/alert-rules.ts`, `ALERT_CODES` trong
  `admin/src/pages/Settings/index.tsx`, nhãn trong `translations/o6.ts`. Mở alert truyền `severity` và `locationRef`; **không** thêm
  vào `COUNT_ESCALATED` (alert theo từng đơn, không theo đếm).
- **Lịch sử thay đổi (O15):** mọi thao tác Admin mới ghi `change-log.record` với mã mới — **thêm mã vào
  `server/src/domain/audit/actions.ts`**: nhóm mới `promotion` (`promotion.create`, `promotion.update`, `promotion.active`,
  `promotion.codes-generate`, `promotion.code-active`, `promotion.codes-export`) và `rating.hide`, `rating.note` (nhóm `order` hoặc
  nhóm mới — chọn và ghi lý do; nhóm mới thì thêm nhãn bộ lọc ở trang AuditLog + bản dịch). Test `domain/audit/actions.test.ts` quét
  source sẽ đỏ nếu thiếu; `scripts/ordering/audit-coverage.mjs` thêm ít nhất 1 ca khuyến mãi.
- **Webhook ra ngoài (O10):** không bắt buộc. Nếu thêm sự kiện (vd. `order.rated`) thì vào `domain/webhooks/events.ts`
  (`PUBLIC_EVENTS`), payload **không** có bình luận hay dữ liệu cá nhân, có test trong `events.test.ts`.
- **Quyền mới** `promotion.manage`, `rating.manage`: `register.ts`, `ORDERING_ACTIONS` trong `scripts/ordering/_harness.mjs`, hằng
  RBAC trong `admin/src/lib/permissions.ts`, `useRBAC` + danh sách `loading` trong `admin/src/pages/App.tsx`.
- **Retention:** xóa `comment` đánh giá sau `ratingCommentDays` — mở rộng `jobs/retention.ts`, có test trong `retention.mjs`.
- **Gate cuối bước 9** của kế hoạch ghi "`check:ordering` 2 lượt" — **bỏ**, dùng gate có chọn lọc bên dưới.

## Đã có từ O0–O7, O10, O15 (dùng lại, không làm lại)

- Giá: `domain/pricing/pipeline.ts`, `allocation.ts` (largest remainder) + `pipeline.property.test.ts`; hoàn theo phân bổ
  `domain/refund-amount.ts`, `services/line-cancel.ts`.
- Đặt đơn: `services/order.ts` (`prepareOrder` dùng chung quote/create, `createOrder` idempotent), `domain/storefront/parse.ts`,
  `controllers/storefront.ts` (`verifyCaptcha`), rate limit `controllers/storefront-guard.ts` (429 `RATE_LIMITED`, bucket theo IP),
  `services/storefront.ts` (`aggregateByToken`) cho API đánh giá theo `X-Order-Token`.
- Chuyển trạng thái `services/transition.ts` (terminal `canceled` → release lượt, `completed` → applied), `services/hold.ts`.
- `hashing`, `token-cipher`, `pii.ts` (`maskPayload`); `encryptionKey` cho HMAC khách.
- Thông báo: `services/notification.ts` (`deliver` dedupe), outbox `availableAt` để gửi trễ, mẫu email O10 sửa được.
- Alert O6: `services/alert.ts`, `alert-rules.ts`, `alert-recipients.ts` (người nhận theo action + scope).
- Báo cáo/CSV O6: `services/reports.ts`, `order-export.ts`, `domain/csv.ts` (BOM, chống injection công thức).
- Admin: menu con "Bán hàng" (`admin/src/pages/App.tsx`), bản dịch `translations/o8.ts` dạng `[vi, en]` merge trong `lib/i18n.ts`
  (chuỗi `messagesOf`) + `admin/src/index.ts`, thêm `pages/Promotions`, `pages/Ratings` vào `O3_DIRS` của `translations/o3.test.ts`.
- Harness: `scripts/ordering/_harness.mjs` (`withApp`, `seedBranches`, `seedMenu`, `seedAdminHttpStaff`), barrier nhiều process
  như `outbox-two-process.mjs` (dùng cho `promotion-race.mjs`), thêm script mới vào `run-all.mjs`.

## Những điều đã chứng minh (không đọc lại source để cãi)

- Strapi 5.51.1 không tạo unique index cho `unique: true` → constraint/index (vd. unique `upper(code)`, index biểu thức
  `contact_snapshot->>'phone'`) bằng migration plugin. Tên bảng plugin số ít (`plugins_ordering_<content-type>`).
- `strapi.db.transaction` lồng nhau dùng lại transaction ngoài; `onCommit` chạy sau commit ngoài cùng.
- knex/`db.raw` có thể trả cột JSON dạng **chuỗi** — parse khi đọc qua raw SQL.
- Giữ chỗ có giới hạn làm bằng một câu SQL có điều kiện (xem `daily-stock.ts`: `INSERT … ON CONFLICT … WHERE reserved+n<=limit`)
  hoặc `FOR UPDATE` theo thứ tự id cố định — không đọc rồi ghi ngoài khóa.
- Code admin không import `server/**` hay `@strapi/utils`; logic dùng chung ở `src/plugins/ordering/shared/`.
- Trong `Modal` không dùng `SimpleMenu`/dropdown mới (đã treo trang ở O3); `SingleSelect` ngoài Modal thì được.
- Field tên `locale` bị Strapi dành cho i18n. Không có ESLint plugin `react-hooks`.
- `adminRoute(method, path, handler, ...actions)` — nhiều quyền là tham số rời, không phải mảng.
- `ORDERING_ENABLED=true pnpm exec strapi ts:generate-types` đọc `dist` của plugin → chạy `pnpm run build:ordering` trước, nếu không
  types sinh ra **mất** field mới. Kiểm `git diff types/` trước khi commit.
- Cảnh báo `pg` "client.query() when the client is already executing a query" đến từ populate của `@strapi/database` — không sửa.

## Cách làm

- Đi đúng thứ tự 9 bước của `ordering-o8-promotions-rating.md`. Mỗi bước: code → test → một commit trên `feat/ordering-o8` (kết thúc
  bằng dòng `Co-Authored-By` theo quy ước repo). Ghi bảng bước → commit vào Completion record.
- Tiền là phần chính: bước 1 (pipeline `target`) và bước 3 (`evaluate` thuần, ≥ 30 ca) có test trước khi nối service. Bất biến: tổng
  = Σ dòng sau giảm + phí sau giảm; Σ allocation = số giảm; không âm; quote = create cho cùng input.
- Đếm lượt chống đua: `promotion-race.mjs` 2 process + barrier, `usageLimit 1` → đúng một đơn có giảm.
- Mã khuyến mãi không phân biệt hoa thường, sinh bằng `crypto.randomInt`, bảng chữ bỏ 0/O/1/I/L. Mã sai không lộ "mã có tồn tại
  nhưng hết hạn" khác "không tồn tại" quá mức spec cho phép (theo bảng lỗi trong kế hoạch).
- Không log số điện thoại, email, tên khách, bình luận đánh giá, token.

## Quy tắc bắt buộc

- Plugin không import code app; không dùng `users-permissions`. Không sửa content type, seed hay dữ liệu Salanca.
  **Không chạy `pnpm export:cms-seed`.**
- Không thêm dependency khi chưa hỏi. Không chép code GPL — chỉ học.
- Đổi schema thì `pnpm run build:ordering` rồi sinh lại `types/generated/contentTypes.d.ts` với
  `ORDERING_ENABLED=true pnpm exec strapi ts:generate-types`.
- Không dùng `git stash` trần. Không in mật khẩu/token ra chat.

## Cổng kiểm tra (có chọn lọc — quy ước chủ dự án từ O7)

**Không** chạy lại toàn bộ gate (`check:ordering` ×2, `check:phase3` tắt/bật, bộ smoke). Chạy:

```bash
export ORDERING_TEST_DATABASE=salanca_ordering_o8
pnpm run lint && pnpm run typecheck
pnpm exec vitest run src/plugins/ordering          # unit test plugin + test dịch admin + audit catalog
pnpm run build:ordering                            # bắt lỗi type của server plugin (typecheck root không bắt)
node scripts/ordering/<mỗi script mới của O8>.mjs  # promotions, promotion-race, promotions-admin (nếu tách), rating
node scripts/ordering/<script cũ bị ảnh hưởng>.mjs  # ít nhất: schema, create-order, storefront, idempotency,
                                                    # payment-refund, order-edit, daily-stock, reports, cash-closing,
                                                    # retention, alerts-engine, notifications, email-templates, audit-coverage,
                                                    # audit-log, webhooks-out (nếu thêm sự kiện)
ORDERING_ENABLED=true pnpm exec strapi build        # có màn Admin mới
```

Tên script cũ lấy đúng theo `ls scripts/ordering`. Lỗi ở bước nào thì sửa rồi **chỉ chạy lại bước đó**, không chạy lại từ đầu.
Không UAT giao diện trên Chrome — chủ dự án tự UAT sau. Ghi lệnh và kết quả thật vào Completion record của
`ordering-o8-promotions-rating.md` (ghi rõ "targeted gates") và một mục O8 trong `docs/STATUS.md`. Cập nhật
`docs/ordering-api-contract.md` (`promotionCode`, `promotions`/`rejectedPromotions`, lỗi `PROMOTION_*`, API đánh giá),
`docs/ordering-staff-guide.md` (tạo khuyến mãi, sinh mã, xem/ẩn đánh giá), `docs/security-baseline.md` (đoán mã, dữ liệu đánh giá),
`docs/ordering-admin-openapi.json` nếu O10 sinh từ routes (theo cách O10 ghi), mục "Đã đổi khi code O8" trong `ordering-o8-screens.md`,
`uat-server.mjs` (khuyến mãi mẫu, đơn đã xong để đánh giá).

## Báo cáo khi xong

Danh sách commit, kết quả từng lệnh gate (số thật), chỗ lệch kế hoạch/đặc tả (kèm lý do), việc để lại (giỏ O11 nhận
`promotionCode`, thẻ quà tặng O9, cách ghi giảm giá trên hóa đơn điện tử khi có quyết định VAT), conflict khi merge `feat/ordering`
(nếu có) và cách giải, trạng thái push.
