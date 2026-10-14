# O9 — Thẻ quà tặng: kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt), AI thực hiện
Last updated: 2026-10-12
Related phase: [`phases/phase-ordering-9-gift-cards.md`](../phases/phase-ordering-9-gift-cards.md)

Đặc tả màn hình: [`ordering-o9-screens.md`](ordering-o9-screens.md) (G1–G4, reference mục U9). Mockup:
[`mockups/ordering-o9-gift-cards.html`](mockups/ordering-o9-gift-cards.html).

Chủ dự án chọn làm cả mã giảm giá (O8) và thẻ quà tặng (O9) — 2026-10-12.

## Goal

Bán thẻ có số dư, phát mã sau khi đã thu tiền, dùng thẻ như một cách thanh toán, quản lý và báo cáo tách nợ thẻ.

## Non-goals

- Mệnh giá tự chọn, nạp thêm, chuyển số dư, đổi ra tiền mặt, thẻ giấy (chờ quyết định), POS ngoài plugin,
  hóa đơn điện tử.

## Current evidence

- Contracts §10: `VoucherProvider { issue, redeem, refundUnused, getStatus }`; mã hash, chống đoán, lock khi
  redeem; doanh thu/hoàn thẻ là quyết định chủ dự án. §5 product type; §12 outbox `voucher.issued`.
- Registry: `registerProductType`, `registerPaymentProvider`, `registerFulfillmentProvider`
  (`services/registry.ts`, `register.ts`). Product type hiện có: `food`. Fulfillment: `self-delivery`, pickup.
- Workflow: `domain/workflow/definitions.ts` (pickup-*, delivery-*), chọn theo `receiveMethod.kind` +
  `paymentTiming`; đơn trộn workflow → `MIXED_WORKFLOW_UNSUPPORTED`.
- `PaymentProvider` (`contracts/payment.ts`): `initiate`, `capture?`, `refund?`, `getPresentation`; payment có
  `status`, `capturedAmount`, `refundedAmount`; một đơn nhiều payment; `recomputeProjection` tính `paymentStatus`.
- Hoàn: `services/refund.ts` `createRefundInTransaction` gọi `provider.refund` — trả `settled` hoặc `pending`;
  `admin-orders.refundHeld` (O5 sửa sau review) hoàn mọi payment còn giữ khi hủy/từ chối/hết hạn.
- `domain/storefront/parse.ts` chỉ nhận `receiveMethod.kind` `pickup|delivery`.
- Storefront: captcha (`verifyCaptcha`), rate limit IP (`storefront-guard.ts`, 429 `RATE_LIMITED`), token mã hóa
  (`domain/token-cipher.ts`), `domain/hashing.ts`.
- O6: `reports.ts` theo `provider_code`; `cash-closing.ts` chỉ `cash`; alert engine; retention; CSV.

## Decisions and assumptions

- Decision: thẻ là product type `gift-card` + fulfillment `issue-code` + workflow `gift-card`
  (`awaiting-payment → issued (success)`, `expired`/`canceled`), `receiveMethod.kind = 'digital'`
  `{ recipientEmail, recipientName?, message? ≤ 300, sendAt? }` (sendAt v1 = ngay).
- Decision: đơn thẻ chỉ chứa dòng thẻ; tối đa 10 thẻ/đơn; thanh toán online `prepay` qua provider online của chi
  nhánh, hoặc tại quầy: nhân viên tạo đơn hộ (O3 `order.create`) và thu tiền mặt bằng `cash-handover`.
- Decision: phát mã trong outbox consumer của sự kiện group → `issued` (sau capture): mỗi dòng × số lượng → một thẻ;
  idempotent theo (orderLineId, index).
- Decision: mã = 16 ký tự từ bảng 30 ký tự (A–Z 2–9 bỏ O, I, L, 0, 1), hiển thị `XXXX-XXXX-XXXX-XXXX`;
  lưu `HMAC-SHA256(encryptionKey, mã chuẩn hóa)` + `last4`; mã gốc chỉ có trong email (và trang đơn người mua
  trong 24 giờ, giải mã từ bản niêm phong bằng `token-cipher`, sau đó xóa bản niêm phong).
