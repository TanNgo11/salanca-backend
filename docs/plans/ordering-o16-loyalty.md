# O16 — Tích điểm và hạng thành viên: kế hoạch thực hiện

Status: implemented + automated verification passed (2026-10-15) — chờ UAT tay; xem Completion record
Owner: tan_ngo (duyệt + chốt tham số chương trình), AI thực hiện
Last updated: 2026-10-15
Related phase: [`phases/phase-ordering-16-loyalty.md`](../phases/phase-ordering-16-loyalty.md)

Mockup: [`mockups/ordering-o16-loyalty.html`](mockups/ordering-o16-loyalty.html). Đặc tả màn hình ở mục cuối.
Tham số mặc định đã chốt: [`ordering-decisions-2026-10-13.md`](ordering-decisions-2026-10-13.md) (mục O16).

## Goal

Khách đã xác minh OTP tích điểm khi đơn hoàn tất, dùng điểm giảm giá đơn sau, điểm hết hạn theo lô, lên/xuống hạng theo chi
tiêu 12 tháng; hạng gắn nhóm giá O14 và khuyến mãi O8. Quán cấu hình chương trình, xem và điều chỉnh điểm có lý do, theo dõi
điểm đang lưu hành (nợ điểm). Mặc định **tắt**; chặn mở cho khách thật cho tới khi pháp lý/kế toán xác nhận.

## Non-goals

- Đổi quà, chuyển điểm giữa khách, điểm cho hành động khác (đánh giá, giới thiệu), đối tác, thẻ vật lý.
- Phía khách (OW, repo web): chỉ cung cấp API; màn hình khách làm ở phase web.
- Tip (chưa có trong code, đang chờ quyết định riêng): cơ sở tích điểm đã loại tip, khi có tip không cần sửa công thức.

## Current evidence (đã đọc code, 2026-10-15)

- **Hoàn tất đơn** là trạng thái cấp đơn, tính trong `order.recomputeProjection` (`services/order.ts` ~l.457–525). Chỗ này đã có
  hook trong transaction cho `completed` (`promotion.markApplied`, `rating.onOrderCompleted`) và `canceled`
  (`promotion.releaseForOrder`). Sự kiện outbox `order.transitioned` chỉ được enqueue ở `transition.ts`, `payment.ts`,
  `payment-review.ts`; **`line-cancel.ts` và đường hoàn tiền gọi `recomputeProjection` mà không enqueue**. Sau thay đổi
  `canceledAmount` (core-sales), một lần hủy món có thể đẩy đơn sang `completed` mà không có sự kiện → consumer một mình không
  đủ, cần job quét (xem Decisions).
- **Thống kê khách O11**: consumer `order.transitioned` → `customer.onOrderTransitioned` (`register.ts` ~l.290) tính lại
  `orderCount/totalSpent` bằng `order.totalAmount` (gồm phí). Không dùng được cho hạng; cần số riêng.
- **Giá**: `priceCart` (`domain/pricing/pipeline.ts`) nhận adjustment `{kind:'discount', amount, target, sourceRef, priority}`;
  mỗi dòng ra `baseAmount`, `discountAmount` (≤0, gồm mọi giảm giá), `feeAmount`, `roundingDelta`, `lineTotalAmount`
  (= base + discount + fee + rounding [+ thuế ngoài]). **`lineTotalAmount` có cả phí và làm tròn nên không dùng làm cơ sở tích**
  (bản nháp cũ sai ở điểm này): dùng `baseAmount + discountAmount`.
- Khuyến mãi (`services/promotion.ts`) trả adjustment `sourceRef = promotion:<id>`; `prepareOrder` (`services/order.ts`
  ~l.805–880) ghép `[manual, promotion, fee]` rồi `priceCart`; quote dùng bản `promotions.quote`.
- **Khách + nhóm**: `input.customerId` chỉ có khi có phiên (`controllers/storefront.ts` ~l.181/267); `customer-group.codesForPricing`
  chỉ trả nhóm cho khách đăng nhập. Nhóm có `auto` rule thì `refreshAuto` quản lý; nhóm `auto = null` job không đụng
  (`services/customer-group.ts` ~l.312–400). `customer-group-member` lưu `customerId/groupDocumentId` là cột số thường (không
  relation) — tiền lệ cho ràng buộc unique.
- **Khóa**: `lockCustomer` (`services/customer-lock.ts`); `repo.lockOrder` (mutex theo đơn, core-sales `f3d9a47`) phải lấy trước
  mọi khóa hàng khác.
- **Sổ cái tiền lệ**: `gift-card-ledger` (append-only, `balanceAfter`, `scripts/ordering/gift-card-ledger.mjs` random walk).
  Strapi lưu relation ở bảng `*_lnk` nên **không đặt được unique/partial index trên cột relation** (migration O9 phải tạo
  index trên bảng link) — bản nháp cũ đòi "unique partial `(order_id) WHERE kind='earn'`" trên relation là không thực hiện được.
