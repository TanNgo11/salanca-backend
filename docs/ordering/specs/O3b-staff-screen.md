# O3b — Màn nhân viên xử lý đơn

## 1. Mục tiêu

Nhân viên part-time mở tablet là biết đơn nào cần làm và bấm một nút để làm bước tiếp theo. **Yêu cầu bắt buộc:
màn hình đơn giản, nhìn vào là hiểu.** Một người chưa dùng bao giờ, không được hướng dẫn, phải xử lý xong một
đơn trong khoảng 1 phút.

## 2. Trạng thái

📝 **Chưa code.** Spec màn hình cũ (`docs/plans/ordering-o3-screens.md`) viết trước yêu cầu "đơn giản" →
**viết lại theo file này**; mockup O3 làm lại. Cần O3a có API.

## 3. Input / Output

### 3.1. Vị trí và quyền
- Mục **"Bán hàng"** ở sidebar Strapi Admin, có submenu: Đơn hàng, Món & danh mục, Tạm hết món, Giao dịch,
  Báo cáo, Cài đặt. RBAC lọc submenu; nhân viên thường chỉ cần **Đơn hàng**.
- Một role **`Staff`** có mọi thao tác dưới đây; quyền vẫn chia nhỏ theo action (`order.read`, `order.accept`,
  `order.transition`, `order.cancel`, `order.edit-lines`, `order.create`, `payment.collect-cash`,
  `payment.refund`, `catalog.toggle-availability`, `ordering.pause`, …) để sau tách role khác không sửa code.
- Mỗi người một tài khoản; nghỉ → vô hiệu hóa, timeline vẫn giữ tên.

### 3.2. Màn "Đơn hàng"
- **Thẻ chia cột**: Mới · Đang làm · Sẵn sàng (thêm "Đang giao" từ O5). Ưu tiên tablet ngang, rồi desktop, rồi
  điện thoại (cột xếp chồng).
- Trên thẻ: mã đơn, **giờ khách lấy**, tên + SĐT (bấm để gọi), món + tùy chọn + ghi chú, **"Đã trả" / "Cần
  thu X đ"**, thời gian chờ (đổi màu khi quá ngưỡng cài đặt).
