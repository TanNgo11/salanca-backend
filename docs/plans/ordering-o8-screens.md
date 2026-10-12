# O8 — Đặc tả màn hình (khuyến mãi, đánh giá)

Ngày: 2026-10-12. Bổ sung cho spec [`phases/phase-ordering-8-promotions-rating.md`](../phases/phase-ordering-8-promotions-rating.md),
kế hoạch [`ordering-o8-promotions-rating.md`](ordering-o8-promotions-rating.md), mockup
[`mockups/ordering-o8-promotions-rating.html`](mockups/ordering-o8-promotions-rating.html). Nghiên cứu:
[`ordering-reference.md` mục U8](ordering-reference.md). **Quy ước chung** như mục đầu của
[`ordering-o3-screens.md`](ordering-o3-screens.md); chuỗi giao diện trong `translations/o8.ts`.

Điều hướng: menu con "Bán hàng" thêm nhóm **Khuyến mãi** (Khuyến mãi) — hiện khi có `promotion.manage`; mục
**Đánh giá** trong nhóm **Vận hành** — hiện khi có `order.read`.

## K1. Danh sách khuyến mãi

- Route `/plugins/ordering/promotions`. Quyền `promotion.manage`. API `GET /ordering/promotions`.
- Tab: Đang chạy · Sắp chạy · Đã tắt · Đã hết hạn · Tất cả (tính ở server từ `active`, `startsAt`, `endsAt`).
- Tìm theo tên/mã. Nút "+ Tạo khuyến mãi" (primary).
- Bảng: **Tên** (+ `Badge` Mã / Tự động), **Giảm** ("10% tối đa 30.000đ", "20.000đ", "Miễn phí giao"),
  **Điều kiện** (rút gọn: "Đơn từ 100.000đ · Q1 · Giao"), **Thời gian** (`12/10 – 31/10`), **Đã dùng**
  (`37 / 100` + `ProgressBar`, "∞" khi không giới hạn), **Tổng giảm** (`1.240.000đ`), **Trạng thái** (`Switch`
  bật/tắt ngay trên dòng, `Dialog` xác nhận khi tắt khuyến mãi đang chạy).
- Trống: "Chưa có khuyến mãi. Tạo mã giảm giá hoặc khuyến mãi tự động cho đơn online."

## K2. Tạo / sửa khuyến mãi

- Route `/plugins/ordering/promotions/new` và `/:id`. Một trang dài chia khối (`Box` + tiêu đề), panel tóm tắt
  sticky bên phải ("Khách thấy: Giảm 10% tối đa 30.000đ cho đơn từ 100.000đ, Q1, giao tận nơi, 12/10–31/10").
- **Loại**: hai thẻ chọn `Mã giảm giá` / `Tự động` (chỉ chọn khi tạo; sửa thì khóa).
- **Tên**: VI (bắt buộc), EN; "Ghi chú nội bộ".
- **Giảm gì**: thẻ chọn kiểu `Phần trăm` · `Số tiền` · `Miễn phí giao` · `Giảm phí giao`; ô giá trị (`%` 1–100 hoặc
  đồng); "Giảm tối đa" (chỉ phần trăm); **Áp cho**: `Radio` Cả đơn / Món chọn / Danh mục chọn → danh sách
  checkbox có ô tìm không dấu (như chọn xã/phường O5, không dropdown).
- **Điều kiện**: tạm tính tối thiểu; chi nhánh (`Checkbox` "Mọi chi nhánh" hoặc danh sách); cách nhận (Tự lấy,
  Giao); `Checkbox` "Chỉ đơn đầu tiên của số điện thoại".
- **Thời gian**: bắt đầu (`DateTimePicker`, mặc định bây giờ), kết thúc (tùy chọn); ngày trong tuần (7 nút bật/tắt);
  khung giờ (cặp `TimePicker`, tối đa 3) — theo giờ của chi nhánh.
- **Giới hạn**: tổng lượt (trống = không giới hạn), lượt mỗi khách, `Checkbox` "Cộng dồn với khuyến mãi khác",
  ưu tiên (số).
- **Mã** (chỉ loại Mã, khi tạo): nhập một mã (chữ hoa, tự đổi), hoặc "Sinh hàng loạt sau khi lưu" (K3).
- Lưu: "Lưu nháp" (`active=false`) / "Lưu và bật". Lỗi zod theo `details.issues[].path` hiện dưới field.
  Sửa khuyến mãi đã có lượt dùng: `Alert` "Thay đổi chỉ áp cho đơn mới; đơn cũ giữ số giảm đã tính."

## K3. Mã của khuyến mãi (tab trong K2 khi đã lưu, loại Mã)