- Decision: dùng thẻ = payment `gift-card` **captured ngay khi tạo đơn** trong transaction tạo đơn:
  `UPDATE gift_card SET balance = balance - n WHERE id = ? AND status='active' AND expires_at > now AND balance >= n`
  (n = min(số dư lúc tạo đơn, số phải trả)); 0 dòng → đọc lại số dư và thử lại một lần với số dư mới; số dư
  còn 0 → `GIFT_CARD_INSUFFICIENT`. Số trừ thật có thể nhỏ hơn số quote đã báo — response trả
  `giftCard.applied` thật và số còn phải trả. Ghi sổ `redeem`.
- Decision: hoàn về thẻ: provider `gift-card.refund` cộng số dư, ghi sổ `refund`, trả `settled`. Hủy bớt món/hủy
  đơn có nhiều payment: hoàn **thẻ trước**, rồi tiền mặt/chuyển khoản (ghi rõ trong timeline).
- Decision: đơn `prepay` có cả thẻ và SePay: phần SePay = tổng − thẻ; đơn hết hạn chờ chuyển khoản → hoàn thẻ
  (`refundHeld` đã xử lý mọi payment còn giữ).
- Decision: khóa thẻ (`blocked`) chặn dùng mới, không đụng đơn đã trả. Gia hạn/điều chỉnh/phát tặng ghi sổ +
  change-log, bắt buộc lý do. Quyền mới `gift-card.manage` (tra, khóa, gia hạn, phát tặng) và
  `gift-card.adjust` (điều chỉnh số dư).
- Decision: mặc định hạn 12 tháng (`config.giftCards.validityMonths`), hoàn thẻ chưa dùng = **không** (cấu hình
  `refundUnused: false`) — đổi khi có quyết định.
- Assumption: Salanca bán thẻ cùng chi nhánh (thẻ dùng ở mọi chi nhánh). Nếu chủ dự án muốn thẻ theo chi nhánh →
  thêm `locationRefs` (để mở).

## Invariants

- `balance ≥ 0`; `balance = Σ amount` của sổ (issue +, redeem −, refund +, adjust ±, expire −) — có test
  kiểm sau mọi script.
- Sổ thẻ chỉ thêm, không sửa/xóa; không route update/delete.
- Hai đơn dùng cùng thẻ song song không trừ quá số dư.
- Không lưu, không log mã gốc; lỗi mã không phân biệt "không có" và "đã khóa" (`GIFT_CARD_INVALID`).
- Tiền thẻ không vào chốt tiền mặt; bán thẻ không cộng vào doanh thu món.

## Data model

| Bảng | Field |
| --- | --- |
| `gift-card` | `codeHash` (unique), `last4`, `initialAmount`, `balance`, `currency`, `status` active\|blocked\|expired, `issuedAt`, `expiresAt`, `source` sale\|manual, `order?`, `orderLine?`, `recipientEmailHash?`, `issuedBy`, `note`, `sealedCode?` (mã đã niêm phong, xóa sau 24 giờ) |
| `gift-card-ledger` | `card`, `kind` issue\|redeem\|refund\|adjust\|expire\|block\|unblock\|extend, `amount` (có dấu; 0 cho block/unblock/extend), `balanceAfter`, `order?`, `payment?`, `refund?`, `actorRef`, `reason?`, `at` |
| config `giftCards` | `enabled`, `validityMonths` (12), `maxCardsPerOrder` (10), `refundUnused` (false), `failedAttempts: { captchaAfter: 3, blockAfter: 20, windowMinutes: 10 }` |

Migration `0007-o9-gift-cards.ts`: unique `code_hash`; `CHECK (balance >= 0)`; index ledger (card_id, at);
trigger hoặc không route nào ghi `UPDATE/DELETE` ledger (kiểm bằng test grep route + service).

## API

Công khai (`/api/v1/ordering`):