- **Một nút chính** theo bước: "Nhận đơn" → "Bắt đầu làm" → "Đã xong" → "Khách đã lấy" (hoặc "Thu tiền và
  giao" khi cần thu tiền mặt). Thao tác khác trong menu **"Khác"**: từ chối, hủy, không thể hoàn tất, hủy 1 món,
  in lại, ghi chú.
- Từ chối / hủy / không thể hoàn tất: **chọn lý do có sẵn**, ô "Khác" mới cho gõ; xác nhận 1 lần.
- Thanh trên: **thống kê nhanh hôm nay** (số đơn theo cột), nút **"Tạm ngưng nhận đơn"**, ô tìm theo mã / SĐT /
  tên, chọn ngày (mặc định hôm nay), chọn chi nhánh (chỉ khi được gán nhiều chi nhánh).
- Chi tiết đơn (mở từ thẻ): món, khách, thanh toán, **lịch sử thao tác**, ghi chú nội bộ.

### 3.3. Báo đơn mới
- Hộp thoại to trên **mọi trang Admin** (SSE), nút **"Nhận"**, "Nhận và lùi N phút", "Từ chối".
- Âm báo **cấu hình được**: bật/tắt, chọn âm, âm lượng, lặp lại sau N phút/giây, tối đa M lần, dừng khi có người
  nhận. Âm riêng cho tiền về, giao dịch lệch (O4).
- Hai người cùng bấm "Nhận" → người sau thấy "Đơn đã được [tên] nhận".

### 3.4. Tạo đơn hộ
Form: chi nhánh, chọn món (tìm nhanh), tùy chọn, số lượng, cách nhận, giờ, tên + SĐT, ghi chú, tích "Khách đã
đồng ý qua điện thoại". Thanh toán: tiền mặt khi lấy (O4 thêm "Sao chép link thanh toán").

### 3.5. In
- In qua trình duyệt (`browser-print`): **phiếu bếp** (không giá) và **hóa đơn khách**; khổ 58/80mm/A5.
- Tùy chọn **tự in khi bấm "Nhận"**; nút "In lại".

### 3.6. Admin API (dưới `/ordering/...` của Admin)

| Route | Input | Output |
| --- | --- | --- |
| `GET /orders/board` | chi nhánh, ngày, tìm kiếm | thẻ theo cột + số đếm (**số query cố định**) |
| `GET /orders/:id` | — | chi tiết + timeline |
| `POST /orders/:id/transition` | bước đích, lý do (nếu cần), `expectedVersion` | đơn sau khi chuyển; `ORDER_ALREADY_HANDLED` nếu người khác đã xử lý |
| `POST /orders/:id/collect-cash-and-complete` | số tiền nhận | ghi tiền + hoàn tất **trong 1 transaction** |
| `POST /orders/:id/cancel-lines` | dòng, số lượng, lý do | đơn sau khi hủy món + khoản hoàn |
| `POST /orders/:id/notes` | nội dung, `notifyCustomer` | timeline |
| `POST /orders` (staff) | như storefront + `origin=staff` | đơn mới |
| `POST /branches/:code/pause` | thời lượng | trạng thái tạm ngưng |
| `GET /orders/stream` | — | SSE đơn mới, đổi trạng thái |
| `GET /orders/:id/print` | mẫu, khổ giấy | HTML in |

Mọi route kiểm quyền + scope chi nhánh ở service; ẩn nút khi không có quyền thay vì báo lỗi sau.

## 4. Đã làm

Engine chuyển bước, khóa dòng, scope, hủy một phần, change-log có từ O1. Hộp thư đặt bàn của app đã có mẫu SSE
dùng lại được.

## 5. Chưa làm

1. Sidebar + submenu + đăng ký quyền.
2. Admin API ở 3.6 (gồm SSE).
3. Màn Đơn hàng dạng thẻ + 1 nút chính + menu "Khác".
4. Hộp thoại đơn mới + âm báo cấu hình được.
5. Lý do có sẵn, "Không thể hoàn tất", hủy 1 món, thu tiền mặt.
6. Tạo đơn hộ.
7. In qua trình duyệt (2 mẫu, 3 khổ).
8. Thống kê nhanh, tạm ngưng, tìm kiếm.
9. Bản dịch VI/EN (VI mặc định).
10. Hướng dẫn tạo role `Staff` trong `docs/admin-roles.md`.

## 6. Lỗi dự kiến và cách chặn

| Rủi ro | Cách chặn |
| --- | --- |
| Hai người bấm cùng đơn | `expectedVersion` + khóa dòng; báo "đã được xử lý" |
| Bảng đơn chậm khi nhiều đơn (N+1 khi lấy món, thanh toán từng đơn) | 1 query đơn + nạp dòng/thanh toán theo lô; test đếm query |
| SSE rớt kết nối trên tablet | Tự nối lại + polling dự phòng; không báo trùng đơn đã báo |
| Trình duyệt chặn âm thanh khi chưa có thao tác | Nút "Bật âm báo" khi mở màn; hiện trạng thái âm báo rõ ràng |
| "Thu tiền và giao" lỗi giữa chừng | 1 transaction: không có tiền thì không đổi bước |
| Nhân viên thấy đơn chi nhánh khác | Scope ở service cho mọi route; script kiểm |
| File `.tsx` phình to | Tách `OrderBoard/components/{OrderColumn,OrderCard,OrderActions,ReasonPicker}`; React Query cho dữ liệu |

## 7. Edge case

- Đơn mới vào khi đang mở hộp thoại một đơn khác → xếp hàng, không đè.
- Tablet mất mạng rồi có lại → đồng bộ lại bảng, không mất đơn.
- Đơn đã trả trước bị "Không thể hoàn tất" → tạo hoàn tiền, nhắc ghi nhận hoàn tay.
- Hủy 1 món trong đơn đã thu tiền mặt → tổng và tiền hoàn đúng.
- Tài khoản bị vô hiệu hóa giữa ca → bị đăng xuất, thao tác đang dở bị từ chối.
- Nhân viên được gán 2 chi nhánh → chọn chi nhánh; gán 1 → ẩn ô chọn.
- Màn hình hẹp (điện thoại) → cột xếp chồng, nút chính vẫn đủ lớn.
- Đơn quá giờ hẹn → thẻ đỏ.

## 8. Phần dễ tốn thời gian nhất (dự kiến) và vì sao

**Realtime + âm báo ổn định trên tablet.** Lý do: SSE qua proxy/Cloudflare dễ bị buffer hoặc cắt; tablet ngủ màn
hình làm mất kết nối; trình duyệt chặn âm thanh khi chưa có thao tác; phải tránh báo trùng và không bỏ sót đơn.
Lỗi chỉ tái hiện trên thiết bị thật, khó test tự động.

**Thứ hai: giữ UI đơn giản.** Mỗi tính năng thêm vào (hủy món, ghi chú, in) đều kéo màn hình phức tạp lên;
cần thử với người thật và cắt bớt, tốn vòng lặp.

## 9. Gate / Acceptance

lint, typecheck, test, build, `check:ordering` (thêm script board-query-count, concurrent-accept, collect-cash-tx,
staff-scope-routes). UAT trên tablet:
- [ ] Người chưa dùng xử lý 1 đơn trong ~1 phút không cần hướng dẫn.
- [ ] Đơn mới hiện hộp thoại + âm báo ở mọi trang; lặp theo cài đặt.
- [ ] Nhận → Bắt đầu làm → Đã xong → Thu tiền và giao; đơn hoàn tất.
- [ ] Từ chối, hủy, không thể hoàn tất đều bắt chọn lý do.
- [ ] Tạo đơn hộ cho khách gọi điện, chạy tới hoàn tất.
- [ ] In phiếu bếp khổ 80mm từ trình duyệt.
- [ ] Hai nhân viên hai chi nhánh chỉ thấy đơn của mình.
- [ ] Đổi Admin sang English thấy đủ chuỗi.

## 10. Tài liệu chi tiết

`highlevel.md` mục 5.6, 10, 11.3–11.5; `docs/plans/ordering-o3-screens.md` (bản cũ, chỉ tham khảo); contracts
mục 19.2, 21.3, 21.5, 21.6.
