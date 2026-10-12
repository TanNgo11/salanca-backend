# O5 — Đặc tả màn hình (giao tận nơi)

Ngày: 2026-10-10. Bổ sung cho spec [`phases/phase-ordering-5-delivery.md`](../phases/phase-ordering-5-delivery.md),
kế hoạch [`ordering-o5-delivery.md`](ordering-o5-delivery.md), mockup [`mockups/ordering-o5-delivery.html`](mockups/ordering-o5-delivery.html).
Nghiên cứu: [`ordering-reference.md` mục U5](ordering-reference.md). **Quy ước chung** như mục đầu của
[`ordering-o3-screens.md`](ordering-o3-screens.md).

## Đã đổi khi code O5 (2026-10-12)

- Tab vùng giao nằm ở `admin/src/pages/Branches/DeliveryTab.tsx`, trong màn Chi nhánh. Không có trang Settings riêng.
- Sửa vùng là panel ngay trong tab, không phải Modal. Bậc phí dùng nút (Mọi đơn / Đơn từ / Đơn dưới). Tỉnh/thành dùng
  `SingleSelect` ngoài Modal. Xã/phường là danh sách checkbox có ô tìm không dấu. Dropdown mới trong Modal đã treo
  trang Admin ở O3.
- API báo phí: `POST /ordering/branches/:code/delivery-quote` (không có `/admin`). Body
  `{ communeCode, subtotal, zones? }`. `zones` là bản nháp trên màn hình; bỏ qua thì dùng vùng đã lưu.
- Lưu chi nhánh vẫn là `PUT /ordering/branches/:code` (client Admin không có PATCH) và gửi cả `fulfillment.pickup`
  lẫn `fulfillment.delivery`.
- `POST /api/v1/ordering/quote` và `POST /api/v1/ordering/orders` nhận `receiveMethod.kind = "delivery"` với
  `address.communeCode` (hoặc `wardCode`), `line1`, `recipientName`, `phone`. Phí do provider `self-delivery` tính
  và nằm trong `totals.fulfillmentTotal` / `totals.grandTotal`. Báo giá thêm `delivery.freeFrom` khi có bậc miễn
  phí. Tên xã/phường client gửi bị bỏ; server ghi tên từ danh mục lúc đặt. Mã không có trong danh mục
  trả `VALIDATION_ERROR` với `reason: unknown-commune` (không phải `DELIVERY_UNAVAILABLE`).
- Bước 5 (2026-10-12): state workflow dùng kebab-case (`out-for-delivery`, không phải `out_for_delivery`).
  Gán người giao là `transition { to: "out-for-delivery", assigneeRef, tracking }`: `assigneeRef` dạng
  `admin:<id>` của nhân viên active trong scope chi nhánh; xe ngoài gửi `tracking { carrier, number, url }`
  không kèm `assigneeRef`. Cần ít nhất một trong hai. Lý do `failed` là bộ riêng
  (`unreachable | wrong-address | refused | other`; `other` bắt buộc `note`), không phải bộ lý do từ chối S4.
  Giao lại là `transition { to: "ready" }` — server tự xóa assignee/tracking cũ. Hủy sau `failed` gọi
  `/cancel` như thường: tiền mặt đã thu hoàn `settled`, chuyển khoản đã thu tạo phiếu hoàn `pending`.
  `cash-handover` trên đơn giao ghi sổ tiền theo người giao được gán (không phải nhân viên đang bấm).

## D1. Tab "Giao tận nơi" trong Chi nhánh (S7 của O3)

Phần cài đặt giống tab Tự lấy (theo TastyIgniter `deliverysettings`): Nhận giao `Switch`, Cho đặt ASAP/Đặt
trước/Cả hai, thời gian chuẩn bị, khoảng slot, sức chứa slot, đặt trước tối đa, khách tự hủy trước, thời điểm trả
tiền, cách trả, làm tròn tiền mặt, báo chậm sau N phút.

