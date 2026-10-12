# O8 — Khuyến mãi (mã giảm giá, khuyến mãi tự động) và đánh giá đơn

Status: Draft
Owner: tan_ngo (duyệt), AI thực hiện
Last updated: 2026-10-12
Related phase: chưa có spec — viết `docs/phases/phase-ordering-8-promotions-rating.md` khi plan này được duyệt

## Goal

1. **Khuyến mãi:** quán tạo mã giảm giá (khách nhập lúc đặt) và khuyến mãi tự động (tự áp khi đủ điều
   kiện): giảm % hoặc số tiền, miễn/giảm phí giao, có điều kiện (đơn tối thiểu, chi nhánh, cách nhận,
   khung giờ, món/danh mục), giới hạn lượt dùng; server tính tiền, chia giảm giá xuống dòng món để hủy
   món/hoàn tiền vẫn đúng.
2. **Đánh giá đơn:** khách chấm 1–5 sao + chọn nhãn + ghi chú sau khi nhận đơn; quán xem, lọc, trả lời
   nội bộ; điểm trung bình vào báo cáo; đánh giá thấp báo quản lý chi nhánh.

## Non-goals

- **Thẻ quà tặng / voucher bán ra có số dư** (contracts §10 `VoucherProvider`, product type `voucher`):
  là sản phẩm bán, khác mã giảm giá. Để module sau nếu chủ dự án cần (xem quyết định bên dưới).
- Tích điểm, hạng thành viên, tài khoản khách; giới thiệu bạn bè.
- Combo/mua X tặng Y phức tạp (bundle pricing) — v1 chỉ giảm theo món/danh mục; "tặng món" để sau.
- Đánh giá công khai trên web, trả lời công khai, đánh giá từng món.
- Hóa đơn điện tử/VAT cho phần giảm giá (chờ kế toán; pipeline đã có cờ `taxable` cho adjustment).

## Current evidence

- Pricing: `domain/pricing/pipeline.ts` nhận `adjustments: { kind: 'discount'|'fee'|'rounding', code,
  label, amount|percent, priority, sourceRef, ruleSnapshot }`, chia adjustment xuống dòng theo largest
  remainder (`allocation.ts`), lưu `order-adjustment` + `adjustment-allocation`. **Chưa** có cách giới
  hạn một adjustment vào một số dòng (giảm theo món/danh mục).
- Hủy món/hoàn: `line-cancel.ts`, `refund-amount.ts` dùng phần đã phân bổ — giảm giá chia đúng thì hoàn
  đúng.
- Phí giao: `domain/delivery/zones.ts` rule theo subtotal (`freeFrom`), nằm trong `fulfillmentAmount`.
- Đặt đơn công khai: `services/storefront.ts` + `domain/storefront/parse.ts` (quote và create cùng
  input), captcha Turnstile, rate limit (`domain/rate-limit.ts`), token đơn `X-Order-Token` cho tra cứu
  và hủy (`POST /orders/cancel`).
- Contracts §3/§5 dự kiến `sourceRef` cho promotion ngoài core; §10 thiết kế voucher bán ra.
- Báo cáo O6: `services/reports.ts` (thêm cột giảm giá/khuyến mãi được); alert engine O6
  (`services/alert.ts`, rule theo người nhận).

## Decisions and assumptions

- Decision: khuyến mãi là module trong plugin, xuất adjustment `kind: 'discount'` cho pipeline;
  `sourceRef = promotion:<id>`, `ruleSnapshot` lưu điều kiện lúc áp (đổi khuyến mãi không sửa đơn cũ).
- Decision: v1 mỗi đơn tối đa **1 mã** + các khuyến mãi tự động có cờ `stackable`; thứ tự áp theo
  `priority`; tổng giảm không vượt subtotal (phí giao xử lý riêng).
- Decision: lượt dùng giữ (reserved) lúc tạo đơn trong cùng transaction, khóa dòng promotion
  (`FOR UPDATE`); trả lại khi đơn hủy/hết hạn/từ chối. Giới hạn theo khách dùng khóa
  `sha256(số điện thoại chuẩn hóa)` — không lưu số điện thoại thô trong redemption.
