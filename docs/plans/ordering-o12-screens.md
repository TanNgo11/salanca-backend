# O12 — Đặc tả màn hình (nhà hàng)

Ngày: 2026-10-12. Bổ sung cho spec [`phases/phase-ordering-12-restaurant.md`](../phases/phase-ordering-12-restaurant.md),
kế hoạch [`ordering-o12-restaurant.md`](ordering-o12-restaurant.md), mockup
[`mockups/ordering-o12-restaurant.html`](mockups/ordering-o12-restaurant.html). Nghiên cứu: reference U12.
**Quy ước chung** như [`ordering-o3-screens.md`](ordering-o3-screens.md); chuỗi trong `translations/o12.ts`.

## N1. Trang in (phiếu bếp / hóa đơn tạm)

- Route `/plugins/ordering/print/:orderId?doc=kitchen|receipt&width=80&autoprint=1`, không có khung Admin. Quyền `order.read`.
- **Phiếu bếp:** tên chi nhánh, mã đơn (chữ rất to), kênh (Tự lấy / Giao / Bàn 5), giờ nhận ("ASAP ~12:40" hoặc "Hẹn
  13:00"), từng món: số lượng to, tên, tùy chọn thụt lề, ghi chú món in nghiêng; ghi chú đơn; không giá, không SĐT; cuối:
  giờ in, "Lần in 2" nếu in lại.
- **Hóa đơn tạm:** header chi nhánh (`printing.header`), mã đơn, ngày giờ, khách (tên, SĐT che), địa chỉ giao (nếu có), bảng
  món (SL × tên … thành tiền), tạm tính, giảm giá, phí dịch vụ/đóng gói, phí giao, thuế, tip, **tổng**, đã trả (theo cách),
  còn phải trả; nếu còn nợ chuyển khoản → QR thanh toán O4; footer (`printing.footer`), dòng "Không phải hóa đơn GTGT".
- Nút trên màn hình (ẩn khi in): "In", khổ 58/80, "Đóng".

## N2. Màn hình bếp (KDS)

- Route `/plugins/ordering/kitchen?branch=Q1&station=hot`. Quyền `kitchen.read`. Toàn màn hình (nút phóng to), nền tối,
  chữ ≥ 18px; SSE tự cập nhật; âm báo đơn mới (bật/tắt ở góc).
- 3 cột: **Mới** (đã nhận, chưa ai bấm làm), **Đang làm**, **Xong** (15 phút gần nhất, mờ dần).
- Thẻ đơn: mã + kênh (`Badge` Tự lấy/Giao/Bàn 5), đồng hồ chờ (xanh < SLA, vàng ≥ SLA, đỏ ≥ 2×SLA), giờ hẹn; danh sách món
  của trạm đang lọc — bấm món để gạch (preparedAt); ghi chú nổi bật vàng; nút "Bắt đầu" (Mới → Đang làm, chỉ là trạng thái
  KDS, lưu `kitchenStartedAt` trên group), "Xong cả đơn" (→ `ready`; lỗi 409 → thẻ rung + "Đơn đã được người khác cập nhật").
- Chọn trạm: nút trên đầu (Tất cả, Bếp nóng, Quầy nước…) từ `kitchenStation` của danh mục.

## N3. Tạm dừng / Quán đông (đầu trang Đơn hàng S1)

- Thanh trạng thái trên S1 theo chi nhánh đang lọc: "Đang nhận đơn" (xanh) hoặc "Tạm dừng nhận đơn giao đến 12:45 —
  còn 14 phút" (đỏ) + nút "Mở lại ngay"; "Quán đông +20 phút đến 13:00" (vàng).
- Nút "Tạm dừng" → panel (không dropdown): cách nhận (nút Tự lấy / Giao / Tại bàn / Tất cả), thời gian (15 / 30 / 60 phút /
  Đến hết ngày), lý do (tùy chọn). Nút "Quán đông" → +10 / +20 / +30 phút, trong 30 / 60 / 120 phút. Quyền `order.process`.

## N4. Cấu hình chi nhánh (tab mới "Nhà hàng" trong màn Chi nhánh S7)

- Khối **Phí**: bảng (Tên VI/EN, Loại Dịch vụ/Đóng gói, Số tiền hoặc %, Áp cho Tự lấy/Giao/Tại bàn, Chịu thuế, Đơn từ),
  "+ Thêm phí".
- Khối **Tip**: `Switch` bật, mức gợi ý (3 ô %), cho nhập số tiền, áp cho cách nhận.
- Khối **Tự từ chối**: theo cách nhận: `NumberInput` phút (trống = tắt) + cảnh báo "Khách đã trả sẽ được hoàn tự động".
- Khối **In**: khổ 58/80, dòng đầu, dòng cuối, `Switch` "Tự in phiếu bếp khi nhận đơn (trên máy được đánh dấu máy in quầy)".

## N5. Dị ứng & ăn kiêng (form món O2)

- Khối mới: lưới checkbox 14 nhóm dị ứng (Gluten, Giáp xác, Trứng, Cá, Đậu phộng, Đậu nành, Sữa, Hạt cây, Cần tây, Mù tạt,
  Mè, Sulfite, Đậu lupin, Nhuyễn thể) + "Khác" (thêm tên); nhãn ăn kiêng (Chay, Thuần chay, Cay, Không đường, Không gluten…).
- Danh mục (O2) thêm field "Trạm bếp" (`TextInput`, gợi ý từ giá trị đã dùng).

## N6. Bàn & QR (Cấu hình → Bàn)

- Route `/plugins/ordering/tables?branch=`. Quyền `table.manage`.
- Bảng: Mã, Tên, Khu, Số ghế, Trạng thái (`Switch`), QR (nút "Tải QR" SVG/PNG từ trình duyệt, "In thẻ bàn" — trang in A6
  có QR + tên bàn + hướng dẫn), "Đổi QR" (`Dialog`: QR cũ hết hiệu lực ngay).
- "+ Thêm bàn" / "Thêm nhiều bàn" (từ 1 đến n, tiền tố "B").

## N7. Bàn đang phục vụ (Vận hành → Tại bàn)

- Route `/plugins/ordering/table-sessions?branch=`. Quyền `table.manage`.
- Lưới thẻ bàn: bàn trống (xám), đang phục vụ (thời gian mở, số đơn, tổng, còn nợ), có đơn chờ nhận (viền cam).
- Bấm bàn → panel: các đơn của phiên (trạng thái, món), tổng/đã trả/còn nợ; nút "In hóa đơn bàn" (gộp), "Thanh toán & đóng
  bàn" (chọn Tiền mặt / Chuyển khoản tại quầy + mã tham chiếu) — còn đơn chưa xong thì `Alert` và chặn.
- Phiên mở qua ngày kinh doanh: thẻ đỏ "Chưa đóng từ hôm qua".

## Đã đổi khi code O12 (2026-10-14)

- **Tip chưa làm** (N1 dòng "tip", N4 khối Tip, checkout nút %): chờ kế toán xác nhận cách hạch toán và thuế. Hóa đơn
  tạm không có dòng tip.
- **N7 "In hóa đơn bàn"** chỉ gộp các đơn còn sống: đơn đã hủy không in và không tính vào tổng, giống lúc đóng bàn
  không thu tiền đơn hủy.
- **N7 "Chuyển khoản tại quầy"**: một mã tham chiếu cho cả lần đóng. Đơn đầu tiên dùng đúng mã đó, các đơn sau dùng
  `<mã>-<id đơn>` (cắt mã gốc cho vừa 41 ký tự). Để trống thì server tự sinh `tsc<id phiên>-<8 hex>`.
- **N4 / cấu hình Tại bàn**: `sessionPayment` mặc định `at-close` — mọi đơn tại bàn đi luồng trả sau, thu khi đóng bàn,
  bất kể `paymentTiming`. Muốn khách trả từng đơn thì đặt `per-order`, khi đó `paymentTiming` có hiệu lực.
- **N4 "Tự từ chối"**: thời gian chờ tính từ lúc đơn vào "chờ nhận". Đơn trả trước tính từ lúc đã trả, không tính từ lúc đặt.
- **N6**: link QR (chứa token bàn) vẫn hiện cho người có `table.manage`, nhưng không ghi vào nhật ký thay đổi.

## Phía khách (OW dùng)

- `/config` có `pause` → web hiện "Quán tạm dừng nhận đơn giao đến 12:45" và gợi ý cách nhận còn mở; `busy` → "Quán đang
  đông, thời gian chuẩn bị khoảng +20 phút".
- Checkout: phí hiện từng dòng; tip: nút 0% / 5% / 10% / 15% / Khác.
- Menu: biểu tượng dị ứng/nhãn dưới món; bộ lọc "Không chứa…" và "Chay".
- Quét QR bàn: trang menu chi nhánh có thanh "Bàn 5 · Quận 1"; đặt món không cần địa chỉ/giờ; trang đơn hiện các đơn của
  bàn và tổng.
