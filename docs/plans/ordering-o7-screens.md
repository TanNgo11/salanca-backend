# O7 — Đặc tả màn hình (vận hành bổ sung)

Ngày: 2026-10-12. Bổ sung cho spec [`phases/phase-ordering-7-ops-extras.md`](../phases/phase-ordering-7-ops-extras.md),
kế hoạch [`ordering-o7-ops-extras.md`](ordering-o7-ops-extras.md), mockup
[`mockups/ordering-o7-ops-extras.html`](mockups/ordering-o7-ops-extras.html). Nghiên cứu:
[`ordering-reference.md` mục U7](ordering-reference.md). **Quy ước chung** như mục đầu của
[`ordering-o3-screens.md`](ordering-o3-screens.md) (route `/ordering/...`, 5 trạng thái mỗi màn, tiền
`175.000đ`, giờ theo timezone chi nhánh, chuỗi trong `translations/o7.ts` dạng `[vi, en]`, không dùng
dropdown/`SimpleMenu` trong `Modal`).

## Đã đổi khi code O7 (2026-10-13)

- E1: khối "Ngày đặc biệt" nằm trong tab **Giờ mở** của tự lấy và của giao, trên màn Chi nhánh. Công tắc
  đóng cửa là `Switch`. Giờ mở/đóng là `TextInput` `HH:mm`, không phải `TimePicker`.
- E2: cột Hôm nay là thanh `Box` (`@strapi/design-system` không có `ProgressBar`). Bộ lọc "Chỉ món có giới
  hạn" dùng `Toggle` có sẵn. `GET /ordering/availability` nhận `branch` hoặc `locationRef` (`locationRef`
  thắng khi không rỗng). `PUT /ordering/availability/daily-limit` gửi `locationRef`.
- E3: `editableReason` là mã (`draft`, `closed`, `awaiting-payment`, `out-for-delivery`, `ready`); Admin dịch
  `edit.reason.*`. Ô tìm món dùng Combobox của catalog. Chọn tùy chọn bằng nút. Địa chỉ gọi public
  `GET /api/v1/ordering/admin-units` (route admin đòi `settings.manage`). Xác nhận dùng `Frame`/`Modal`.
  Tiêu đề giờ là "Giờ nhận". Không tách modal món ra khỏi trang Tạo đơn. Hành động cũ `order.edit-lines`
  ("Hủy một phần món") giữ nguyên tên.
- E4: mục menu hiện khi có cả `order.process` và `payment.record-cash`, hoặc khi có `order.process` và danh
  sách đang làm có đơn. `order.read` không bắt buộc để thấy trang. SSE `orders/stream` vẫn đòi `order.read`,
  nên tài khoản chỉ giao thì chỉ làm mới mỗi 30 giây. Lý do giao thất bại là các nút trong thẻ; "Khác" cần
  ghi chú ít nhất 3 ký tự. Đơn sẵn sàng chỉ vào danh sách khi đã có `assigneeRef`.
- Điện thoại 360px: trang là cột tối đa 480px, chữ 16px, nút cao 48px. Khung đăng nhập và menu Admin chưa
  được bấm trên 360px (chrome-devtools không bắt tay được). Nếu khung Admin không dùng được trên điện thoại,
  hướng sau O7 là một trang nhẹ ngoài chrome Admin. Không làm magic link trong O7.
- `GET /config`: `branch.delivery` có khi chi nhánh bật giao, cùng dạng với `pickup`. Cả hai có `specialHours`.

## E1. Ngày đặc biệt (trong màn Chi nhánh, tab Tự lấy và tab Giao tận nơi)

- Vị trí: `admin/src/pages/Branches/` — khối mới "Ngày đặc biệt" ngay dưới khối "Giờ mở cửa" của mỗi tab.
  Quyền `settings.manage` (như màn Chi nhánh). Lưu cùng nút "Lưu" của chi nhánh
  (`PUT /ordering/branches/:code`), change-log `branch.update` như hiện có.
- Bảng: **Ngày** (`TextInput type="date"`, như S1 O3), **Đóng cửa** (`Toggle`), **Khoảng giờ** (danh sách
  cặp `TimePicker` Mở–Đóng, nút "+ khoảng" tối đa 6, ẩn khi Đóng cửa), **Ghi chú** (`TextInput`, ≤ 100, ví dụ
  "Mùng 2 Tết"), nút xóa dòng. Nút "+ Thêm ngày đặc biệt" dưới bảng. Sắp theo ngày tăng dần.