- **Order-edit (O7)** định giá lại và mang theo adjustment cũ; adjustment số tiền cố định được giữ nguyên
  (`services/order-edit.ts` ~l.498–560). Giảm giá điểm là số tiền cố định → có thể vượt trần sau khi bớt món.
- **Cấu hình**: tĩnh qua `config/index.ts` (zod) hoặc core-store qua `ordering-settings`. Màn Y1 cần bật/tắt và sửa số → core-store
  riêng (không nhét vào `settingsSchema` của S9).
- **Chỗ phải đăng ký khi thêm tính năng kiểu O9** (liệt kê từ commit O9): `content-types/index.ts` + `internal.ts`, migration +
  `migrations/index.ts`, `register.ts` (quyền, consumer), `routes/index.ts`, `controllers/*`, `openapi/operations.ts` +
  `docs/ordering-admin-openapi.json` (`pnpm run ordering:openapi`; script `openapi.mjs` fail nếu lệch), `jobs/catalog.ts` + khóa
  cron/lease trong `config/index.ts`, `domain/audit/actions.ts`, `domain/notifications/{templates,template-vars}.ts`,
  `domain/webhooks/events.ts`, `services/data-rights.ts` + `jobs/retention.ts`, admin (`lib/permissions.ts`, `lib/types.ts`,
  `pages/App.tsx`, `translations/o16.ts` + `o3.test.ts`), `scripts/ordering/{_harness,schema,registry-boot,run-all,uat-server}.mjs`.

## Decisions and assumptions

Tham số chương trình lấy từ bảng 2026-10-13 (đã chốt mặc định): 1 điểm/10.000đ, 1 điểm = **100đ** (bản nháp cũ ghi 1.000đ, đã
sửa theo quyết định), tối thiểu 50 điểm/lần, tối đa 50% tiền món, hạn 12 tháng, nhắc trước 14 ngày, ân hạn 30 ngày, trần
2.000 điểm/khách/ngày, hạng Thành viên 0đ ×1.0 / Bạc 2.000.000đ ×1.2 / Vàng 5.000.000đ ×1.5. Tên cấu hình theo file quyết định.

- Decision: **Cơ sở tích** của một đơn = Σ các dòng còn sống của `(baseAmount + discountAmount)` (đã trừ khuyến mãi và điểm; không
  phí, làm tròn, thuế ngoài, tip), chia theo tỉ lệ đơn vị còn sống trên số đơn vị đã định giá (`pricedQuantity`, như
  `liveLineAmount`), rồi trừ phần đã trả bằng thẻ quà tặng (net hoàn), tối thiểu 0. Thẻ quà tặng coi như trả cho tiền món trước.
- Decision: `điểm = floor(cơ sở × hệ số / (earnPerAmount × 100))` (một lần floor; hệ số ×100: 120 = 1,2×). Hệ số ×1.0 cho đúng
  `floor(cơ sở / 10.000)`. Sau đó cắt theo `dailyEarnCap` (phần vượt bị bỏ, không dồn sang ngày sau).
- Decision: **Kích hoạt tích** = consumer `order.transitioned` (to=`completed`) **và** job quét `loyalty-earn-sweep` (mỗi 10 phút)
  tìm đơn `completed`, khách `active`, chưa có dòng `earn`. Idempotent nhờ unique `(order_id)` của `earn`. Job quét cũng bắt
  đơn khách xác minh OTP *sau* khi đơn hoàn tất (đơn đã gắn khách theo SĐT lúc đặt) và các đường hoàn tất không phát sự kiện.
- Decision: **Không tích hồi tố**: lần đầu bật lưu `startsAt`; chỉ đơn có `completedAt >= startsAt` được tích điểm.
- Decision: **Hạng tính từ sổ điểm**: `spend12m` = Σ `baseAmount` các dòng sổ (earn +, reverse −, history +) trong 12 tháng gần
  nhất. Khi bật, lệnh/Admin "Tính hạng theo lịch sử" ghi các dòng `history` (0 điểm, `baseAmount` = cơ sở của đơn hoàn tất
  12 tháng qua của khách `active`) — chỉ khi `countHistoryForTiers=true` (mặc định true). Một nguồn duy nhất, không phụ thuộc
  `order.totalAmount`.
- Decision: **Dùng điểm** = adjustment `discount` số tiền cố định, `target: order`, `sourceRef: 'loyalty'`, `priority` sau mọi
  khuyến mãi, `amount = −điểm × pointValue`. Trần = `floor(tiền món sau khuyến mãi × maxRedeemShare)` (dùng
  `discountedMerchandise`); bước 1 điểm; không dưới `minRedeemPoints`; chỉ khách có phiên và `active`; số dư không âm. **Quote không
  throw** (báo `applied:null` + `reason` như khuyến mãi/thẻ), **create throw** lỗi đã đặt tên. Giỏ O11 không lưu điểm (như
  `giftCardCode`, nhận ở checkout).
