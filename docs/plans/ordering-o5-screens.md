# O5 — Đặc tả màn hình (giao tận nơi)

Ngày: 2026-10-10. Bổ sung cho spec [`phases/phase-ordering-5-delivery.md`](../phases/phase-ordering-5-delivery.md),
kế hoạch [`ordering-o5-delivery.md`](ordering-o5-delivery.md), mockup [`mockups/ordering-o5-delivery.html`](mockups/ordering-o5-delivery.html).
Nghiên cứu: [`ordering-reference.md` mục U5](ordering-reference.md). **Quy ước chung** như mục đầu của
[`ordering-o3-screens.md`](ordering-o3-screens.md).

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
- API: `GET /ordering/admin/orders?receive=delivery&tab=ready|out|failed&assignee=&branch=`.
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
| Gán người giao | `Toggle` Nhân viên quán / Xe ngoài; nhân viên: `Combobox` nhân viên trong scope; xe ngoài: hãng (text), mã chuyến, link theo dõi (URL) | `transition { to: out_for_delivery, assigneeRef, tracking }` |
| Thu tiền và giao | như S5 của O3 | `cash-handover` |
| Giao thất bại | lý do * (`Select`: Không liên lạc được · Sai địa chỉ · Khách từ chối · Khác), ghi chú; sau đó chọn **Giao lại** hoặc **Hủy và hoàn tiền** | `transition { to: failed, reasonCode, note }` rồi `transition` tiếp |

## D4. Phía khách

Thuộc OW: nhập địa chỉ bằng `Combobox` tỉnh/thành → xã/phường (tìm không dấu) + số nhà, đường; báo giá trả phí giao
và câu "Mua thêm X đ để được miễn phí giao" khi có rule miễn phí phía trên; ngoài vùng: "Chưa giao được tới địa chỉ
này" và gợi ý tự lấy.
