# O5 — Giao tận nơi (ship thủ công)

## 1. Mục tiêu

Khách chọn giao tận nơi khi đặt, thấy phí giao; quán tự gọi ship bên ngoài (hoặc người giao của quán), nhập phí
ship thực tế và thông tin shipper, theo dõi đang giao → đã giao / giao thất bại.

## 2. Trạng thái

📝 **Có spec cũ, cần sửa:** thêm phí ship thực tế và tên/SĐT shipper bên ngoài; phí đồng giá. Chưa code. Cần O3a,
O3b.

## 3. Input / Output

**Storefront:**

| Route | Input | Output | Lỗi |
| --- | --- | --- | --- |
| `GET /address/provinces`, `GET /address/wards?province=` | — | danh mục hành chính 2 cấp (từ 01/07/2025), có phiên bản | — |
| `POST /quote` (mở rộng) | + `receive: delivery`, địa chỉ (tỉnh, xã/phường, số nhà) | + phí giao, thời gian giao cộng thêm | `DELIVERY_UNAVAILABLE`, `DELIVERY_MIN_NOT_MET` |
| `POST /orders` (mở rộng) | như trên | đơn có `addressSnapshot` | như trên |

**Provider `self-delivery`** (`FulfillmentProvider`): `getOptions`, `validate`, `calculatePrice`, `create`.

**Cấu hình theo chi nhánh:** phạm vi giao (danh sách xã/phường), kiểu phí: **đồng giá** / theo khu vực / theo giá
trị đơn (rule đầu tiên khớp thắng, có `unavailable`), miễn phí từ X đ, đơn tối thiểu để giao, thời gian giao
cộng thêm.

**Màn nhân viên (O3b mở rộng):** cột **"Đang giao"**; ở bước Sẵn sàng có nút **"Giao cho shipper"**: nhập tên
+ SĐT shipper (hoặc chọn người giao của quán), **phí ship thực tế**, mã vận đơn (tùy chọn); sau đó "Đã giao" /
"Giao thất bại" (chọn lý do: giao lại hoặc hủy + hoàn). Người giao của quán có "Thu tiền và giao".

**Sự kiện:** `order.delivering`, `order.delivered`, `order.delivery-failed`.

## 4. Đã làm

Nhóm fulfillment, workflow engine, thu tiền mặt có từ O1/O3.

## 5. Chưa làm

1. Danh mục hành chính 2 cấp (dữ liệu tĩnh có nguồn + phiên bản) + API.
2. Cấu hình vùng giao + 3 kiểu phí + đơn tối thiểu.
3. Provider `self-delivery` + quote/tạo đơn có địa chỉ.
4. Workflow giao; thông tin shipper ngoài + phí ship thực tế (lưu riêng với phí thu của khách để báo cáo chênh).
5. Màn cấu hình vùng giao; cột Đang giao.
6. Email khách ở bước giao (qua O3c).

## 6. Lỗi dự kiến và cách chặn

| Rủi ro | Cách chặn |
| --- | --- |
| Client gửi phí ship thấp | Phí luôn tính ở server từ cấu hình |
| Địa chỉ cũ trước sáp nhập 01/07/2025 | Chỉ nhận mã trong danh mục mới; báo rõ khi không tìm thấy |
| Đổi vùng giao làm đổi phí đơn đã đặt | Đơn lưu snapshot phí và địa chỉ |
| Lộ SĐT shipper cho khách | Chỉ hiện cho khách khi quán chọn chia sẻ |

## 7. Edge case

- Địa chỉ ngoài vùng → `DELIVERY_UNAVAILABLE`; đơn dưới mức tối thiểu → `DELIVERY_MIN_NOT_MET`.
- Đơn đủ ngưỡng miễn phí ship → phí 0.
- Giao thất bại → giao lại (về Sẵn sàng) hoặc hủy + hoàn.
- Phí ship thực tế cao hơn phí thu của khách → báo cáo thấy chênh.
- Đổi chi nhánh trong giỏ → tính lại phí theo vùng chi nhánh mới.

## 8. Phần dễ tốn thời gian nhất (dự kiến) và vì sao

**Danh mục hành chính 2 cấp sau sáp nhập.** Lý do: cần nguồn dữ liệu chính thức, mới, có mã ổn định; nhiều bộ dữ
liệu trên mạng còn theo cấp quận/huyện cũ; phải đóng gói vào plugin có phiên bản để cập nhật sau mà không làm hỏng
địa chỉ trong đơn cũ.

## 9. Gate / Acceptance

lint, typecheck, test, build, `check:ordering` (thêm delivery-zone, delivery-fee). UAT: đặt và giao thử trong
vùng; ngoài vùng bị từ chối; nhập shipper ngoài + phí thực tế; giao thất bại rồi giao lại.

## 10. Tài liệu chi tiết

`docs/phases/phase-ordering-5-delivery.md`, `docs/plans/ordering-o5-delivery.md`, `docs/plans/ordering-o5-screens.md`,
contracts mục 19.8.