- Decision: **Sổ theo lô, một dòng sổ cho mỗi lô bị chạm**: `redeem` trừ lô sắp hết hạn trước (FIFO theo `expiresAt`, bằng nhau
  thì lô cũ); `release` cộng lại đúng lô gốc, nếu lô đã hết hạn thì tạo lô `restore` hạn +30 ngày. Idempotent: unique
  `(order_id, lot_id)` cho `redeem` và cho `release`.
- Decision: **Hủy cả đơn** (order `canceled`, hook cùng transaction với `promotion.releaseForOrder`) → `release` toàn bộ điểm
  đã dùng; đơn chưa tích nên không cần đảo. **Hủy bớt món**: tiền hoàn theo phân bổ (đã gồm phần giảm do điểm), **không** trả
  điểm (khớp quyết định 2026-10-13).
- Decision: **Đảo điểm** khi hoàn tiền đã `settled` trên đơn đã tích: tiền hoàn tính vào món `R` = Σ `refund-line.amount` (hoàn
  theo dòng) hoặc cả số tiền (hoàn theo số). Đảo tích lũy theo từng đơn: `target(R) = round(điểmĐãTích × min(R, cơsở) / cơsở)`,
  đảo thêm `target(R) − target(R_trước)` (telescoping → hoàn hết = đảo hết). Trừ lô của đơn trước rồi tới số dư (cho phép âm,
  chặn dùng khi âm). Ghi `baseAmount` âm bằng phần tiền món đã hoàn để `spend12m` giảm theo. Hook gọi từ cả hai chỗ hoàn thành
  tiền: `createRefundInTransaction` (khi `settled`) và `settleRefund`.
- Decision: **Hạng**: đổi hạng cập nhật nhóm O14 — tier job quản lý dòng `customer-group-member` `source:'auto'` của nhóm gắn
  hạng (các nhóm này để `auto = null` nên `refreshAuto` không động tới). Lên hạng ngay khi `earn` làm `spend12m` vượt mốc;
  xuống hạng khi job hằng ngày thấy `spend12m` dưới mốc hạng hiện tại liên tục ≥ `downgradeGraceDays` (`tierBelowSince`; vượt lại
  thì xóa mốc). Hai nhóm `hang-bac`, `hang-vang` tạo sẵn (không kèm bảng giá) khi lưu cấu hình lần đầu, idempotent theo `code`.
- Decision: **Điều kiện khuyến mãi theo hạng**: thêm `customerGroups: string[]` (mã nhóm O14) vào `promotion` thay vì danh sách
  hạng riêng — hạng đã là nhóm nên dùng chung được cho nhóm bất kỳ; khách chưa đăng nhập không có nhóm nên bị từ chối với lý do
  `group` (hiện ở `rejectedPromotions`). Cần cột mới ở `promotion`, `parse`, `evaluate`, form Admin.
- Decision: **Sửa đơn (O7) có điểm**: sau khi định giá lại, nếu `|giảm điểm|` > trần mới thì thu về trần và `release` phần điểm
  chênh (một dòng `release` theo lô chạm gần nhất); không thì giữ nguyên. Ghi vào timeline đơn.
- Decision: **Xóa dữ liệu (Nghị định 13)**: erase khách → ghi `forfeit` cho số dư còn lại, đưa `remaining` mọi lô về 0, xóa
  `tierCode/spend12m`; xuất dữ liệu (`/me/data-export`, data-rights) gồm sổ điểm. Sổ giữ lại (không chứa dữ liệu cá nhân, chỉ id).
- Decision: quyền mới `loyalty.manage` (cấu hình, hạng), `loyalty.adjust` (điều chỉnh); xem điểm khách dùng `customer.read` + đúng
  phạm vi nhìn thấy khách của `admin-customers`. Điểm tính chung toàn chương trình, không theo chi nhánh; báo cáo lọc chi nhánh
  chỉ tính dòng sổ có đơn (dòng `expire/adjust/forfeit` chỉ hiện ở "tất cả chi nhánh").
- Decision: tích cho mọi cách nhận (`pickup/delivery/dine-in`) và cả đơn hộ nếu khách xác định được (SĐT khớp khách `active`);
  cấu hình `channels`. Gian lận đã giảm bằng: chỉ khách `active`, `dailyEarnCap`.
- Assumption: thuế đang nằm trong giá (v1 tắt thuế) → cơ sở không cần loại thuế; nếu bật thuế ngoài, vẫn đúng vì dùng
  `base + discount`. Kiểm bằng test pipeline có `tax.exclusive`.
- Assumption: `customer.status = 'active'` nghĩa là đã xác minh OTP (O11). Kiểm ở `customer-auth.ts` khi bắt đầu bước 3.
- Owner decision required (không chặn code, chặn mở cho khách thật): điều khoản chương trình + hạch toán điểm lưu hành
  (pháp lý/kế toán); `countHistoryForTiers` (đề xuất có); cho thẻ quà tặng loại khỏi cơ sở theo cách "trả tiền món trước";
  cắt `dailyEarnCap` bỏ phần vượt; hệ số hạng làm tròn xuống một lần.

