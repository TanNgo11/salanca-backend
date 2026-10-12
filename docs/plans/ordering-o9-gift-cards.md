# O9 — Thẻ quà tặng (bán thẻ có số dư, dùng thẻ để thanh toán)

Status: Draft
Owner: tan_ngo (duyệt), AI thực hiện
Last updated: 2026-10-12
Related phase: chưa có spec — viết `docs/phases/phase-ordering-9-gift-cards.md` khi plan này được duyệt

## Goal

Khách mua thẻ quà tặng (mệnh giá cố định) như một món; trả tiền xong hệ thống phát mã và gửi email.
Người nhận dùng mã để trả một phần hoặc toàn bộ đơn; số dư còn lại dùng tiếp. Quán tra cứu, khóa, gia
hạn, phát thẻ tặng; báo cáo tách tiền bán thẻ (nợ phải trả) và tiền dùng thẻ (doanh thu).

Chủ dự án chọn làm cả mã giảm giá (O8) và thẻ quà tặng (O9) — 2026-10-12.

## Non-goals

- Mã giảm giá/khuyến mãi (O8). Thẻ quà tặng không phải giảm giá: là cách thanh toán.
- Mệnh giá tự chọn, nạp thêm tiền vào thẻ, chuyển số dư giữa thẻ, đổi thẻ ra tiền mặt.
- Thẻ dùng ở POS tại quán ngoài plugin (chỉ dùng cho đơn online và đơn nhân viên tạo hộ).
- Hóa đơn điện tử (chờ kế toán).

## Current evidence

- Contracts §10: voucher là product type + fulfillment module; `VoucherProvider { issue, redeem,
  refundUnused, getStatus }`; mã hash, chống đoán, lock khi redeem; thời điểm ghi doanh thu và hoàn thẻ
  chưa dùng là quyết định của chủ dự án. §5 `productType: 'voucher'`; §9 bảng `voucher` /
  `voucher-redemption`; outbox event `voucher.issued`.
- Thanh toán: registry `registerPaymentProvider` (cash, sepay); `services/payment.ts` (create/capture),
  `services/refund.ts`; một đơn có nhiều payment được (projection `paymentStatus`).
- Product type: `registerProductType(foodProductType)`; catalog O2 (`catalog-product`, variant = mệnh giá).
- Bảo mật storefront: captcha, rate limit, token mã hóa (`domain/token-cipher.ts`), hash
  (`domain/hashing.ts`).
- Báo cáo/chốt tiền O6 đọc payment theo `provider_code` — thẻ là provider riêng nên tách được.

## Decisions and assumptions

- Decision: bán thẻ = món thuộc product type `gift-card` (mệnh giá = variant). Không áp mã giảm giá O8
  cho món thẻ (mặc định; đổi được bằng điều kiện promotion).
- Decision: dùng thẻ = payment provider `gift-card`; thẻ trả trước phần còn lại trả bằng cash/SePay theo
  workflow của đơn. Không dùng thẻ để mua thẻ.
- Decision: phát mã **sau khi tiền bán thẻ đã captured**; đơn chỉ có thẻ thì không qua bếp (workflow
  riêng: thanh toán → phát mã → xong).
- Decision: mã 16 ký tự (bỏ ký tự dễ nhầm), lưu `sha256` + 4 ký tự cuối để tra; mã đầy đủ chỉ hiện
  một lần trong email/trang đơn của người mua.
- Decision: trừ số dư bằng `UPDATE … SET balance = balance - n WHERE balance >= n` trong transaction tạo
  đơn (giữ chỗ), hoàn lại khi đơn hủy/hết hạn; mọi thay đổi ghi `gift-card-ledger` (append-only).
- Owner decision required: **hạn dùng** — đề xuất 12 tháng từ ngày phát; kế toán/pháp lý xác nhận.
- Owner decision required: **kế toán** — xuất hóa đơn lúc bán thẻ hay lúc dùng; số dư hết hạn xử lý
  thế nào. Báo cáo O9 tách sẵn hai dòng để khớp lựa chọn nào cũng được.
- Owner decision required: **thẻ giấy bán ở quầy** — nếu có, thêm nhập lô mã (CSV) + kích hoạt khi bán.
- Owner decision required: hoàn đơn mua thẻ khi thẻ **chưa dùng** — cho hoàn tiền (khóa thẻ) hay không.

## Invariants

- Số dư không âm; Σ ledger = số dư hiện tại; hai đơn dùng cùng thẻ cùng lúc không trừ quá số dư.
- Không lưu mã gốc; log không có mã, chỉ 4 ký tự cuối.
- Thử mã sai bị giới hạn theo IP và theo phiên, có captcha; lỗi không phân biệt "mã không tồn tại" với
  "mã bị khóa".
- Hoàn tiền phần trả bằng thẻ quay về số dư thẻ, không ra tiền mặt.
- Chốt tiền mặt O6 không tính tiền thẻ.

## Implementation steps