- Ngày đã qua: thu vào dòng "Đã qua (n)" có thể mở ra; không tự xóa.
- Nút phụ trong tab Tự lấy: "Chép sang Giao tận nơi" (`Dialog` xác nhận: ghi đè danh sách ngày đặc biệt của
  tab Giao). Ngược lại ở tab Giao.
- Gợi ý dưới bảng: "Ngày đặc biệt thay giờ mở cửa thường và ngày nghỉ của đúng ngày đó. Khoảng 22:00–02:00 là mở
  qua nửa đêm."
- Lỗi từ server (`VALIDATION_ERROR` với `details.issues[].path` chứa `specialHours.<i>`) hiện dưới đúng dòng:
  "Ngày bị trùng", "Cần ít nhất một khoảng giờ hoặc bật Đóng cửa", "Khoảng giờ chồng nhau".
- Trạng thái: không có dòng → `EmptyStateLayout` nhỏ "Chưa có ngày đặc biệt".

## E2. Giới hạn mỗi ngày (trong màn "Tạm hết món")

- Vị trí: `admin/src/pages/Availability/` (màn Tạm hết O2), quyền `catalog.toggle-availability`, theo chi nhánh
  đang chọn. API `GET /ordering/availability?branch=` (đã có, thêm field), `PUT /ordering/availability/daily-limit`.
- Bảng hiện có (món → biến thể → tùy chọn) thêm 2 cột:
  - **Giới hạn/ngày**: số hoặc "—". Bấm → ô `NumberInput` tại chỗ (min 0), nút Lưu/Hủy; để trống = bỏ giới hạn.
  - **Hôm nay**: `đã đặt / giới hạn` + `ProgressBar`; còn ≤ 20% tô cam, hết tô đỏ kèm `Badge` "Hết hôm nay".
- Bộ lọc mới: `Toggle` "Chỉ món có giới hạn".
- Hết phần hôm nay không đổi công tắc "Đang bán"; dòng hiện chú thích "Tự bán lại từ ngày kinh doanh mai".
- Lưu thành công → `useNotification` "Đã lưu giới hạn"; 404 ngoài scope → trang báo không thấy chi nhánh.
- Màn Món (O2) không đổi: giới hạn là theo chi nhánh nên chỉ sửa ở đây.

## E3. Sửa đơn (trong chi tiết đơn S4)

- Vị trí: `admin/src/pages/Orders/OrderDetailPage.tsx`. Nút "Sửa đơn" (secondary) cạnh nút chuyển bước; hiện
  khi `detail.editable` và có quyền `order.edit`; nếu không sửa được hiện `Tooltip` theo `editableReason`
  ("Đơn đang giao", "Đơn chờ khách thanh toán", "Đơn đã đóng").
- Bấm → trang con toàn chiều rộng (không Modal) `/plugins/ordering/orders/:id/edit`, 2 cột:
  - **Trái — Thay đổi**:
    - "Món trong đơn": mỗi dòng còn hiệu lực có `NumberInput` số lượng (0..hiện tại; giảm = bớt); dòng bớt hết
      gạch ngang. Không tăng số lượng dòng cũ (muốn thêm thì thêm dòng mới — giá hiện hành).
    - "+ Thêm món": ô tìm món (cùng component tìm món của "Tạo đơn hộ khách" O3), chọn biến thể/tùy chọn bằng
      nút (không dropdown), số lượng, ghi chú. Món hết giới hạn hiện xám "Hết hôm nay".
    - "Giờ nhận" (nếu cho phép đổi): `Radio` Sớm nhất / Hẹn giờ + danh sách slot (`GET /ordering/...slots` như
      tạo đơn hộ); slot đầy xám.
    - "Địa chỉ giao" (đơn giao): form địa chỉ như O5 (tỉnh → xã/phường tìm không dấu, số nhà).
    - "Lý do sửa" (`Textarea`, bắt buộc, ≤ 500), `Checkbox` "Báo khách qua email" (mặc định bật).
  - **Phải — Kết quả (sticky)**: từ `POST .../edit/preview` (debounce 400 ms, hủy request cũ):
    bảng Trước → Sau (tạm tính, giảm giá, phí giao, tổng); khối tiền:
    - `refundCash > 0`: "Hoàn tiền mặt cho khách: 30.000đ" (đỏ);
    - `refundTransferPending > 0`: "Tạo phiếu hoàn chuyển khoản 30.000đ (chờ chuyển trả)";
    - `extraDue > 0` và `paymentLink`: "Khách cần trả thêm 25.000đ — gửi link thanh toán";
    - `extraDue > 0`, đơn trả khi nhận: "Thu thêm khi giao: 25.000đ";
    - `warnings`: `Alert` vàng (ví dụ "Đơn dưới mức tối thiểu 100.000đ").
  - Nút "Lưu thay đổi" (primary, `loading` khi gửi) → `Dialog` xác nhận tóm tắt số tiền → `POST .../edit`.