## Invariants

- Số dư `customer.pointsBalance` = Σ `points` của sổ khách; Σ `remaining` các lô = số dư khi số dư ≥ 0; `0 ≤ remaining ≤ points`
  (CHECK ở DB). Số dư âm chỉ do đảo điểm và chặn mọi lần dùng.
- Sổ append-only (không route/service sửa hoặc xóa); điều chỉnh tay có quyền, lý do, log O15.
- Mỗi đơn tích tối đa một lần (unique `earn`); redeem/release idempotent theo `(order, lot)`.
- Hai đơn song song không dùng quá số điểm: mọi thay đổi điểm của một khách giữ `lockCustomer`.
- **Thứ tự khóa: mutex đơn (`repo.lockOrder`) → khóa khách → hàng lô.** `redeem` ở `createOrder` giữ khóa khách trước khi đơn
  tồn tại (đơn mới, không có mutex đơn để đảo ngược); `earn/release/reverse` luôn lấy mutex đơn trước. Job hết hạn/hạng chỉ khóa khách.
- Thứ tự giảm giá cố định: giá nhóm (O14, ở giá niêm yết) → khuyến mãi (O8) → điểm (O16).
- `loyalty.enabled=false`: không tích, không dùng mới, không hết hạn mới; số dư và sổ giữ nguyên.

## Data model

Bảng sổ/lô lưu `customerId`, `orderId`, `lotId` là **cột integer thường** (không relation) để đặt được unique/FK/partial index
(tiền lệ `customer-group-member`).

| Bảng / field | Mô tả |
| --- | --- |
| core-store `loyalty` (zod) | `enabled` (false), `startsAt?`, `earnPerAmount` 10000, `pointValue` 100, `minRedeemPoints` 50, `maxRedeemShare` 0.5, `expiryMonths` 12, `expiryReminderDays` 14, `downgradeGraceDays` 30, `dailyEarnCap` 2000, `channels` (3 cách nhận), `countHistoryForTiers` true |
| `loyalty-tier` | `code` unique, `name` json {vi,en}, `minSpend12m` bigint, `multiplier` int (100 = ×1.0), `customerGroupCode?`, `rank` unique, `active` |
| `customer` thêm | `pointsBalance` int (có thể âm), `tierCode?` string, `tierSince?`, `tierBelowSince?`, `spend12m` bigint (cache) |
| `loyalty-lot` | `customerId`, `orderId?`, `source` earn\|restore\|adjust, `points`, `remaining`, `expiresAt`, `reminderSentAt?`, `createdAt` |
| `loyalty-ledger` | `customerId`, `kind` earn\|redeem\|release\|reverse\|expire\|adjust\|history\|forfeit, `points` (có dấu), `baseAmount` (có dấu, null nếu không liên quan hạng), `balanceAfter`, `orderId?`, `lotId?`, `actorRef`, `reason?`, `at` |
| `order-line`/`order` | không đổi cột (điểm dùng nằm trong `order-adjustment` `sourceRef=loyalty`) |
| `promotion` thêm | `customerGroups` json (mã nhóm O14) |

Migration `0013-o16-loyalty` (một commit riêng): chỉ phần Strapi không diễn đạt được — unique `earn (order_id) WHERE kind='earn'`,
unique `(order_id, lot_id) WHERE kind IN ('redeem','release')`, CHECK `remaining` trên lô, index lô
`(customer_id, expires_at) WHERE remaining > 0`, `(expires_at) WHERE remaining > 0`, ledger `(customer_id, at)`, `(kind, at)`,
và `(order_id)`. Bảng/cột do Strapi tự tạo từ schema; không backfill (mặc định tắt, `history` do lệnh Admin).

## API

Công khai (khách đăng nhập, `X-Customer-Token`):

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `/api/v1/ordering/me/loyalty` | `{ enabled, balance, value, tier: {code,name,multiplier}, nextTier: {name, missing}, expiringSoon: [{points, expiresAt}] }` |
| GET | `/api/v1/ordering/me/loyalty/history?page=` | sổ điểm đã che chi tiết nội bộ (`actorRef`, `reason` nhân viên) |
| POST | `/quote`, `/orders`, `/carts/current/checkout` | thêm `redeemPoints?: number`. Quote trả `loyalty: { enabled, loginRequired?, balance?, redeemable: { min, max, value }, applied: { points, amount } \| null, reason?, earnPreview: { points } }` |

Admin:

| Method | Path | Quyền | Mô tả |
| --- | --- | --- | --- |
| GET/PUT | `/ordering/loyalty/settings` | `loyalty.manage` | cấu hình; lần bật đầu ghi `startsAt`, tạo hạng + nhóm mặc định |
| GET/POST/PUT | `/ordering/loyalty/tiers[/:id]` | `loyalty.manage` | hạng (tắt thay vì xóa) |
| POST | `/ordering/loyalty/tiers/recalculate` | `loyalty.manage` | ghi `history` + tính lại hạng (lệnh một lần, chạy lại an toàn) |
| GET | `/ordering/customers/:id/loyalty` | `customer.read` | số dư, hạng, lô, sổ |
| POST | `/ordering/customers/:id/loyalty/adjust` | `loyalty.adjust` | `{ points (±), reason, expiresAt? }`; cộng tạo lô `adjust`, trừ theo FIFO |
| GET | `/ordering/reports/loyalty?from=&to=&branch=` | `report.read` | phát/dùng/hết hạn/đảo, lưu hành × giá trị, khách theo hạng |