- Decision: đánh giá gắn 1–1 với đơn, gửi bằng token đơn, chỉ khi đơn `completed`, trong N ngày (mặc
  định 7), sửa được trong 24 giờ.
- Owner decision required: "voucher" chủ dự án muốn là **mã giảm giá** (plan này) hay **thẻ quà tặng
  bán ra có số dư** (module khác, §10)? Chặn trước bước 1.
- Owner decision required: hủy bớt món làm đơn không còn đủ điều kiện (dưới đơn tối thiểu của mã) —
  (đề xuất) giữ giảm giá đã áp, hoàn theo phần đã phân bổ; hoặc tính lại và bỏ mã.
- Owner decision required: đánh giá thấp (≤ 2 sao) có gửi email quản lý chi nhánh không (đề xuất có,
  qua alert engine O6, rule `low-rating`).
- Assumption: web đặt món (OW) sẽ thêm ô nhập mã và trang đánh giá; O8 chỉ làm API + Admin. Email
  "Mời đánh giá" chứa link tới trang đơn trên web (`orderLinkTemplate`).

## Invariants

- Giảm giá luôn tính ở server; client chỉ gửi mã. Quote và create cho cùng kết quả với cùng input/giờ.
- Không vượt giới hạn lượt dùng khi nhiều đơn đặt cùng lúc.
- Σ allocation của một giảm giá = số giảm; hủy món/hoàn tiền dùng phần đã phân bổ.
- Đoán mã bị chặn: rate limit theo IP + captcha như đặt đơn; lỗi mã không nói mã có tồn tại hay không
  ngoài các lý do công khai (hết hạn, chưa đủ điều kiện).
- Đánh giá không lộ thông tin đơn khác; nội dung đánh giá là dữ liệu cá nhân — không log, có trong
  job retention O6.

## Implementation steps

1. **Pipeline: giảm giá theo dòng được chọn**
   - Files: `domain/pricing/pipeline.ts`, `allocation.ts` — thêm `eligibleLines?: number[]` vào
     `PricingAdjustmentInput`; percent tính trên subtotal của các dòng đó; allocation chỉ chia vào các
     dòng đó. Property test giữ bất biến tổng.
   - Verification: `pipeline.property.test.ts` thêm trường hợp eligible; `pnpm run test`.
2. **Dữ liệu khuyến mãi**
   - Files: content type `promotion` (tên VI/EN, `kind: code|auto`, `discountType: percent|amount|
     delivery-fee`, `value`, `maxDiscount`, `minSubtotal`, `validFrom/To`, `weekdays`, `timeRanges`,
     `locationRefs | all`, `receiveKinds`, `productRefs/categoryRefs`, `usageLimit`, `perCustomerLimit`,
     `stackable`, `priority`, `active`), `promotion-code` (code chữ hoa, unique, thuộc promotion; sinh
     hàng loạt), `promotion-redemption` (promotion, code, order, customerKey hash, amount, status
     `reserved|applied|released`); migration `0006-o8-*` (unique code, index redemption). Quyền mới
     `promotion.manage`.
   - Verification: `schema.mjs`; unit test validate (percent 1–100, ngày hợp lệ).
3. **Bộ máy áp khuyến mãi**
   - Files: `domain/promotions/evaluate.ts` (thuần: đơn nháp + danh sách promotion → adjustments + lý
     do không áp), `services/promotion.ts` (nạp promotion đang hiệu lực theo chi nhánh/giờ, kiểm lượt,
     reserve/release redemption), nối vào `order.prepareOrder` (quote + create). Miễn/giảm phí giao:
     adjustment `discount` gắn vào phần phí (dòng phí) hoặc giảm `fulfillmentAmount` — chọn khi làm,
     ghi Completion record. Mã lỗi: `PROMOTION_INVALID`, `PROMOTION_EXPIRED`,
     `PROMOTION_NOT_ELIGIBLE` (+ `details.reason`), `PROMOTION_EXHAUSTED`.
   - Verification: unit test evaluate (từng điều kiện, stack, giới hạn tổng giảm); script
     `promotions.mjs`: quote có mã = create; 2 đơn tranh lượt cuối → một thắng; hủy đơn trả lượt;
     per-customer theo số điện thoại; hủy bớt món hoàn đúng phần đã phân bổ.
