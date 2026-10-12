# Phase O7 — Vận hành bổ sung

Trạng thái: spec chờ duyệt (2026-10-12). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Mockup: [`plans/mockups/ordering-o7-ops-extras.html`](../plans/mockups/ordering-o7-ops-extras.html).
**Đặc tả màn hình (bắt buộc khi code UI):** [`plans/ordering-o7-screens.md`](../plans/ordering-o7-screens.md) (nghiên cứu UI: reference mục U7).
Kế hoạch thực hiện: [`plans/ordering-o7-ops-extras.md`](../plans/ordering-o7-ops-extras.md).
Thiết kế: [`plans/ordering-core-contracts.md`](../plans/ordering-core-contracts.md) (mục 5 `inventoryRef`,
19.3, 19.6, 19.8, 20.1, 21.5).

## Goal

Bốn tính năng chủ dự án chọn sau review chức năng (2026-10-12), để quán vận hành hằng ngày không phải
làm tay:

1. Giờ mở cửa đặc biệt theo từng ngày (Tết, sự kiện), không chỉ ngày nghỉ.
2. Giới hạn số phần bán mỗi ngày cho món/biến thể/tùy chọn, tự trừ và tự trả lại.
3. Nhân viên sửa đơn sau khi đặt: thêm/bớt món, đổi giờ nhận, đổi địa chỉ giao; tiền tự tính lại.
4. Trang di động cho người giao.

## Điều kiện bắt đầu

- O6 đã merge vào nhánh làm việc (O7 dùng change-log, alert, chốt tiền của O6).
- Không cần dữ liệu thật của chủ dự án để code; UAT cần một chi nhánh mẫu có món giới hạn.

## Scope

- **Giờ đặc biệt:** `businessDayPolicy.specialHours[]` theo chi nhánh và theo cách nhận (tự lấy/giao),
  mỗi dòng là một ngày: đóng cả ngày hoặc 1–6 khoảng giờ. Ưu tiên hơn giờ thường và `holidayDates`.
  Áp cho slot, ASAP, `isOpenAt`, `/config`, `/slots`, quote, tạo đơn. `/config` trả 14 ngày tới.
- **Giới hạn mỗi ngày:** cấu hình theo (món | biến thể | tùy chọn) × chi nhánh; trừ lúc tạo đơn trong cùng
  transaction, theo **ngày kinh doanh của lúc nhận hàng**; trả lại khi hủy/từ chối/hết hạn/hủy bớt
  món/sửa đơn bớt món. Catalog/quote trả số còn lại; hết thì như "tạm hết" tới hết ngày đó.
- **Sửa đơn (nhân viên):** xem trước rồi áp dụng trong một transaction; thêm món (giá hiện hành), bớt
  món (như hủy món O3), đổi giờ (qua sức chứa slot), đổi địa chỉ (tính lại vùng/phí); tính lại tổng
  bằng pipeline; chênh âm → hoàn (tiền mặt `settled`, chuyển khoản phiếu `pending`); chênh dương → đơn
  trả trước nhận link trả phần chênh (không chặn bếp), đơn trả khi nhận chỉ tăng số cần thu. Quyền mới
  `order.edit`. Email khách "Đơn đã được cập nhật".
- **Trang người giao:** trang trong Admin, bố cục điện thoại (`/plugins/ordering/courier`): đơn được
  gán cho tôi hôm nay theo trạng thái; bắt đầu giao, đã giao, thu tiền và giao, giao thất bại; gọi khách,
  mở bản đồ bằng địa chỉ chữ.

## Non-goals

- Kho nguyên liệu, nhập/xuất kho, định lượng; tồn không theo ngày.
- Khách tự sửa đơn trên web; đổi chi nhánh hoặc đổi cách nhận của đơn đã đặt.
- Định vị/bản đồ/lộ trình; app native; đăng nhập người giao bằng link (phương án B bị loại 2026-10-12).

## Acceptance

### Automated

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run check:ordering          # thêm special-hours, daily-stock, order-edit, courier
pnpm run check:phase3            # DATABASE_NAME=salanca_ordering_test, plugin tắt và bật
pnpm run smoke:ordering-pickup
node scripts/smoke-ordering-delivery.mjs
pnpm exec strapi build           # plugin tắt và bật
```

Test bắt buộc:

- Ngày đặc biệt: rút ngắn giờ, mở ngày thường đóng, đóng cả ngày, khoảng qua nửa đêm ảnh hưởng sáng
  hôm sau, ưu tiên hơn `holidayDates`; ASAP ngoài giờ đặc biệt → `ASAP_UNAVAILABLE`; lưu trùng ngày →
  `VALIDATION_ERROR`.
- Giới hạn: hai đơn tranh phần cuối → đúng một thành công (`ITEM_SOLD_OUT` 409 cho đơn kia); hai dòng
  cùng món cộng dồn; tùy chọn có giới hạn; đơn đặt trước trừ ngày nhận; 03:59/04:00 rơi đúng ngày; hủy,
  từ chối, hết hạn, hủy bớt món trả lại đúng số; quote/catalog trả `remaining`.
- Sửa đơn: thêm món đơn tiền mặt; bớt món đơn chuyển khoản → phiếu hoàn `pending`; thêm món đơn chuyển
  khoản → link phần chênh, bếp vẫn chạy; đổi giờ sang slot đầy → `SLOT_FULL`; đổi địa chỉ đổi phí;
  ngoài vùng → `DELIVERY_UNAVAILABLE`; sửa sau bước cho phép → `ORDER_NOT_EDITABLE`; hai người sửa cùng
  lúc → người sau `ORDER_CHANGED`; thiếu `order.edit` → 403; ngoài scope → 404; preview không ghi gì.
- Người giao: chỉ thấy đơn gán cho mình (đơn người khác → 404); thu tiền ghi đúng người giao.

### Manual UAT

- [ ] Đặt ngày mùng 2 Tết mở 10:00–14:00; web chỉ cho chọn giờ trong khoảng đó.
- [ ] Món "Cơm gà" giới hạn 3 phần; đặt 3 đơn → đơn thứ 4 báo hết; hủy một đơn → đặt lại được.
- [ ] Sửa một đơn mỗi loại (thêm món, bớt món, đổi giờ, đổi địa chỉ) và kiểm số tiền thu thêm/hoàn.
- [ ] Người giao làm trọn một chuyến trên điện thoại thật (Android Chrome, iPhone Safari, khổ 360px).

## Rollback

Xóa `specialHours`, bỏ giới hạn ngày (để trống), không cấp `order.edit`, ẩn trang người giao bằng quyền.
Bảng mới giữ lại; không ảnh hưởng đơn cũ.

## Rủi ro

- Sửa đơn đã trả tiền là phần rủi ro tiền cao nhất — mọi đường đi qua pipeline và refund service, có
  test cho từng chênh lệch.
- Strapi Admin trên điện thoại có thể chậm ở lần tải đầu; UAT quyết định có cần trang nhẹ riêng không.