Lỗi mới: `LOYALTY_DISABLED` 400, `LOYALTY_INSUFFICIENT` 409 (`details.balance`), `LOYALTY_REDEEM_INVALID` 400
(`details.reason`: `below-minimum` \| `over-cap` \| `not-verified` \| `negative-balance`), `LOYALTY_NOT_LOGGED_IN` 401.
Webhook công khai (tối thiểu, không dữ liệu cá nhân): `loyalty.points.earned`, `loyalty.tier.changed` (chỉ `customerDocumentId`).

## Implementation steps

Nhánh `TanNgo11/ordering-o16` tách từ `feat/ordering` đã push; merge về `feat/ordering` khi gate xong, **không** vào `main`. DB test
riêng `salanca_ordering_o16`. Gate theo quy ước hiện tại: lint, typecheck, vitest, các script phase bên dưới + script liên quan;
không chạy full suite, không UAT trình duyệt bằng AI.

1. **Hàm thuần** (2 ngày)
   - Files: `domain/loyalty/earn.ts` (cơ sở từ dòng + `pricedQuantity`, điểm, cắt trần ngày), `redeem.ts` (trần, giá trị, kiểm
     hợp lệ → `reason`), `lots.ts` (tiêu FIFO, trả lô, đảo theo lô), `reverse.ts` (đảo tích lũy telescoping), `tier.ts` (chọn hạng,
     ân hạn); test bảng giá trị + property test xoay vòng giống `pipeline.property.test.ts` (tiêu rồi trả giữ Σ, đảo hết = tích).
   - Verification: `pnpm exec vitest run src/plugins/ordering/server/src/domain/loyalty`.
2. **Dữ liệu, cấu hình, quyền** (1,5 ngày)
   - Files: 4 content type mới + cột `customer`/`promotion`, migration `0013`, `services/loyalty-settings.ts` (core-store + zod),
     `register.ts` (quyền + consumer chưa gắn), `domain/audit/actions.ts` (`loyalty.settings.update`, `loyalty.tier.*`,
     `loyalty.adjust`, `loyalty.recalculate`), `routes`/`controllers` cho settings + tiers, `scripts/ordering/schema.mjs`,
     `_harness.mjs` (dọn bảng), `registry-boot.mjs`.
   - Verification: `schema.mjs`; một script HTTP 403/404 cho settings/tiers.
3. **Tích + đảo** (2,5 ngày)
   - Files: `services/loyalty.ts` (`earnForOrder` — khóa mutex đơn → khóa khách, kiểm `startsAt`/`channels`/`active`, ghi lô + sổ,
     cập nhật `pointsBalance/spend12m`, lên hạng; `reverseForRefund`), consumer `order.transitioned`, `jobs/loyalty-earn-sweep.ts`,
     hook `onRefundSettled` trong `refund.ts` (cả `createRefundInTransaction` khi `settled` lẫn `settleRefund`).
   - Verification: `scripts/ordering/loyalty-earn.mjs` — chỉ khi `completed`; cơ sở loại phí/làm tròn/thẻ/điểm; hệ số hạng; khách
     chưa xác minh không tích rồi tích sau OTP qua sweep; replay consumer + sweep song song không tích hai lần; đường hoàn tất
     qua line-cancel (không có sự kiện) vẫn được sweep bắt; hoàn một phần/toàn phần đảo đúng, âm chặn dùng; `dailyEarnCap`.
4. **Dùng điểm** (3,5 ngày)
   - Files: `domain/storefront/parse.ts` (`redeemPoints`), `services/order.ts` (`prepareOrder` thêm adjustment `loyalty` sau
     khuyến mãi; quote trả `loyalty`; `createOrder` khóa khách, tiêu lô, ghi `redeem`; hook `canceled` → `release`), `controllers/storefront.ts`
     + `cart.ts` (truyền `redeemPoints`, session), `services/order-edit.ts` (thu về trần + release chênh), `domain/promotions`
     (`customerGroups`) + `services/promotion.ts` + `promotion-admin.ts`, `openapi/operations.ts`.
   - Verification: `loyalty-redeem.mjs` (trần %/tối thiểu, quote = create, tổng giảm nhiều lớp nhóm→khuyến mãi→điểm, hủy cả đơn trả
     lô gốc/lô hết hạn, hủy bớt món không trả điểm, sửa đơn thu về trần); `loyalty-race.mjs` (hai đơn cùng khách dùng hết điểm →
     một `LOYALTY_INSUFFICIENT`; redeem vs expiry; release vs reverse; không deadlock với mutex đơn — barrier như
     `core-sales-fixes.mjs`, kiểm tắt khóa thì fail).