| Method | Path | Body | Trả về / lỗi |
| --- | --- | --- | --- |
| POST | `/quote`, `/orders` (đã có) | `receiveMethod.kind: 'digital'` cho đơn thẻ; `giftCardCode?` + `captchaToken?` khi trả bằng thẻ | quote thêm `giftCard: { last4, applied, balanceAfter }`, `totals.dueAfterGiftCard` |
| POST | `/gift-cards/balance` | `{ code, captchaToken }` | `{ last4, balance, expiresAt, status: 'active' }` hoặc `GIFT_CARD_INVALID` |

Lỗi (`domain/errors.ts`, `translations/o9.ts`): `GIFT_CARD_INVALID` 400 (không có/khóa/sai định dạng),
`GIFT_CARD_EXPIRED` 400, `GIFT_CARD_INSUFFICIENT` 409 (số dư về 0 giữa quote và create),
`GIFT_CARD_NOT_ALLOWED` 400 (`details.reason: 'buying-gift-card' | 'disabled'`), `GIFT_CARD_NOT_FOUND` 404 (Admin).

Admin (`/ordering`):

| Method | Path | Quyền | Mô tả |
| --- | --- | --- | --- |
| GET | `/gift-cards?q=&status=&source=&page=` | `gift-card.manage` | `q` = 4 ký tự cuối hoặc mã đơn (không nhận mã đầy đủ trong query string) |
| POST | `/gift-cards/search` | `gift-card.manage` | `{ code }` mã đầy đủ trong body → HMAC rồi tìm; không log body |
| GET | `/gift-cards/:id` | `gift-card.manage` | thẻ + sổ + đơn đã dùng |
| POST | `/gift-cards` | `gift-card.manage` | phát tặng `{ amount, recipientEmail?, reason, expiresAt? }` → trả mã gốc **một lần** |
| POST | `/gift-cards/:id/block` · `/unblock` | `gift-card.manage` | `{ reason }` |
| POST | `/gift-cards/:id/extend` | `gift-card.manage` | `{ expiresAt, reason }` |
| POST | `/gift-cards/:id/adjust` | `gift-card.adjust` | `{ amount (±), reason }` |
| POST | `/gift-cards/:id/resend` | `gift-card.manage` | gửi lại email cho người nhận ban đầu (không lộ mã cho nhân viên) |
| GET | `/reports/sales` (đã có) | `report.read` | thêm `giftCards: { sold, redeemed, outstanding }` |

## Implementation steps

1. **Dữ liệu, cấu hình, quyền**
   - Files: 2 content type, migration `0007`, `config/index.ts` (`giftCards`), `register.ts` (2 action),
     `domain/gift-cards/code.ts` (sinh/chuẩn hóa/định dạng/HMAC), `persisted-tables`, `types/generated`.
   - Verification: `code.test.ts` (100.000 mã không trùng, chuẩn hóa bỏ `-` và chữ thường, không ký tự cấm);
     `schema.mjs`.
2. **Service sổ thẻ**
   - Files: `services/gift-card.ts`: `issueInTransaction`, `findByCode` (HMAC, so hằng thời gian),
     `redeemInTransaction(trx, { cardId, amount, orderId, paymentId })` (UPDATE có điều kiện + sổ),
     `creditInTransaction` (refund/adjust), `block/unblock/extend`, `ledger(cardId)`; mọi thay đổi trong transaction
     của caller, khóa dòng thẻ `FOR UPDATE` cho thao tác Admin.
   - Verification: `scripts/ordering/gift-card-ledger.mjs`: Σ sổ = số dư sau chuỗi thao tác ngẫu nhiên (200 bước);
     số dư không âm.
3. **Bán thẻ**
   - Files: product type `providers/product-types/gift-card.ts` (biến thể = mệnh giá, không tùy chọn, không giới hạn
     ngày O7), fulfillment provider `providers/issue-code.ts`, workflow `gift-card` trong `definitions.ts`,
     `parse.ts` (`kind: 'digital'`, email người nhận bắt buộc, lời chúc ≤ 300), `prepareOrder` (đơn thẻ không trộn
     món; thẻ không dùng mã giảm giá O8 trừ khi khuyến mãi chọn đúng danh mục thẻ — mặc định loại trừ),
     outbox consumer `fulfillment-group.transitioned` → `issued`: phát thẻ, enqueue `gift-card.issued` → email
     `customer.gift-card` (VI/EN: mệnh giá, mã, hạn, lời chúc, link kiểm tra số dư) tới người nhận và email xác nhận
     tới người mua (không chứa mã).
   - Verification: `scripts/ordering/gift-card-sale.mjs`: SePay webhook giả → 2 thẻ, email 1 lần/người nhận, replay
     không phát thêm; đơn hết hạn không phát; tại quầy: đơn hộ + `cash-handover` → phát.