- API `GET/POST /ordering/promotions/:id/codes`, `GET .../codes/export`, `POST /ordering/promotion-codes/:id/active`.
- Bảng: **Mã**, **Đã dùng / Giới hạn**, **Lô**, **Trạng thái** (`Switch`), **Tạo lúc**. Tìm mã; phân trang 50.
- Nút "Thêm mã" (panel: một mã, giới hạn lượt) và "Sinh hàng loạt" (panel: số lượng ≤ 5000, tiền tố, độ dài 8–16,
  lượt mỗi mã — mặc định 1, tên lô) → kết quả "Đã sinh 500 mã (lô TET2027)" + nút "Xuất CSV".
- "Xuất CSV" cần thêm quyền `export`; ẩn nút khi thiếu.

## K4. Thống kê khuyến mãi (tab trong K2)

- Thẻ: Số đơn đã dùng, Tổng giảm, Doanh thu đơn có khuyến mãi, Lượt đang giữ (đơn chưa xong).
- Bảng đơn đã dùng (API `GET .../redemptions`): mã đơn (link S4), ngày, chi nhánh, mã dùng, số giảm, trạng thái
  (`Đang giữ` / `Đã áp` / `Đã trả lại`).

## Thay đổi ở màn có sẵn

- **S4 Chi tiết đơn**: khối tiền thêm dòng "Khuyến mãi: GIAM10 (−25.000đ)" từ adjustment; lịch sử thêm sự kiện
  trả lượt khi hủy. Khối "Đánh giá của khách" (sao, nhãn, ghi chú) khi có.
- **Tạo đơn hộ khách (O3)**: ô "Mã khuyến mãi" + kết quả từ quote.
- **Sửa đơn (E3 O7)**: panel kết quả hiện khuyến mãi giữ lại và cảnh báo `promotion-kept`.
- **Báo cáo (V4 O6)**: thẻ "Giảm giá" và "Đánh giá TB (n)"; nhóm theo "Khuyến mãi".
- **Cài đặt bán hàng (S9)**: khối "Đánh giá": `Switch` gửi email mời, trễ (phút), thời hạn đánh giá (ngày), thời gian
  được sửa (giờ), danh sách nhãn (mã, tên VI/EN, tích cực/tiêu cực; thêm/xóa/sắp xếp bằng nút ↑↓).
- **Cảnh báo (V2 O6)**: rule `low-rating` hiện trong bảng ngưỡng ("Đánh giá ≤ N sao").

## R1. Danh sách đánh giá

- Route `/plugins/ordering/ratings`. Quyền `order.read` (lọc scope ở server). API `GET /ordering/ratings`.
- Thẻ trên cùng: điểm TB (khoảng lọc), số đánh giá, phân bố 1–5 sao (thanh ngang).
- Bộ lọc: chi nhánh, sao (nút 1–5 bật/tắt), từ ngày–đến ngày, `Checkbox` "Có ghi chú", trạng thái (Hiện/Ẩn).
- Bảng: **Sao** (★ màu; ≤ 2 tô đỏ), **Nhãn** (`Tag`), **Ghi chú** (2 dòng, cắt), **Đơn** (mã, link S4), **Chi nhánh**,
  **Lúc**. Bấm dòng → R2.
- Trống: "Chưa có đánh giá trong khoảng này."

## R2. Chi tiết đánh giá (`Modal` chỉ đọc + thao tác nút)

- Sao, nhãn, ghi chú đầy đủ, lúc gửi/sửa, đơn (mã, món, tổng, người giao nếu có).
- "Ghi chú nội bộ" (`Textarea`, quyền `rating.manage`, lưu bằng nút) — không gửi khách.
- Nút "Ẩn đánh giá" / "Hiện lại" (`rating.manage`), ghi change-log.

## Phía khách (OW dùng)

- Checkout: ô "Mã khuyến mãi" + nút Áp dụng → gọi quote; thành công hiện dòng giảm; lỗi theo `reason`:
  `min-subtotal` → "Mua thêm 20.000đ để dùng mã này"; `location` → "Mã không áp dụng ở chi nhánh này";
  `receive-kind`, `time`, `products`, `first-order`, `per-customer` có câu riêng; `PROMOTION_INVALID` → "Mã không
  hợp lệ"; `PROMOTION_EXPIRED` → "Mã đã hết hạn / chưa bắt đầu"; `PROMOTION_EXHAUSTED` → "Mã đã hết lượt";
  `not-best` → "Đã chọn ưu đãi tốt hơn cho bạn". Cần captcha → hiện Turnstile rồi gọi lại.
- Khuyến mãi tự động hiện sẵn trong tóm tắt giỏ ("Miễn phí giao — đơn từ 200.000đ").
- Trang đơn: khi `rateable` → khối "Đánh giá đơn này": 5 sao (bấm), nhãn (chip theo sentiment: ≥ 4 sao hiện nhãn tích
  cực, ≤ 3 hiện tiêu cực), ghi chú, Gửi; đã gửi → hiện lại, sửa được tới `editableUntil`.