5. **Hạn điểm, hạng, email** (3 ngày)
   - Files: `jobs/loyalty-expiry.ts` (hết hạn từng lô dưới khóa khách + nhắc một lần theo `reminderSentAt`, chỉ khách đồng ý tiếp
     thị), `jobs/loyalty-tiers.ts` (hằng ngày: tính `spend12m`, ân hạn, đổi nhóm O14, email `customer.tier-up`), lệnh recalculate
     (`history`), `domain/notifications/{templates,template-vars}.ts` (`customer.points-expiring`, `customer.tier-up`),
     `jobs/catalog.ts` + khóa cron/lease trong `config/index.ts`, `domain/webhooks/events.ts`, `data-rights.ts`/`retention.ts`
     (forfeit khi erase, xuất sổ).
   - Verification: `loyalty-expiry.mjs` (lô cũ dùng trước, job đúng lô, chạy lại không trừ hai lần, nhắc một lần, erase forfeit),
     `loyalty-tiers.mjs` (vượt mốc lên ngay, ân hạn, vượt lại xóa mốc, đổi nhóm O14 → giá nhóm, khuyến mãi theo nhóm, `refreshAuto` không
     xóa thành viên hạng, `history` idempotent).
6. **Admin + báo cáo Y1–Y4** (2,5 ngày)
   - Files: `admin/src/pages/Loyalty/` (Y1, Y2), tab "Điểm" ở chi tiết khách (`pages/Customers`, Y3), thẻ "Điểm" trong
     `pages/Reports` + `services/reports.ts` (Y4), ô nhóm trong form khuyến mãi, `lib/permissions.ts`, `lib/types.ts`,
     `pages/App.tsx`, `translations/o16.ts` + `o3.test.ts`.
   - Verification: `loyalty-admin.mjs` (403/404, điều chỉnh có log O15, phạm vi khách), `pnpm run typecheck:admin`, `admin-build.mjs`.
7. **Tài liệu, OpenAPI, gate** (1 ngày)
   - Files: `pnpm run ordering:openapi`, staff guide, `ordering-api-contract.md`, `ordering-integrations.md` (webhook), contracts
     (mục khuyến mãi/điểm), STATUS, roadmap, Completion record; thêm 6 script vào `run-all.mjs`.
   - Verification: lint, typecheck, `typecheck:admin`, vitest, `openapi.mjs`, toàn bộ script loyalty + script bị ảnh hưởng
     (`create-order`, `storefront`, `cart-checkout`, `cart-promotion`, `order-edit`, `payment-refund`, `sepay-refund`,
     `core-sales-fixes`, `customers`, `customer-auth`, `data-rights`, `reports`, `price-lists`, `promotions`, `promotion-money`,
     `promotion-race`, `promotions-admin`), `check:phase3`.

Ước lượng: 16 ngày làm việc (~3 tuần), dài hơn bản nháp (2–2,5 tuần) vì thêm job quét tích, lệnh `history`, xử lý sửa đơn, xóa/xuất dữ
liệu, OpenAPI và điều kiện khuyến mãi theo nhóm.

## Đặc tả màn hình

Quy ước chung như [`ordering-o3-screens.md`](ordering-o3-screens.md); chuỗi trong `translations/o16.ts`; nhóm menu **Khuyến mãi & thẻ**.

### Y1. Chương trình điểm

- Route `/plugins/ordering/loyalty`. Quyền `loyalty.manage`. `Switch` bật chương trình; ô số: "1 điểm cho mỗi … đ", "1 điểm = … đ",
  "Dùng tối thiểu … điểm", "Dùng tối đa …% tiền món", "Điểm hết hạn sau … tháng", "Nhắc trước … ngày", "Tối đa … điểm/ngày/khách";
  tích cho cách nhận (nút); ô "Tính hạng theo lịch sử 12 tháng" + nút "Tính lại hạng"; câu tóm tắt "Đơn 300.000đ nhận 30 điểm (= 3.000đ
  khi dùng)" (theo mặc định 1 điểm/10.000đ, 100đ/điểm). Lưu (log O15). Cảnh báo "Chưa mở cho khách" khi tắt.

### Y2. Hạng thành viên (tab trong Y1)

- Bảng: Tên, Chi tiêu 12 tháng từ, Hệ số điểm, Nhóm giá (O14), Số khách, bật. Thêm/sửa trong panel. Ghi chú "Xuống hạng sau 30 ngày
  dưới mốc" và "Nếu bỏ khách khỏi nhóm giá bằng tay, job hạng sẽ thêm lại".

### Y3. Điểm của khách (tab "Điểm" trong chi tiết khách C2 của O11)