4. **Dùng thẻ**
   - Files: provider `providers/gift-card.ts` (`initiate` → captured, `refund` → credit `settled`),
     `prepareOrder` (quote: tra thẻ, `applied = min(balance, due)`), `createOrder` (sau khi tạo đơn: payment
     `gift-card` + `redeemInTransaction`; phần còn lại theo payment của đơn; nếu thẻ trả đủ → đơn `prepay` bỏ bước
     chờ thanh toán — `advanceIfPaid` O4), `refund.ts`/`refundHeld` thứ tự hoàn thẻ trước, `line-cancel.ts` như vậy;
     storefront: bucket rate limit `gift-card` (đếm mã sai/IP), captcha sau 3 lần; `/gift-cards/balance`.
   - Verification: `scripts/ordering/gift-card-redeem.mjs` đủ ca trong spec; `scripts/ordering/gift-card-race.mjs`
     (2 process + barrier): thẻ 100k, 2 đơn 80k → một đơn trừ 80k, đơn kia trừ 20k và trả
     `giftCard.applied = 20000` + số còn phải trả; thẻ 0 → `GIFT_CARD_INSUFFICIENT`; hết hạn/khóa/sai.
5. **Admin thẻ quà tặng**
   - Files: `controllers/gift-cards.ts`, routes, `admin/src/pages/GiftCards/` (G1–G3), nhóm menu **Khuyến mãi**
     (đổi tên nhóm thành "Khuyến mãi & thẻ"), chi tiết đơn S4 hiện payment thẻ (`•••• AB7K`) và thẻ đã phát của đơn
     thẻ; `translations/o9.ts`.
   - Verification: script HTTP `gift-card-admin.mjs`: thiếu quyền 403; phát tặng trả mã một lần (GET sau đó không có
     mã); khóa → quote `GIFT_CARD_INVALID`; điều chỉnh cần `gift-card.adjust`; change-log đủ.
6. **Báo cáo, chốt tiền, CSV, hết hạn, retention, cảnh báo**
   - Files: `reports.ts` (bán thẻ = Σ payment captured của đơn thẻ; dùng thẻ = Σ payment `gift-card`; số dư lưu
     hành = Σ balance active; doanh thu món không gồm đơn thẻ), `cash-closing.ts` (thêm test: không đổi),
     `order-export.ts` (cột thẻ `•••• last4`), job `gift-card-expiry` (hằng ngày; `ORDERING_JOBS`; ghi sổ `expire`
     số dư còn lại), retention xóa `sealedCode` sau 24 giờ, alert rule `gift-card-probing` (mã sai ≥ ngưỡng từ một
     IP trong 10 phút; người nhận `ops.read`).
   - Verification: `scripts/ordering/gift-card-report.mjs`: tổng khớp sổ; chốt tiền mặt không đổi; job hết hạn chạy
     lại không ghi sổ lần hai; alert mở một lần.
7. **Tài liệu, UAT seed, gate**
   - Files: API contract, staff guide (bán ở quầy, tra/khóa/gia hạn, phát tặng), payments runbook (hoàn về thẻ),
     security baseline (mã thẻ, dò mã), screens O9 "Đã đổi khi code", `uat-server.mjs` (món thẻ 200k/500k, vài thẻ
     mẫu), `run-all.mjs`, STATUS, Completion record.
   - Verification: gate đầy đủ, `check:ordering` 2 lượt.

## Data and rollback

- Migration `0007`: bảng mới; không đổi bảng cũ.
- Rollback: `giftCards.enabled=false` (ẩn món thẻ, provider từ chối thẻ mới); thẻ đã phát giữ nguyên số dư.

