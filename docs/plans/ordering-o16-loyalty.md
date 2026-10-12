# O16 — Tích điểm và hạng thành viên: kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt + chốt tham số chương trình), AI thực hiện
Last updated: 2026-10-12
Related phase: [`phases/phase-ordering-16-loyalty.md`](../phases/phase-ordering-16-loyalty.md)

Mockup: [`mockups/ordering-o16-loyalty.html`](mockups/ordering-o16-loyalty.html). Đặc tả màn hình ở mục cuối.

## Goal

Tích điểm khi hoàn tất, dùng điểm ở checkout, hạn điểm theo lô, hạng theo chi tiêu 12 tháng gắn quyền lợi.

## Non-goals

- Đổi quà, chuyển điểm, điểm cho hành động khác, đối tác, thẻ vật lý.

## Current evidence (sau khi O8, O11, O14 xong — kiểm lại khi bắt đầu)

- Pipeline O8: adjustment `discount` với `target` (`order|lines|fulfillment`), allocation largest remainder; khuyến mãi xuất
  adjustment `sourceRef = promotion:<id>`.
- O11: `customer` (`status` active/unverified, `orderCount`, `totalSpent`), phiên `X-Customer-Token`, consumer cập nhật thống kê khi
  đơn `completed`, mẫu email sửa được (O10).
- O14: `customer-group` + `customer.groups`, giá nhóm khi tính giá.
- O9: payment `gift-card` (để loại khỏi cơ sở tích); O12: `order.tipAmount`, phí `fee` (loại khỏi cơ sở).
- Refund: `services/refund.ts`, `refundHeld`, `line-cancel.ts`; transition terminal `canceled`/`completed` có outbox
  `fulfillment-group.transitioned`.
- O15: danh mục thao tác change-log; alert engine O6.

## Decisions and assumptions

- Decision: cơ sở tích = Σ `lineTotalAmount` của dòng còn hiệu lực (đã trừ giảm giá khuyến mãi **và** điểm) — tức tiền món khách
  thật trả; không gồm phí giao/phí dịch vụ/tip/thuế (nếu thuế cộng ngoài)/dòng thẻ quà tặng.
- Decision: điểm = `floor(cơ sở / earnUnit) × multiplier(hạng)`; `earnUnit` mặc định 10.000đ (1 điểm/10.000đ) — chờ chốt.
- Decision: 1 điểm = `pointValue` đồng (mặc định 1.000đ); dùng tối thiểu `minRedeem` điểm (mặc định 10); tối đa `maxRedeemPercent`
  (mặc định 50%) tạm tính sau khuyến mãi; bước dùng 1 điểm.
- Decision: dùng điểm = adjustment `discount` `sourceRef = loyalty`, `target: order` (chia xuống dòng), áp **sau** khuyến mãi.
  Giữ điểm khi tạo đơn (`redeem` vào sổ); đơn về terminal `canceled` → `release` trả đủ; hủy bớt món: hoàn tiền theo phân bổ (gồm
  phần giảm do điểm), **không** trả điểm (đơn vẫn còn) — đơn giản, khớp O8.
- Decision: điểm tích theo **lô** (`loyalty-lot`: số điểm, còn lại, hạn); dùng lô sắp hết hạn trước (FIFO theo hạn); trả lại điểm
  dùng → tạo lô hoàn với hạn của lô gốc (hoặc 30 ngày nếu lô gốc đã hết hạn).
- Decision: hoàn tiền sau khi đã tích → `reverse` điểm = floor(tiền hoàn của dòng món / earnUnit) × hệ số đã dùng lúc tích, trừ vào
  lô của đơn đó trước, thiếu thì trừ số dư (cho phép âm, chặn dùng khi âm).
- Decision: hạng xét theo chi tiêu 12 tháng gần nhất (Σ cơ sở tích của đơn `completed` trừ hoàn); lên hạng tức thì; job hằng ngày
  xuống hạng nếu dưới mốc quá `graceDays` (30). Hạng gắn `customerGroupCode` (O14) — đổi hạng thì đổi nhóm.
- Decision: O8 thêm điều kiện khuyến mãi `tiers` (chỉ hạng chọn) — sửa nhỏ trong `evaluate`.
- Decision: quyền `loyalty.manage` (cấu hình, hạng), `loyalty.adjust` (điều chỉnh điểm); xem điểm khách: `customer.read`.
- Owner decision required: `earnUnit`, `pointValue`, `maxRedeemPercent`, `minRedeem`, hạn điểm (đề xuất 12 tháng), mốc/hệ số/tên
  hạng, giới hạn điểm/ngày, có tích cho đơn tại bàn/đơn hộ không (đề xuất có nếu khách đăng nhập/xác định được).