- Thẻ: Số dư (quy ra tiền), Hạng + tiến độ, Sắp hết hạn (14 ngày). Bảng lô (điểm, còn lại, hạn, nguồn). Sổ điểm (lúc, loại, điểm ±, số
  dư sau, đơn, người, lý do). Nút "Điều chỉnh điểm" (`loyalty.adjust`; panel ± điểm, lý do bắt buộc, hạn cho điểm cộng).

### Y4. Báo cáo điểm (thẻ trong Báo cáo V4 O6)

- Điểm phát, dùng, hết hạn, đảo trong kỳ; **đang lưu hành** (điểm × giá trị = nợ điểm); số khách theo hạng. Lọc chi nhánh chỉ tính dòng có đơn.

## Data and rollback

- Migration/backfill: `0013` chỉ thêm ràng buộc/index; không backfill tự động. `history` do Admin chạy sau khi bật.
- Compatibility: cột/bảng mới nullable hoặc có mặc định; API cũ không đổi (trường `redeemPoints`/`loyalty` thêm vào, tùy chọn).
- Rollback: `enabled=false` (đủ cho vận hành); số dư và sổ giữ nguyên. Gỡ code: forward-only với bảng, không có ràng buộc ngược lên bảng cũ.

## Verification

- Automated: `pnpm run lint`, `pnpm run typecheck`, `pnpm run typecheck:admin`, `pnpm exec vitest run`, `pnpm run build:ordering`,
  `node scripts/ordering/<loyalty-*.mjs>` + các script bị ảnh hưởng ở bước 7, `openapi.mjs`; `check:phase3` tắt/bật plugin ở cuối.
- Manual UAT (bạn làm, theo spec): khách đăng nhập đặt 300.000đ → hoàn tất → nhận 30 điểm; đơn sau dùng điểm giảm; hủy đơn → điểm
  về lại; đặt mốc Bạc thấp → lên hạng → thấy giá nhóm Bạc; điều chỉnh điểm có log; báo cáo điểm lưu hành.
- Evidence to record: Completion record trong file này (bảng bước → commit, lệnh và kết quả), STATUS.

## Documentation impact

- Spec + mockup O16 (sửa ví dụ điểm), staff guide, API contract, integrations, contracts, OpenAPI, runbook (job mới), STATUS, roadmap.

## Risks and blockers

- Điểm là nợ phải trả với khách; điều khoản và hạch toán cần pháp lý/kế toán — chặn mở cho khách thật, không chặn code (mặc định tắt).
- Khóa: thêm khóa khách vào đường hoàn/hủy có thể tạo vòng chờ → mutex đơn trước khách, test `loyalty-race` có barrier và tắt-khóa-thì-fail.
- Đường hoàn tất không phát sự kiện: đã bù bằng job quét; nếu muốn sạch hơn, một phase sau cho `recomputeProjection` tự enqueue.
- Sửa đơn có điểm là chỗ dễ sót nhất (số tiền cố định bị mang theo) — có test riêng ở bước 4.
- Thay đổi hành vi `promotion` (điều kiện nhóm) phải nằm sau cờ rỗng = không điều kiện, không đổi khuyến mãi hiện có.

## Completion record

Trạng thái: **implemented + automated verification passed — chờ UAT tay + quyết định chủ dự án để mở cho khách thật** (2026-10-15).
Nhánh `TanNgo11/ordering-o16` (tách từ `origin/feat/ordering` `5930344`); chương trình **mặc định tắt**.

| Bước | Nội dung | Commit |
| --- | --- | --- |
| 1 | Hàm thuần `domain/loyalty` (earn, redeem, lots, reverse, tier) + test bảng/property | `504019d` |
| 2a | 3 content type (`loyalty-tier/lot/ledger`), cột `customer`/`promotion`, migration `0013-o16-loyalty` | `5c8b6dc` |
| 2b | Cấu hình (core-store), hạng, quyền `loyalty.manage/adjust`, route Admin, lỗi, audit, OpenAPI, `loyalty-admin` | `3cecde7` |
| 3 | Tích điểm khi hoàn tất (consumer + job quét), thu hồi khi hoàn tiền, `loyalty-earn` | `4b3dc79` |
| 4 | Dùng điểm (quote/create/checkout), hoàn điểm khi hủy/sửa đơn, điều kiện khuyến mãi theo nhóm, `loyalty-redeem`, `loyalty-race` | `903758d` |
| 5 | Hết hạn lô + nhắc, xét hạng + nhóm O14, nhập lịch sử, 2 mẫu mail, 2 webhook, `/me/loyalty`, forfeit/export khi xóa dữ liệu, `loyalty-expiry`, `loyalty-tiers` | `8c2ac57` |
| 6a | API Admin: điểm của khách, điều chỉnh có log, báo cáo | `d0d6d20` |
| 6b | Màn Y1–Y4 (trang Điểm & hạng, tab Điểm ở khách, thẻ báo cáo, ô nhóm trong form khuyến mãi) | `524dc4b` |
| 7 | Tài liệu, OpenAPI, `run-all.mjs`, gate | commit tài liệu cuối nhánh |

**Gate cuối (targeted, một lần, DB `salanca_ordering_o16`):**