## Verification

- Automated: như O7/O8.
- Manual UAT: theo spec (SePay thật khi có tài khoản).
- Evidence: Completion record + `docs/STATUS.md`.

## Documentation impact

- Spec/screens/mockup O9, reference U9, API contract, staff guide, payments runbook, security baseline, STATUS,
  roadmap.

## Risks and blockers

- Quyết định kế toán/pháp lý chặn **mở bán**, không chặn code.
- Lộ mã trong email chuyển tiếp: cho người nhận/quán khóa nhanh; trang kiểm tra số dư không hiện lịch sử dùng.
- Đơn trộn thẻ + món bị chặn ở v1 — UX web phải tách giỏ.

Ước lượng thô: khoảng 2 tuần (1–2: 3 ngày; 3: 3 ngày; 4: 3–4 ngày; 5: 2 ngày; 6: 2 ngày; 7: 1–2 ngày).

## Completion record

Trạng thái: **implemented + automated verification passed — chờ UAT tay + duyệt merge** (2026-10-14).
Nhánh `TanNgo11/ordering-o9`.

| Bước | Commit | Nội dung |
| --- | --- | --- |
| 1 | `c66dd48` | 3 content type (card, ledger, batch), migration `0010-o9-gift-cards`, config `giftCards`, sinh mã/chuẩn hoá/HMAC/seal |
| 2 | `1547595` | `gift-card` service (issue/find/redeem/credit/block/extend, `expireDue`), `gift-card-ledger.mjs` — từ chối credit thẻ `inactive` |
| 3 | `6d9f1e3` | Luồng bán digital: `receiveMethod.kind='digital'`, workflow `gift-card`, phát hành sau capture qua outbox, email người nhận, bán quầy thẻ giấy quét mã, `gift-card-sale.mjs` |
| 4 | `43dd031` | Thẻ làm phương thức co-payment: debit ở create, refund/cancel/expiry hoàn về thẻ, race an toàn, balance endpoint + chống dò mã, `gift-card-payment.mjs` |
| 5 | `a8d3dba` | API Admin G1–G3 + lô thẻ giấy, `gift-card-admin` service, controller/routes/quyền (`gift-card.manage`, `gift-card.adjust`, `export`), sealed code/recipient + resend, Admin pages GiftCards + order-detail hiển thị thẻ, `gift-card-admin.mjs`, OpenAPI 14 op |
| 6 | `cbbf1d3` | Báo cáo `summary.giftCards` (sold/redeemed/refunded/circulating/expired), cột `Thẻ quà tặng` `•••• last4` trong CSV, job `gift-card-expiry` (lock + heartbeat, expire ledger idempotent), retention xoá `sealedCode` sau `sealedCodeHours`, alert `gift-card-probing` mở 1 lần/IP + escalate, `gift-card-report.mjs` |
| 7 | `177d8c2` | API contract, staff guide, runbooks, security baseline, UAT seed (2 thẻ dùng được, 1 khóa, lô giấy 5 thẻ) |
| merge | `5076d2f` | `origin/feat/ordering` (O13): migration 0009b → `0010-o9` → 0012; i18n, alert codes, openapi giữ cả hai |
| fix | `48a05ac` | P0: mail thẻ dùng `recipient: { email }` của O13 — trước đó typecheck lỗi, mail thẻ không gửi |
| merge | `6e27cd8` | `origin/feat/ordering` (O12): `0011-o12` giữa 0010 và 0012; workflow gift-card + dine-in; kind `digital` + `dine-in`; `refundHeldForOrder` giữ thứ tự hoàn thẻ trước |

Lệch kế hoạch:

