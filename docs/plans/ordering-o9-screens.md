# O9 — Đặc tả màn hình (thẻ quà tặng)

Ngày: 2026-10-12. Bổ sung cho spec [`phases/phase-ordering-9-gift-cards.md`](../phases/phase-ordering-9-gift-cards.md),
kế hoạch [`ordering-o9-gift-cards.md`](ordering-o9-gift-cards.md), mockup
[`mockups/ordering-o9-gift-cards.html`](mockups/ordering-o9-gift-cards.html). Nghiên cứu:
[`ordering-reference.md` mục U9](ordering-reference.md). **Quy ước chung** như mục đầu của
[`ordering-o3-screens.md`](ordering-o3-screens.md); chuỗi giao diện trong `translations/o9.ts`.

Điều hướng: nhóm menu con **Khuyến mãi & thẻ** (đổi tên từ "Khuyến mãi" của O8) thêm mục "Thẻ quà tặng", hiện khi có
`gift-card.manage`. Mã thẻ đầy đủ **không bao giờ** hiện ở Admin sau lần phát; mọi nơi hiện `•••• AB7K`.

## G1. Danh sách thẻ

- Route `/plugins/ordering/gift-cards`. Quyền `gift-card.manage`. API `GET /ordering/gift-cards`.
- Ô tìm: "4 ký tự cuối, mã đầy đủ hoặc mã đơn" (mã đầy đủ được gửi lên để hash, không lưu trong URL — dùng body
  `POST` hoặc giữ trong state, không đặt vào query string).
- Tab: Đang dùng · Đã khóa · Hết hạn · Hết tiền (balance 0) · Tất cả. Lọc nguồn: Bán / Phát tặng.
- Thẻ tổng trên cùng: Số dư lưu hành (Σ balance đang dùng), Bán trong tháng, Dùng trong tháng.
- Bảng: **Thẻ** (`•••• AB7K`), **Mệnh giá**, **Số dư** (thanh tỉ lệ), **Hạn dùng** (đỏ khi < 30 ngày), **Nguồn**
  (`Badge` Bán + mã đơn / Tặng), **Trạng thái**, **Phát lúc**. Bấm dòng → G2.
- Nút "Phát thẻ tặng" (primary) → G3.
- Trống: "Chưa có thẻ quà tặng. Tạo món thẻ trong Danh mục để bán, hoặc phát thẻ tặng."

## G2. Chi tiết thẻ

- Route `/plugins/ordering/gift-cards/:id`. API `GET /ordering/gift-cards/:id`.
- Đầu trang: `•••• AB7K`, số dư lớn / mệnh giá, `Badge` trạng thái, hạn dùng, nguồn (link đơn bán), người nhận
  (email che `n•••@gmail.com`), lời chúc.
- Thao tác (nút, mỗi nút mở panel có ô **Lý do** bắt buộc, không dropdown trong Modal):
  - "Khóa thẻ" / "Mở khóa";
  - "Gia hạn" (`TextInput type="date"`, phải sau hạn hiện tại);
  - "Điều chỉnh số dư" (chỉ `gift-card.adjust`; `NumberInput` có dấu ±; xem trước số dư mới; không cho âm);
  - "Gửi lại email" (`Dialog` xác nhận, gửi người nhận ban đầu).
- **Sổ thẻ** (bảng, mới nhất trên): Lúc, Loại (Phát / Dùng / Hoàn về thẻ / Điều chỉnh / Hết hạn / Khóa / Mở / Gia
  hạn), Số tiền (+ xanh / − đỏ), Số dư sau, Đơn (link), Người làm, Lý do. Không có nút sửa/xóa dòng sổ.

## G3. Phát thẻ tặng

- `Modal` (chỉ input, không dropdown): Mệnh giá (`NumberInput`, hoặc nút nhanh 100.000 / 200.000 / 500.000),
  Email người nhận (tùy chọn), Lời chúc (tùy chọn), Hạn dùng (mặc định theo cấu hình), **Lý do** (bắt buộc, ví dụ
  "Đền bù đơn SLC-000140").
- Bấm "Phát thẻ" → màn kết quả **một lần**: mã đầy đủ `XXXX-XXXX-XXXX-XXXX` chữ lớn, nút "Sao chép", cảnh báo "Mã chỉ
  hiện một lần. Đóng cửa sổ này là không xem lại được."; có email thì báo "Đã gửi tới n•••@gmail.com".

## G4. Thay đổi ở màn có sẵn

- **Danh mục món (O2)**: tạo món loại "Thẻ quà tặng" (product type `gift-card`): biến thể = mệnh giá, không có tùy
  chọn; gợi ý "Thẻ dùng được ở mọi chi nhánh, hạn 12 tháng".