- Assumption: thuế đang tính trong giá (VN thường niêm yết gồm VAT) → cơ sở là tiền món; nếu thuế cộng ngoài thì loại thuế.

## Invariants

- Số dư = Σ sổ điểm; mỗi lô `remaining ≥ 0`, Σ remaining các lô còn hạn = số dư dương.
- Một đơn tích tối đa một lần (unique `(order, kind=earn)`); một đơn dùng điểm tối đa một lần.
- Hai đơn song song không dùng quá số điểm (khóa dòng khách `FOR UPDATE` theo thứ tự).
- Sổ append-only; điều chỉnh tay có lý do + log O15.

## Data model

| Bảng / field | Mô tả |
| --- | --- |
| settings `loyalty` | `enabled`, `earnUnit`, `pointValue`, `minRedeem`, `maxRedeemPercent`, `expiryMonths`, `dailyEarnCap?`, `expiryReminderDays` (14), `channels` (receive kinds tích được) |
| `loyalty-tier` | `code`, `name` {vi,en}, `minSpend12m`, `multiplier` (×100, ví dụ 150 = 1,5×), `customerGroupCode?`, `rank`, `active` |
| `customer` thêm | `pointsBalance` int, `tier?` relation, `tierSince?`, `spend12m` (cache), `tierBelowSince?` |
| `loyalty-lot` | `customer`, `order?`, `source` earn\|restore\|adjust, `points`, `remaining`, `expiresAt`, `createdAt` |
| `loyalty-ledger` | `customer`, `kind` earn\|redeem\|release\|reverse\|expire\|adjust, `points` (có dấu), `balanceAfter`, `order?`, `lot?`, `actorRef`, `reason?`, `at`; unique partial `(order_id) WHERE kind='earn'`, `(order_id) WHERE kind='redeem'` |

Migration (số theo thứ tự khi làm): bảng + cột + index `(customer_id, expires_at) WHERE remaining > 0`.

## API

Công khai (khách đăng nhập O11):

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `/api/v1/ordering/me/loyalty` | `{ balance, tier, nextTier: { name, missing }, expiringSoon: [{ points, expiresAt }] }` |
| GET | `/api/v1/ordering/me/loyalty/history?page=` | sổ điểm (không chi tiết nội bộ) |
| POST | `/api/v1/ordering/quote`, `/orders`, `/carts/current` (đã có) | thêm `redeemPoints?: number`; quote trả `loyalty: { redeemable: { max, value }, applied, earnPreview }` |

Admin:

| Method | Path | Quyền | Mô tả |
| --- | --- | --- | --- |
| GET/PUT | `/ordering/loyalty/settings` | `loyalty.manage` | cấu hình chương trình |
| GET/POST/PUT | `/ordering/loyalty/tiers[/:id]` | `loyalty.manage` | hạng |
| GET | `/ordering/customers/:id/loyalty` | `customer.read` | số dư, lô, sổ |
| POST | `/ordering/customers/:id/loyalty/adjust` | `loyalty.adjust` | `{ points (±), reason, expiresAt? }` |
| GET | `/ordering/reports/loyalty?from=&to=&branch=` | `report.read` | phát/dùng/hết hạn/đảo, lưu hành × giá trị |

Lỗi mới: `LOYALTY_DISABLED` 400, `LOYALTY_INSUFFICIENT` 409 (`details.balance`), `LOYALTY_REDEEM_INVALID` 400
(`details.reason`: `below-minimum` \| `over-cap` \| `not-verified` \| `negative-balance`), `LOYALTY_NOT_LOGGED_IN` 401.

## Implementation steps

1. **Hàm thuần**
   - Files: `domain/loyalty/earn.ts` (cơ sở + điểm), `redeem.ts` (tối đa dùng, giá trị), `lots.ts` (FIFO tiêu lô, trả lô), `tier.ts`
     (xét hạng + ân hạn); test bảng giá trị + property test (tiêu rồi trả lô giữ Σ).
   - Verification: `pnpm run test`.
2. **Dữ liệu, quyền, cấu hình**
   - Files: content type, migration, settings schema, `register.ts` (`loyalty.manage`, `loyalty.adjust`), mã O15 (`loyalty.*`).
   - Verification: `schema.mjs`.
3. **Tích + đảo**
   - Files: `services/loyalty.ts` (`earnForOrder` — consumer khi group `completed`, khóa khách, unique earn; `reverseForRefund` — gọi
     từ `refund.settle`/`createRefundInTransaction` khi `settled` và đơn đã tích), cập nhật `spend12m`, lên hạng tức thì.
   - Verification: `scripts/ordering/loyalty-earn.mjs`: ca tích/đảo trong spec; replay outbox không tích hai lần.