- Script bước 4 gộp redeem + race: `gift-card-payment.mjs` (kế hoạch tách `gift-card-redeem.mjs` + `gift-card-race.mjs`).
- Audit action đợt thẻ giấy đặt theo thực thể: `gift-card-batch.create/import/export/activate` (kế hoạch ghi `gift-card.batch-create/batch-import`); thêm `gift-card.resend`.
- `gift-card-batch.createdBy` đổi thành `createdByRef` — `createdBy` là tên Strapi dành cho khóa admin user (ghi vào `created_by_id` integer, không phải actor-ref string).
- `issueInTransaction` trả thêm `expiresAt` để response create báo hạn hiệu lực; `unblock` nhận `reason` tuỳ chọn.
- Response `POST /gift-cards` chỉ trả `code` khi không có email người nhận hoặc gửi mail thất bại — nhân viên không bao giờ thấy mã đã gửi qua mail.
- `giftCards.expired` (số dư ghi hết hạn) lọc `expire` ledger theo `created_at` ngày UTC — ledger không có
  `business_date`; lệch tối đa ±1 ngày quanh nửa đêm UTC, chấp nhận cho báo cáo theo ngày.
- Alert `gift-card-probing` đếm cả lượt gọi khi IP đã bị 429 — một đợt dò mã vượt `criticalThreshold`
  (mặc định 60) vẫn escalate dù limiter `max` chặn sớm hơn; bộ đếm in-memory theo chung cửa sổ limiter,
  restart process reset cả hai.

Targeted gates đã chạy (đến hết bước 6, `ORDERING_TEST_DATABASE=salanca_ordering_o9`):

- `pnpm run lint` — pass; `pnpm run typecheck` — pass; `pnpm run typecheck:admin` — pass.
- `pnpm exec vitest run src/plugins/ordering` — 63 files / 666 tests pass.
- `pnpm run build:ordering` — pass; `ORDERING_ENABLED=true pnpm exec strapi build` — pass.
- `node scripts/ordering/schema.mjs` — pass (54 tables, migration `0010-o9-gift-cards`).
- `node scripts/ordering/gift-card-ledger.mjs` — pass (200 ops, 123 ledger rows, invariant giữ).
- `node scripts/ordering/gift-card-sale.mjs` — pass.
- `node scripts/ordering/gift-card-payment.mjs` — pass.
- `node scripts/ordering/gift-card-admin.mjs` — pass (403 gates, masked detail/search, issue mailed/handover, block→public invalid, extend/adjust, resend, batch generate/import/export, change-log không rò mã).
- `node scripts/ordering/email-templates.mjs` — pass; `node scripts/ordering/audit-log.mjs` — pass; `node scripts/ordering/admin-orders.mjs` — pass.
- `node scripts/ordering/openapi.mjs --write` — pass (115 admin paths).
- `node scripts/ordering/gift-card-report.mjs` — pass (sold/redeemed/circulating/expired tách khỏi doanh thu món; chốt tiền mặt chỉ tính `cash`; CSV `•••• last4` không rò mã; job expire 1 lần, chạy lại no-op; retention xoá seal giữ HMAC; alert dò mã 1 dòng/IP, escalate critical).
- `node scripts/ordering/reports.mjs`, `cash-closing.mjs`, `order-export.mjs`, `gift-card-payment.mjs`, `jobs.mjs`, `alerts-engine.mjs`, `data-rights.mjs` — pass (regression sau bước 6).

### Review fixes (2026-10-14)

Test đỏ trên code cũ, xanh sau khi sửa (DB test `salanca_ordering_o9`).