- **Tạo đơn hộ khách (O3)**: chọn món thẻ → form người nhận (email, tên, lời chúc); thu tiền mặt bằng "Thu tiền và
  giao" → thẻ phát ngay, hiện kết quả như G3 cho nhân viên đọc cho khách **chỉ khi** khách không có email (có email
  thì không hiện mã, chỉ báo đã gửi).
- **Chi tiết đơn S4**: khối thanh toán hiện "Thẻ quà tặng •••• AB7K: −50.000đ" (link G2); đơn thẻ hiện danh sách thẻ
  đã phát (`•••• …`, mệnh giá, trạng thái gửi email); hủy/hoàn hiện rõ phần "Hoàn về thẻ".
- **Báo cáo (V4)**: thẻ "Bán thẻ", "Thanh toán bằng thẻ", "Số dư lưu hành"; doanh thu món không gồm đơn thẻ.
- **Cảnh báo (V2)**: rule `gift-card-probing` ("Có người dò mã thẻ").

## Phía khách (OW dùng)

- Trang thẻ quà tặng: chọn mệnh giá, số lượng (≤ 10), email người nhận, tên, lời chúc → thanh toán (giỏ riêng, không
  trộn món ăn).
- Checkout đơn món: "Dùng thẻ quà tặng" → ô mã (tự chèn `-`), captcha sau 3 lần sai; hiện "Thẻ •••• AB7K: −150.000đ,
  còn 50.000đ"; phần còn lại chọn cách trả như thường.
- Trang "Kiểm tra số dư thẻ": ô mã + captcha → số dư, hạn dùng (không hiện lịch sử dùng).
- Lỗi: `GIFT_CARD_INVALID` "Mã thẻ không đúng hoặc không dùng được"; `GIFT_CARD_EXPIRED` "Thẻ đã hết hạn";
  `GIFT_CARD_INSUFFICIENT` "Thẻ đã hết số dư"; `GIFT_CARD_NOT_ALLOWED` (`buying-gift-card`) "Không dùng thẻ để mua thẻ".
- Email người nhận: mệnh giá, mã, hạn, lời chúc, nút "Đặt món" và "Kiểm tra số dư"; email người mua: xác nhận đã gửi
  (không chứa mã).

## Đã đổi khi code O9 (2026-10-14)

- **G1** đúng spec: 5 tab (Đang dùng/Đã khóa/Hết hạn/Hết tiền/Tất cả), lọc nguồn, 3 thẻ tổng, tìm theo
  `q` (4 số cuối hoặc mã đầy đủ — đi trong query `GET /ordering/gift-cards`, không phải URL riêng; mã
  đầy đủ vẫn chỉ là hash lookup phía server). Thêm tab **Lô thẻ** (`Batches`) trên cùng trang —
  spec không có màn lô; kế hoạch bước 5 bổ sung quản lý thẻ giấy (tạo/nhập/xuất CSV/kích hoạt).
- **G2** đúng spec: panel Khóa/Mở/Gia hạn/Điều chỉnh (±, không âm, chặn khi thiếu `gift-card.adjust`)/Gửi lại;
  sổ thẻ append-only mới nhất trên. "Gửi lại email" gửi về `sealedRecipient` và chỉ khả dụng trong
  `sealedCodeHours` (mặc định 24h) — hết hạn nút báo mã đã xóa.
- **G3** đúng spec: Modal + nút nhanh 100k/200k/500k, lý do bắt buộc, mã hiện một lần khi không có
  email người nhận; có email thì mail đi ngay và mã **không** hiện.
- **G4 chi tiết đơn** đúng spec: payment thẻ hiện "Thẻ quà tặng •••• LAST4" link sang G2, đơn thẻ có
  khối thẻ đã phát, hoàn tiền về thẻ được đánh dấu. **Báo cáo** đủ 4 thẻ (bán/dùng/lưu hành/hết hạn).
- **G4 tạo đơn hộ**: `CreateOrderPage` hiện chỉ có `pickup` — chưa có ô quét mã thẻ giấy hay form
  người nhận digital trên UI. Bán thẻ giấy tại quầy đi qua API staff-draft với
  `receiveMethod: { kind:'digital', physicalCodes: [...] }` (đã có trong server + script); màn quét
  cho nhân viên là việc sau hoặc nằm ở web POS.
- **Báo cáo lọc `expired`** theo `created_at` UTC của ledger (không có `business_date`) — lệch tối đa
  ±1 ngày quanh nửa đêm UTC.