1. **Dữ liệu thẻ**
   - Files: content type `gift-card` (codeHash unique, last4, `initialAmount`, `balance`, currency,
     `status active|blocked|expired`, `expiresAt`, `issuedFromOrder/line`, `issuedBy`, `note`),
     `gift-card-ledger` (card, kind `issue|reserve|release|capture|refund|adjust|expire`, amount, order,
     payment, actorRef, at, reason); migration `0007-o9-*` (unique hash, check `balance >= 0`).
     Quyền mới `gift-card.manage`.
   - Verification: `schema.mjs`; unit test sinh mã (độ dài, bảng chữ, không trùng trong 100k).
2. **Bán thẻ**
   - Files: product type `gift-card` (`providers/product-types/gift-card.ts`), workflow
     `gift-card-prepay` (thanh toán → phát → xong, không fulfillment group bếp), `services/gift-card.ts`
     `issue` gọi khi payment captured (consumer outbox `payment.captured`), email "Thẻ quà tặng của bạn"
     VI/EN (người nhận = email người mua hoặc email người nhận nhập lúc đặt).
   - Verification: script `gift-card-sale.mjs`: mua 2 thẻ qua SePay giả → 2 mã, email gửi một lần,
     replay webhook không phát thêm.
3. **Dùng thẻ để thanh toán**
   - Files: provider `providers/gift-card.ts` (authorize = reserve, capture, refund về số dư);
     `parse.ts` nhận `giftCardCode`; quote trả `giftCard: { last4, applied, remainingBalance }`;
     storefront rate limit + captcha cho mã sai; tạo đơn: reserve trong transaction, phần còn lại theo
     payment của đơn; hủy/hết hạn → release; hoàn → ledger `refund`.
   - Verification: script `gift-card-redeem.mjs`: thẻ 200k trả đơn 150k còn 50k; đơn 300k dùng thẻ 50k +
     tiền mặt 250k; 2 đơn tranh số dư → một thắng; hủy trả số dư; mã sai 10 lần → bị chặn; thẻ hết hạn
     → lỗi; không dùng thẻ mua thẻ.
4. **Admin thẻ quà tặng**
   - Files: trang "Thẻ quà tặng" (tra theo 4 số cuối/mã đầy đủ/đơn, xem số dư + ledger, khóa/mở, gia
     hạn có lý do, phát thẻ tặng có lý do — ghi change-log), quyền `gift-card.manage`; chi tiết đơn hiện
     payment thẻ (4 số cuối).
   - Verification: script HTTP: thiếu quyền → 403; khóa thẻ → dùng bị từ chối; change-log có dòng.
5. **Báo cáo, chốt tiền, retention, job hết hạn**
   - Files: `reports.ts` tách "Bán thẻ" và "Thanh toán bằng thẻ"; `cash-closing.ts` chỉ `cash` (đã đúng —
     thêm test); CSV thêm cột thẻ (4 số cuối); job `gift-card-expiry` (hằng ngày, ledger `expire`); alert
     khi có nhiều mã sai từ một nguồn (tận dụng alert engine O6, rule mới).
   - Verification: script `gift-card-report.mjs`: tổng báo cáo khớp ledger; chốt tiền mặt không đổi khi
     có đơn trả bằng thẻ.
6. **Tài liệu và UAT**
   - Files: spec + screens + mockup O9 trước khi code UI; API contract (`giftCardCode`, lỗi
     `GIFT_CARD_INVALID|EXPIRED|INSUFFICIENT`), staff guide (bán/tra/khóa thẻ), payments runbook,
     `docs/security-baseline.md` (chống đoán mã), `docs/STATUS.md`, roadmap.

## Data and rollback

- Migration `0007-o9-*`: bảng mới, không đổi bảng cũ.
- Rollback: tắt provider `gift-card` và ẩn món thẻ; thẻ đã phát giữ số dư (nợ với khách) — không xóa.

## Verification

- Automated: lint, typecheck, test, `check:ordering` 2 lượt, `check:phase3` tắt/bật, smoke pickup/sepay/
  delivery, `strapi build` tắt/bật.
- Manual UAT: mua thẻ 200k bằng SePay thật (giao dịch nhỏ) → nhận email mã → đặt đơn 150k bằng thẻ → hủy
  → số dư về 200k → đặt lại + trả thêm tiền mặt.

## Documentation impact

- Spec/screens/mockup O9, API contract, staff guide, payments runbook, security baseline, `docs/STATUS.md`,
  roadmap.

## Risks and blockers

- Quyết định kế toán (doanh thu, hóa đơn) và pháp lý (hạn dùng) chặn go-live thẻ, không chặn code.
- Mã thẻ là tiền: lộ mã = mất tiền của khách. Không log mã, giới hạn thử sai, cho khóa thẻ nhanh.
- Phụ thuộc web OW cho khách mua và nhập mã.

Ước lượng thô: khoảng 2 tuần (bước 1: 1–2 ngày; 2: 3 ngày; 3: 3–4 ngày; 4: 2 ngày; 5: 2 ngày; 6: 1–2 ngày).

## Completion record

- Chưa bắt đầu.