Tất cả exit 0 (DB `salanca_ordering_o16`): `pnpm run lint`, `pnpm run typecheck`, `pnpm run typecheck:admin`,
`pnpm exec vitest run src/plugins/ordering config` (943/943 test), `pnpm run build:ordering`; script `loyalty-earn`, `loyalty-redeem`,
`loyalty-race`, `loyalty-expiry`, `loyalty-tiers`, `loyalty-admin`, `create-order`, `storefront`, `cart-checkout`,
`cart-promotion`, `order-edit`, `payment-refund`, `sepay-refund`, `core-sales-fixes`, `customers`, `customer-auth`,
`data-rights`, `reports`, `price-lists`, `promotions`, `promotion-money`, `promotion-race`, `promotions-admin`,
`email-templates`, `audit-coverage`, `schema`; `pnpm run ordering:openapi` + `openapi.mjs` (146 path);
`ORDERING_ENABLED=true pnpm exec strapi build`. Không chạy `check:ordering`/`check:phase3`/smoke (theo quy ước gate gọn).

**Chỗ lệch kế hoạch (và lý do):**

- **Hoàn điểm khi hủy đơn / sửa đơn không nằm trong transaction hủy/sửa.** Làm trong transaction riêng
  `reconcileForOrder` (mutex đơn → khóa khách → lô), kích hoạt bởi consumer `order.transitioned` (to=`canceled`),
  sự kiện outbox `loyalty.reconcile` (cùng transaction với `order.edited`) và job `loyalty-earn-sweep` (bắt đơn hủy
  không có sự kiện). Lý do: `createOrder` giữ khóa khách rồi mới đụng khuyến mãi/tồn/thẻ; chen khóa khách vào
  transaction hủy (đã giữ khóa nhóm/thanh toán) có thể đóng vòng chờ. `reconcile` là idempotent theo sổ
  (`Σ redeem − Σ release`), nên chạy lại không hoàn thêm. Độ trễ = chu kỳ outbox (vài giây).
- **Không có unique `(order_id, lot_id)` cho `release`** (kế hoạch ghi có): sửa đơn có thể hoàn một phần rồi hủy hoàn
  phần còn lại về cùng một lô. Idempotent nằm ở service; unique `earn (order_id)` và `redeem (order_id, lot_id)` vẫn có.
- **Thêm cột `originLotId` ở sổ** (lô gốc của một dòng `release`, vì điểm hoàn có thể vào lô `restore` mới) và index
  `(order_id) WHERE kind IN ('redeem','release')` cho job quét hoàn.
- **Giảm giá điểm là dòng cố định `priority 900`**: sau khuyến mãi, trước phí chi nhánh (1000). Phí % tính trên tiền món
  sau mọi giảm giá, kể cả điểm.
- **Mail nâng hạng cần khách đồng ý tiếp thị** (như mail nhắc hết hạn); kế hoạch không nói rõ.
- **API `/me/loyalty` làm ở bước 5** (gần job/hạng), không phải bước 6.
- **Trần ngày `dailyEarnCap` tính theo ngày lịch Việt Nam (UTC+7)**, phần vượt bị bỏ (đúng đề xuất).
- **Test tranh chấp có biến thể tự kiểm "tắt khóa thì đỏ"**: `loyalty-race.mjs` chạy kịch bản hai đơn cùng dùng hết điểm
  với cả hai tầng khóa bị gỡ (khóa khách và `FOR UPDATE` trên lô) và khẳng định kết quả là lỗi CHECK `23514` thay vì
  `LOYALTY_INSUFFICIENT` sạch. Hai tầng khóa che nhau nên gỡ riêng từng tầng không làm đỏ.
- **Sửa nhỏ ở code cũ:** `refund.ts` gọi `reverseForOrder` ở cả `createRefundInTransaction` (khi `settled`) và
  `settleRefund`; `data-rights` gọi `forfeitInTransaction` trong transaction xóa và thêm mục `loyalty` vào xuất dữ liệu.

**Còn mở (chủ dự án):**

- UAT tay theo spec: đặt 300.000đ → hoàn tất → nhận 30 điểm; đơn sau dùng điểm giảm; hủy đơn → điểm về lại; đặt mốc Bạc
  thấp → lên hạng → thấy nhóm/giá Bạc; điều chỉnh điểm có log O15; báo cáo điểm lưu hành. Chưa chạy UAT trình duyệt bằng AI.
- **Chặn mở cho khách thật:** điều khoản chương trình (pháp lý) và hạch toán điểm lưu hành (kế toán).
- Xác nhận: `countHistoryForTiers` (đề xuất bật), thẻ quà tặng loại khỏi cơ sở theo cách "trả tiền món trước", cắt
  `dailyEarnCap` bỏ phần vượt, hệ số hạng làm tròn xuống một lần.
- Màn hình khách (OW) và tip: ngoài phạm vi; API đã sẵn (`redeemPoints`, `loyalty` trong quote, `/me/loyalty`).