| Lỗi | Sửa | Test | Commit |
| --- | --- | --- | --- |
| P1 Mã quét ở quầy lưu dạng rõ trên đơn/group, hiện ở chi tiết đơn | Create đổi mã sang id thẻ, lưu `physicalCardIds`; mã không bao giờ được lưu | `gift-card-sale.mjs` (JSON đơn + chi tiết admin không có mã) | `d28b7c7` |
| P1 Hoàn tiền đơn bán thẻ ra tiền mặt khi thẻ còn giá trị | Đơn `digital` có thẻ đã phát chỉ hoàn phần vượt mệnh giá thẻ; còn lại `GIFT_CARD_NOT_ALLOWED` (`card-sale-refund`) | `gift-card-sale.mjs` (hoàn cả đơn bị chặn, trả dư 50k hoàn được) | `890a5fc` |
| P1 Hủy món lỗi khi thẻ trả một phần đơn | Chia khoản hoàn theo từng payment (thẻ trước), mỗi phần giới hạn bởi phần còn lại của payment đó | `gift-card-payment.mjs` (thẻ 30k + tiền mặt 80k, hủy 45k → 30k/15k) | `ce6d512` |
| P1 Seal thẻ giấy chưa bán không bao giờ xóa; export lộ mã thẻ đã bán | Purge theo `created_at` khi `issued_at` NULL; export chỉ giải mã thẻ `inactive` | `gift-card-report.mjs`, `gift-card-admin.mjs` | `73f087e` |
| P1 Giảm giá áp khi mua thẻ | Khuyến mãi theo đơn không khớp giỏ `digital`; khuyến mãi theo món/danh mục thẻ vẫn áp (đúng plan bước 3); giảm tay bị từ chối | `evaluate.test.ts`, `gift-card-sale.mjs` | `d28b7c7` |
| P2 Báo cáo đếm tiền thẻ hai lần | Đơn `digital` ra khỏi orders/gross/revenue/refunded; doanh thu tính lúc thẻ được dùng; dòng theo provider vẫn là tiền thực nhận | `gift-card-report.mjs` (doanh thu 130k, không phải 330k) | `8102b9a` |
| P2 Dò mã: quote trả last4 cho thẻ khóa | `last4: null` cho mọi kết quả `invalid` | `gift-card-payment.mjs` — đỏ chỉ suy luận: script cũ fail ở bước hủy món trước khi tới đây | `2b4e9bb` |
| P2 Dò mã: cart checkout không đếm mã sai | Dùng chung ngân sách mã sai theo IP, alert, 429 | `cart-checkout.mjs` | `2b4e9bb` |
| P2 Dò mã: `GET /gift-cards?q=<mã đầy đủ>` | Trả 400, mã đầy đủ chỉ qua `POST /gift-cards/search` | `gift-card-admin.mjs` — đỏ chỉ suy luận, như trên | `73f087e` |
| P2 Lượt quét lỗi làm kẹt đơn đã trả | Create kiểm quét trùng, mệnh giá theo thứ tự món (consumer `ORDER BY ol.id`), thẻ đang nằm trong đơn sống khác (advisory lock theo thẻ; đơn hủy/hết hạn/xóa nhả thẻ) | `gift-card-sale.mjs` (mệnh giá, trùng, 2 draft tranh 1 thẻ, xóa draft nhả thẻ) — đỏ suy luận từ test cũ (mismatch chỉ lỗi lúc phát) | `d28b7c7` |

Quyết định mặc định trong code (chờ chủ dự án xác nhận):

- Doanh thu thẻ tính lúc dùng (deferred revenue); bán thẻ là `giftCards.sold`, không phải doanh thu món.
- Thẻ giấy phải in trong `sealedCodeHours` (24h) sau khi tạo lô; bán sau đó thì không có mail mã (khách
  đã cầm thẻ). Seal của thẻ giấy đã kích hoạt xóa theo `issued_at` như thẻ bán online.
- `refund-line` của hủy món chia nhiều payment lặp lại số lượng mỗi phần; chỉ số tiền cộng lại đúng
  (không chỗ nào đọc lại số lượng refund-line).

Gates sau review fixes: targeted — `lint`, `typecheck`, `typecheck:admin`, `vitest run src/plugins/ordering` 769/769,
`build:ordering`, `ORDERING_ENABLED=true strapi build`, `openapi.mjs --write` (139 path). Script PASS:
`gift-card-ledger` `gift-card-sale` `gift-card-payment` `gift-card-admin` `gift-card-report` `cart-checkout`
`reports` `promotions` `cash-closing` `payment-refund` `create-order` `schema` `registry-boot` `data-rights`
`email-templates` `audit-coverage` `notifications` `sms` `zalo-zns` `momo` `vnpay` `wallet-status`
`customer-auth` `storefront` `order-edit` `ahamove` `sepay-match` `sepay-manual` `sepay-refund` `dine-in`
`auto-reject` `fees` `print` `kds` `pause` `allergens` `delivery-assignment` `cart` `cart-promotion`.
