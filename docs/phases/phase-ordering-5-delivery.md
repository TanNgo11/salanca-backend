# Phase O5 — Giao tận nơi (quán tự giao)

Trạng thái: spec chờ duyệt (2026-10-10). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Kế hoạch thực hiện: [`plans/ordering-o5-delivery.md`](../plans/ordering-o5-delivery.md).
Thiết kế: [`plans/ordering-core-contracts.md`](../plans/ordering-core-contracts.md) (mục 5
`FulfillmentProvider`, 19.8); nghiên cứu: reference B6, C17.4.

## Goal

Khách chọn giao tận nơi trong vùng quán phục vụ, thấy phí giao trước khi đặt; nhân viên quán gán người
giao, theo dõi đang giao/đã giao/giao thất bại; người giao thu tiền mặt khi giao. Tích hợp hãng giao để
sau nhưng cắm được vào cùng contract.

## Điều kiện bắt đầu

- O4 đóng (giao tận nơi dùng cả tiền mặt lẫn chuyển khoản).
- Chủ dự án cung cấp danh sách xã/phường quán giao, bảng phí, đơn tối thiểu cho từng chi nhánh.

## Scope

- **Danh mục hành chính 2 cấp** (tỉnh/thành, xã/phường từ 01/07/2025): dữ liệu tĩnh trong plugin, có
  nguồn và phiên bản; API đọc cho form địa chỉ.
- **`DeliveryZone`** trong setting chi nhánh: khớp theo mã xã/phường, rule phí theo giá trị đơn (rule đầu
  tiên khớp thắng, có `unavailable`), đơn tối thiểu, thời gian giao cộng thêm, thứ tự ưu tiên.
- **`FulfillmentProvider` `self-delivery`:** `getOptions`, `validate`, `calculatePrice`, `create`; quote
  trả phí giao vào `fulfillmentAmount` của group; ngoài vùng trả `DELIVERY_UNAVAILABLE`.
- **Địa chỉ và liên hệ:** `addressSnapshot` trên fulfillment; số điện thoại đã bắt buộc và chuẩn hóa từ O3
  (contracts 21.9).
- **Workflow giao** dùng chung 3 kiểu thanh toán: sẵn sàng → đang giao (gán `assigneeRef`, tracking nhập
  tay nếu gọi xe ngoài) → đã giao | giao thất bại (bắt buộc lý do; giao lại hoặc hủy và hoàn).
- **"Thu tiền và giao" cho người giao**; tiền mặt tính theo người giao để O6 chốt cuối ngày.
- **Admin:** màn hình cấu hình vùng giao theo chi nhánh; danh sách đơn đang giao theo người giao.
- **Email khách** ở các bước giao công khai.

## Non-goals

- Tích hợp GHN/Ahamove/Grab Express; tính khoảng cách bằng bản đồ; theo dõi vị trí người giao.

## Acceptance

### Automated

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check:phase3
node scripts/smoke-ordering-delivery.mjs   # mới
```

Test bắt buộc:

- Rule phí: dưới đơn tối thiểu thì không giao; các bậc phí; miễn phí từ ngưỡng; vùng ưu tiên cao thắng.
- Xã/phường ngoài mọi vùng trả `DELIVERY_UNAVAILABLE`.
- Phí giao vào đúng `fulfillmentAmount` và tổng đơn khớp.
- Giao thất bại bắt buộc lý do; hủy sau khi đã thu tạo refund đúng.
- Nhân viên chi nhánh khác không gán được người giao cho đơn ngoài scope.

### Manual UAT

- [ ] Cấu hình 2 vùng với phí khác nhau; quote ra đúng phí theo xã/phường.
- [ ] Đặt đơn giao, gán người giao, "Thu tiền và giao" → đơn `completed`.
- [ ] Giao thất bại → giao lại thành công.

## Bổ sung sau review (2026-10-10)

- Đường dẫn công khai trong tài liệu này là tương đối; với Salanca chúng nằm dưới `/api/v1` (contracts 21.7).
- Địa chỉ chi nhánh trong `branch` (21.1) dùng cùng danh mục xã/phường.
- Cấu hình vùng giao ghi `admin-change-log` (21.6).

## Rollback

Tắt `delivery` trong setting chi nhánh; đơn tự lấy không bị ảnh hưởng.

## Rủi ro

- Danh mục hành chính có thể còn điều chỉnh; lưu mã và tên tại lúc đặt trong snapshot, cập nhật danh
  mục bằng bản phiên bản mới.