4. **Dùng điểm**
   - Files: `prepareOrder` (adjustment `loyalty` sau khuyến mãi; quote trả `loyalty`), `createOrder` (khóa khách, tiêu lô, ghi
     `redeem`), terminal `canceled` → `release`, `parse.ts` (`redeemPoints`), giỏ O11.
   - Verification: `scripts/ordering/loyalty-redeem.mjs` + `loyalty-race.mjs` (2 process + barrier).
5. **Hạn điểm + hạng + email**
   - Files: `jobs/loyalty-expiry.ts`, `jobs/loyalty-tiers.ts` (hằng ngày), mẫu email `customer.points-expiring`, `customer.tier-up`
     (O10 sửa được), gắn/bỏ nhóm O14 theo hạng, điều kiện `tiers` trong O8 `evaluate`.
   - Verification: `scripts/ordering/loyalty-expiry.mjs`, `loyalty-tiers.mjs`.
6. **Admin + báo cáo (Y1–Y4)**
   - Files: `admin/src/pages/Loyalty/` (cấu hình, hạng), tab "Điểm" trong chi tiết khách O11, báo cáo O6 thêm thẻ "Điểm".
   - Verification: script HTTP 403/404; điều chỉnh có log O15.
7. **Tài liệu, gate**
   - Files: staff guide, API contract, `docs/ordering-integrations.md` (webhook `loyalty.*`), STATUS, Completion record.
   - Verification: gate đầy đủ, `check:ordering` 2 lượt.

## Đặc tả màn hình

Quy ước chung như [`ordering-o3-screens.md`](ordering-o3-screens.md); chuỗi trong `translations/o16.ts`; nhóm menu **Khuyến mãi & thẻ**.

### Y1. Chương trình điểm

- Route `/plugins/ordering/loyalty`. Quyền `loyalty.manage`. `Switch` bật chương trình; ô số: "1 điểm cho mỗi … đ", "1 điểm = … đ",
  "Dùng tối thiểu … điểm", "Dùng tối đa …% đơn", "Điểm hết hạn sau … tháng", "Tối đa … điểm/ngày/khách"; tích cho cách nhận
  (nút); câu tóm tắt "Đơn 300.000đ nhận 30 điểm (= 30.000đ khi dùng)". Lưu (log O15).

### Y2. Hạng thành viên (tab trong Y1)

- Bảng: Tên, Chi tiêu 12 tháng từ, Hệ số điểm, Nhóm giá (O14), Số khách, bật. Thêm/sửa trong panel. Ghi chú "Xuống hạng sau 30 ngày
  dưới mốc".

### Y3. Điểm của khách (tab "Điểm" trong chi tiết khách C2 của O11)

- Thẻ: Số dư (quy ra tiền), Hạng + tiến độ, Sắp hết hạn (14 ngày). Bảng lô (điểm, còn lại, hạn, nguồn). Sổ điểm (lúc, loại, điểm ±, số
  dư sau, đơn, người, lý do). Nút "Điều chỉnh điểm" (`loyalty.adjust`; panel ± điểm, lý do bắt buộc, hạn cho điểm cộng).

### Y4. Báo cáo điểm (thẻ trong Báo cáo V4 O6)

- Điểm phát, dùng, hết hạn, đảo trong kỳ; **đang lưu hành** (điểm × giá trị = nợ điểm); số khách theo hạng.

## Data and rollback

- Migration bảng/cột mới. Rollback: `loyalty.enabled=false`; số dư/sổ giữ nguyên.

## Verification

- Automated: lint, typecheck, test, `check:ordering` 2 lượt, `check:phase3` tắt/bật, build tắt/bật.
- Manual UAT: theo spec.

## Documentation impact

- Spec + mockup O16, staff guide, API contract, integrations, STATUS, roadmap.

## Risks and blockers

- Tham số chương trình và điều khoản điểm cần chủ dự án + pháp lý; code cấu hình được, mặc định tắt.
- Tương tác nhiều loại giảm (khuyến mãi, giá nhóm, điểm) → thứ tự cố định: giá nhóm (O14) → khuyến mãi (O8) → điểm (O16); test tổng.

Ước lượng thô: 2–2,5 tuần (1: 2 ngày; 2: 1 ngày; 3: 2 ngày; 4: 3 ngày; 5: 2–3 ngày; 6: 2 ngày; 7: 1 ngày).

## Completion record

- Chưa bắt đầu.