4. **API công khai và Admin khuyến mãi**
   - Files: `parse.ts` nhận `promotionCode`; quote trả `promotions: [{ code, label, amount }]` và
     `rejected: [{ code, reason }]`; rate limit riêng cho lỗi mã. Admin: trang "Khuyến mãi" (danh sách,
     tạo/sửa, sinh mã, bật/tắt, thống kê lượt dùng và tổng giảm), change-log. Báo cáo O6 thêm cột/nhóm
     "Giảm giá theo khuyến mãi"; CSV thêm cột mã.
   - Verification: script HTTP (thiếu `promotion.manage` → 403; nhân viên chi nhánh chỉ thấy khuyến mãi
     của chi nhánh mình nếu áp scope); `check:ordering`.
5. **Đánh giá đơn**
   - Files: content type `order-rating` (order 1–1, `stars` 1–5, `tags` (đúng giờ, ngon, đóng gói,
     người giao…), `comment` ≤ 1000, `locale`, `status visible|hidden`, `staffNote`, `ratedAt`,
     `editableUntil`); `services/rating.ts`; route công khai `POST/GET /orders/rating` (`X-Order-Token`,
     captcha, rate limit); Admin trang "Đánh giá" (lọc chi nhánh/sao/ngày, ẩn, ghi chú nội bộ); báo cáo
     thêm điểm TB và số đánh giá theo chi nhánh; email "Mời đánh giá" sau `completed` (template VI/EN,
     gửi một lần); alert `low-rating` nếu chủ dự án đồng ý; retention xóa `comment` sau thời hạn cấu hình.
   - Verification: script `rating.mjs`: đơn chưa xong → 409; token sai → 401; gửi 2 lần → sửa trong
     24 giờ, sau đó 409; nhân viên ngoài scope không thấy (404); báo cáo TB đúng.
6. **Tài liệu và UAT**
   - Files: spec + screens + mockup O8 trước khi code UI; `ordering-api-contract.md` (`promotionCode`,
     lỗi khuyến mãi, rating), staff guide (tạo khuyến mãi, xem đánh giá), `docs/STATUS.md`, roadmap.

## Data and rollback

- Migration `0006-o8-*`: content type mới + index; không đổi cột cũ. Đơn cũ không có redemption.
- Rollback: tắt mọi promotion (`active=false`) → quote không áp; ẩn trang bằng quyền. Đơn đã áp giữ
  nguyên adjustment (đã thành sổ).

## Verification

- Automated: lint, typecheck, test, `check:ordering` 2 lượt, `check:phase3` tắt/bật, smoke pickup/sepay/
  delivery, `strapi build` tắt/bật.
- Manual UAT: tạo mã 10% tối đa 30.000đ cho đơn từ 100.000đ ở Q1 → đặt đơn dùng mã → hủy một món → hoàn
  đúng; khuyến mãi tự động miễn phí giao; khách gửi đánh giá 2 sao → quản lý nhận email.

## Documentation impact

- Spec/screens/mockup O8, API contract, staff guide, report docs, `docs/STATUS.md`, roadmap,
  `docs/security-baseline.md` (rate limit mã, dữ liệu đánh giá).

## Risks and blockers

- Lạm dụng mã (đoán mã, dùng nhiều số điện thoại) — rate limit + giới hạn per-customer chỉ giảm rủi ro;
  mã giá trị lớn nên là mã dùng một lần.
- Kế toán có thể yêu cầu cách ghi giảm giá trên hóa đơn điện tử — chờ quyết định VAT.
- Phụ thuộc OW để khách thật sự dùng mã và gửi đánh giá.

Ước lượng thô: 2–3 tuần (bước 1: 2 ngày; 2–3: 5–6 ngày; 4: 3–4 ngày; 5: 3–4 ngày; 6: 2 ngày).

## Completion record

- Chưa bắt đầu.