Phần **Vùng giao** (theo TastyIgniter `locationarea` + Saleor shipping zone):

- Danh sách vùng dạng `Card` theo thứ tự ưu tiên (kéo thả hoặc nút lên/xuống); mỗi thẻ: tên, số xã/phường, tóm tắt
  phí ("< 100.000: không giao · < 300.000: 15.000 · còn lại: miễn phí"), nút Sửa / Xóa.
- Trống: "Chưa có vùng giao nào. Khách chưa đặt giao tận nơi được." + nút "+ Thêm vùng".
- `Modal` sửa vùng:

| Field | Kiểu | Quy tắc |
| --- | --- | --- |
| Tên vùng * | `TextInput` | |
| Tỉnh/thành * | `Combobox` từ danh mục 2 cấp | |
| Xã/phường * | `Combobox` chọn nhiều có tìm (không dấu), lọc theo tỉnh | không gõ tự do; xã/phường đã thuộc vùng khác hiện cảnh báo |
| Điều kiện phí | bảng lặp: Khi (`Select` Mọi đơn / Đơn từ / Đơn dưới) · Số tiền · Phí (`NumberInput`) hoặc `Checkbox` "Không giao" | xét từ trên xuống, dòng đầu khớp thắng; hiện câu tóm tắt dễ đọc |
| Đơn tối thiểu | `NumberInput` đ | |
| Cộng thêm thời gian | `NumberInput` phút | |

API: `PATCH /ordering/admin/branches/:code` (gửi cả `fulfillment.delivery.zones`); xem thử phí:
`POST /ordering/admin/branches/:code/delivery-quote { communeCode, subtotal }`.

## D2. Danh sách đơn giao

- Route: `/plugins/ordering/deliveries`. Quyền `order.read`; thao tác cần `order.process`.
- API: `GET /ordering/orders?receive=delivery&tab=ready|out|failed&assignee=&branch=` (đã bỏ `/admin` theo
  quy ước O3).
- `Tabs`: Sẵn sàng giao (n) · Đang giao (n) · Giao thất bại (n). Lọc người giao (theo TastyIgniter assignee: Chưa gán
  / Của tôi / Người khác + chọn người).

| Cột | Nội dung |
| --- | --- |
| Mã | |
| Người giao | tên hoặc "Chưa gán"; quán gọi xe ngoài: "Xe ngoài · <mã chuyến>" |
| Địa chỉ | số nhà, đường, xã/phường (đầy đủ trong tooltip) |
| Thu | `Badge` "235.000 tiền mặt" hoặc "Đã trả" |
| Xuất phát | giờ chuyển sang Đang giao |
| (thao tác) | Sẵn sàng: **Gán người giao**; Đang giao: **Thu tiền và giao** / **Đã giao** / **Giao thất bại** |

## D3. Hộp thoại giao hàng

| Hộp thoại | Field | API |
| --- | --- | --- |
| Gán người giao | `Toggle` Nhân viên quán / Xe ngoài; nhân viên: `Combobox` nhân viên trong scope; xe ngoài: hãng (text), mã chuyến, link theo dõi (URL) | `transition { to: "out-for-delivery", assigneeRef, tracking }` |
| Thu tiền và giao | như S5 của O3 | `cash-handover` |
| Giao thất bại | lý do * (`Select`: Không liên lạc được · Sai địa chỉ · Khách từ chối · Khác), ghi chú; sau đó chọn **Giao lại** hoặc **Hủy và hoàn tiền** | `transition { to: failed, reasonCode, note }` rồi `transition` tiếp |

## D4. Phía khách

Thuộc OW: nhập địa chỉ bằng `Combobox` tỉnh/thành → xã/phường (tìm không dấu) + số nhà, đường; báo giá trả phí giao
và câu "Mua thêm X đ để được miễn phí giao" khi có rule miễn phí phía trên; ngoài vùng: "Chưa giao được tới địa chỉ
này" và gợi ý tự lấy.