- Lỗi: `ORDER_CHANGED` → `Alert` "Đơn vừa được người khác sửa" + nút "Tải lại"; `ITEM_SOLD_OUT` → đánh dấu dòng
  thêm; `SLOT_FULL` → bỏ chọn slot; `DELIVERY_UNAVAILABLE` → lỗi dưới địa chỉ; `ORDER_NOT_EDITABLE` → quay lại
  chi tiết kèm thông báo.
- Sau khi lưu: về chi tiết đơn, `useNotification` "Đã cập nhật đơn"; lịch sử có dòng "Sửa đơn (lần n): …"
  (người sửa, lý do, Trước → Sau); dòng thêm có `Badge` "Thêm ở lần n".

## E4. Giao của tôi (trang người giao, bố cục điện thoại)

- Route `/plugins/ordering/courier`, mục "Giao của tôi" trong nhóm **Vận hành** của menu con; hiện khi có
  `order.process` + `payment.record-cash`. API `GET /ordering/courier/deliveries?view=active|done`.
- Bố cục một cột, rộng tối đa 480px, chữ ≥ 16px, nút cao ≥ 48px, không bảng. Đầu trang: tên người giao, ngày,
  2 tab `Đang làm (n)` / `Đã xong (n)`, nút làm mới; tự làm mới mỗi 30 giây.
- Mỗi đơn là một thẻ:
  - dòng 1: mã đơn, `Badge` trạng thái (Đang giao / Giao thất bại), giờ hẹn;
  - địa chỉ đầy đủ (chữ to), tên khách; nút **Gọi** (`tel:`), **Bản đồ** (mở
    `https://www.google.com/maps/search/?api=1&query=<địa chỉ>` tab mới);
  - ghi chú khách; danh sách món rút gọn (`2× Cơm gà`);
  - số tiền: "Thu 235.000đ tiền mặt" (đỏ đậm) hoặc "Đã thanh toán" (xanh);
  - nút theo trạng thái (sửa sau review 2026-10-13: bỏ "Bắt đầu giao" — người giao chỉ được gán lúc quản lý bấm bắt đầu giao
    trên board Đơn giao, nên đơn Sẵn sàng chưa thuộc ai; trang chỉ liệt kê đơn đang giao/thất bại/đã giao hôm nay);
    Đang giao → **Đã giao** (khi đã trả) hoặc **Thu tiền và giao** (`cash-handover`, `Dialog` xác nhận số tiền),
    và **Giao thất bại** (panel chọn lý do bằng nút: Không liên lạc được / Sai địa chỉ / Khách từ chối / Khác +
    ghi chú); Giao thất bại → chỉ xem (quản lý quyết định giao lại/hủy).
- Trống: "Chưa có đơn nào được gán cho bạn hôm nay". Lỗi mạng: `Alert` + "Thử lại"; nút đang gửi khóa lại.
- Không hiện số điện thoại/địa chỉ của đơn không gán cho mình (server lọc).

## Phía khách (OW dùng)

- `/config` có `specialHours` 14 ngày: web hiện "Hôm nay (Mùng 2 Tết) mở 10:00–14:00" hoặc "Hôm nay nghỉ".
- Catalog có `dailyLimit.remaining`: web hiện "Còn 3 phần hôm nay" khi ≤ 5; hết → nút "Hết hôm nay".
- `ITEM_SOLD_OUT` ở checkout: "Món X vừa hết phần hôm nay" và bỏ món khỏi giỏ khi khách đồng ý.
- Email "Đơn đã được cập nhật": món thêm/bớt, giờ/địa chỉ mới, tổng mới, link trả phần chênh (nếu có).
