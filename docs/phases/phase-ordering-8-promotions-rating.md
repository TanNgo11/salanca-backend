# Phase O8 — Khuyến mãi và đánh giá đơn

Trạng thái: spec chờ duyệt (2026-10-12). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Mockup: [`plans/mockups/ordering-o8-promotions-rating.html`](../plans/mockups/ordering-o8-promotions-rating.html).
**Đặc tả màn hình (bắt buộc khi code UI):** [`plans/ordering-o8-screens.md`](../plans/ordering-o8-screens.md) (nghiên cứu UI: reference mục U8).
Kế hoạch thực hiện: [`plans/ordering-o8-promotions-rating.md`](../plans/ordering-o8-promotions-rating.md).
Thiết kế: [`plans/ordering-core-contracts.md`](../plans/ordering-core-contracts.md) (mục 3 adjustment
`sourceRef/ruleSnapshot`, 7 pipeline, 12 alert, 19.2 quyền).

## Goal

Quán chạy được khuyến mãi (mã giảm giá khách nhập và khuyến mãi tự động) mà không phải tính tay, giới
hạn được lượt dùng; khách đánh giá đơn sau khi nhận, quán thấy đánh giá xấu ngay.

## Điều kiện bắt đầu

- O7 đã merge (sửa đơn dùng chung pipeline; O8 giữ khuyến mãi khi sửa đơn).
- Thẻ quà tặng là O9, không thuộc O8 (chủ dự án chọn làm cả hai, 2026-10-12).

## Scope

### Khuyến mãi

- Loại: **mã** (khách nhập) và **tự động** (tự áp khi đủ điều kiện).
- Kiểu giảm: phần trăm (có trần), số tiền cố định, miễn phí giao, giảm số tiền phí giao.
- Phạm vi giảm: cả đơn, hoặc chỉ các món/danh mục chọn.
- Điều kiện: tạm tính tối thiểu, chi nhánh, cách nhận (tự lấy/giao), thời gian hiệu lực, ngày trong tuần,
  khung giờ, đơn đầu tiên của số điện thoại.
- Giới hạn: tổng lượt, lượt mỗi khách (theo số điện thoại), mã dùng một lần (sinh hàng loạt).
- Cộng dồn: mỗi đơn tối đa 1 mã; khuyến mãi có cờ "cộng dồn"; không cộng dồn thì chọn phương án giảm nhiều nhất.
- Server tính, chia số giảm xuống dòng món (giảm phí giao không chia xuống món); giữ lượt khi tạo đơn, trả
  lại khi đơn hủy/từ chối/hết hạn. Hủy bớt món và sửa đơn **giữ** khuyến mãi đã áp (quyết định 2026-10-12).
- Admin: danh sách, tạo/sửa, mã (sinh hàng loạt, xuất CSV, tắt mã), thống kê lượt và tổng giảm; báo cáo
  O6 có cột giảm giá theo khuyến mãi.

### Đánh giá đơn

- Khách chấm 1–5 sao, chọn nhãn, ghi chú (≤ 1000) qua token đơn, khi đơn `completed`, trong 7 ngày; sửa
  được trong 24 giờ.
- Email mời đánh giá sau khi hoàn tất (trễ 60 phút, một lần, chỉ khi có email).
- Đánh giá ≤ 2 sao mở alert `low-rating` gửi quản lý chi nhánh (quyết định 2026-10-12).
- Admin: danh sách lọc theo chi nhánh/sao/ngày/có ghi chú; ẩn đánh giá, ghi chú nội bộ; báo cáo điểm TB.

## Non-goals

- Thẻ quà tặng (O9); tích điểm, hạng thành viên; giới thiệu bạn bè; mua X tặng Y, combo giá; giảm theo
  từng món ở mức giá niêm yết (giá sale) — dùng bảng giá catalog.
- Đánh giá công khai trên web, đánh giá từng món, trả lời công khai.

## Acceptance

### Automated

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test                     # pipeline property test, evaluate test
pnpm run check:ordering           # thêm promotions, promotion-race, rating
pnpm run check:phase3             # DB test, plugin tắt và bật
pnpm run smoke:ordering-pickup
node scripts/smoke-ordering-delivery.mjs
pnpm exec strapi build            # plugin tắt và bật
```

Test bắt buộc:

- Pipeline: giảm chỉ vào dòng chọn; Σ allocation = số giảm; giảm phí giao không vào dòng; tổng đơn khớp.
- Mỗi điều kiện có ca đạt và không đạt, kèm `details.reason`.
- Cộng dồn: hai tự động cộng dồn; một không cộng dồn thắng khi giảm nhiều hơn; mã + tự động.
- Quote có mã = create có mã (cùng giờ, cùng input).
- Lượt cuối: hai đơn song song → đúng một áp được, đơn kia `PROMOTION_EXHAUSTED`; mã dùng một lần.
- Lượt mỗi khách theo số điện thoại; đơn đầu tiên.
- Hủy/từ chối/hết hạn trả lượt; hủy bớt món hoàn đúng phần đã phân bổ, khuyến mãi giữ.
- Nhập mã sai quá ngưỡng → yêu cầu captcha, rồi `RATE_LIMITED`.
- Đánh giá: đơn chưa xong → 409; token sai → 401; gửi lại sau 24 giờ → 409; ngoài scope → 404; 2 sao → alert.

### Manual UAT

- [ ] Tạo mã 10% tối đa 30.000đ cho đơn từ 100.000đ ở Q1; đặt đơn dùng mã; hủy một món → hoàn đúng.
- [ ] Khuyến mãi tự động "Miễn phí giao từ 200.000đ" chạy cùng mã.
- [ ] Sinh 50 mã dùng một lần, xuất CSV, dùng 1 mã hai lần → lần 2 báo đã dùng.
- [ ] Khách gửi đánh giá 2 sao → quản lý nhận email; ẩn đánh giá trong Admin.

## Rollback

Tắt mọi khuyến mãi (Admin hoặc `active=false`); không cấp quyền `promotion.manage`/`rating.manage`.
Đơn đã áp giữ adjustment (đã vào sổ).

## Rủi ro

- Lạm dụng mã: rate limit + captcha + mã dùng một lần cho giá trị lớn.
- Kế toán có thể yêu cầu cách ghi giảm giá trên hóa đơn điện tử (chờ quyết định VAT).
- Khách dùng mã và gửi đánh giá cần web OW.
