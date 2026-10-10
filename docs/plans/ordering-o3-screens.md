# O3 — Đặc tả màn hình Admin

Ngày: 2026-10-10. Bổ sung cho spec [`phases/phase-ordering-3-pickup-cash.md`](../phases/phase-ordering-3-pickup-cash.md),
kế hoạch [`ordering-o3-pickup-cash.md`](ordering-o3-pickup-cash.md) và mockup
[`mockups/ordering-o3-pickup-cash.html`](mockups/ordering-o3-pickup-cash.html). Mỗi quyết định giao diện dựa trên
nghiên cứu [`ordering-reference.md` mục U3](ordering-reference.md) (TastyIgniter, Medusa, Saleor, Vendure,
WooCommerce).

Quy ước cho người code:

- Tên route API là đề xuất. Được đổi khi code, nhưng phải sửa lại file này trong cùng commit.
- Mọi route Admin nằm dưới Admin API (`/ordering/admin/...`), cần đăng nhập Admin, kiểm action và scope chi nhánh
  ở **service** (không chỉ ẩn nút). Ngoài scope trả `ORDER_NOT_FOUND` (404).
- Chuỗi giao diện đặt trong `admin/src/translations/{vi,en}.json`, không viết cứng.
- Bố cục trang dùng `Layouts`/`Page` của `@strapi/strapi/admin`; gọi API bằng `useFetchClient`; thông báo bằng
  `useNotification`; ẩn/hiện theo quyền bằng `useRBAC`. Component từ `@strapi/design-system` (U3.7).
- Tiền hiển thị dạng `175.000đ` (`Intl.NumberFormat('vi-VN')`), giờ theo **timezone của chi nhánh**, không theo
  máy người xem.
- Số điện thoại trong danh sách che giữa (`090•••4567`); xem đủ trong chi tiết.
- Mọi màn có đủ 5 trạng thái: **đang tải** (`Loader` hoặc skeleton), **trống** (`EmptyStateLayout` có câu hướng
  dẫn), **lỗi** (`Alert` + nút thử lại), **không có quyền** (trang 403 của Strapi), **đang lưu** (nút `loading`,
  chặn bấm lại).

## S1. Hộp đơn (danh sách)

- Route Admin: `/plugins/ordering/orders`. Menu "Bán hàng" có badge số đơn chờ nhận.
- Quyền: `plugin::ordering.order.read`.
- API: `GET /ordering/admin/orders?tab=&branch=&businessDate=&q=&payment=&receive=&page=&pageSize=`
  → `{ results: OrderRow[], pagination, counts: { awaiting, preparing, ready, done, canceled, all } }`.

Bố cục (theo TastyIgniter + WooCommerce):

1. Header: tiêu đề "Đơn hàng", phụ đề "Ngày kinh doanh dd/MM · <chi nhánh>"; nút **+ Tạo đơn hộ** (chỉ khi có
   `order.create`).
2. Hàng lọc: `Select` chi nhánh (chỉ chi nhánh trong scope; mặc định chi nhánh đầu tiên, nhớ lựa chọn trong
   `localStorage`), `DatePicker` ngày kinh doanh (mặc định hôm nay theo giờ chốt), `Searchbar` (mã đơn, SĐT, tên),
   `Select` cách trả, `Select` cách nhận.
3. `Tabs` có số đếm: **Chờ nhận** · Đang chuẩn bị · Sẵn sàng · Xong · Hủy · Tất cả. Tab là nhóm bước, không phải
   từng state.
4. `Table`:

| Cột | Nội dung | Ghi chú |
| --- | --- | --- |
| Mã | `SLC-000124`, đậm khi chưa ai mở | sắp xếp được |
| Giờ lấy | `12:30` hoặc badge `ASAP` | theo giờ chi nhánh |
| Khách | tên · SĐT che | |
| Món | `2 món` | tooltip liệt kê |
| Tổng | `175.000đ` | căn phải |
| Thanh toán | `Badge`: Đã trả / Trả khi nhận / Chờ chuyển khoản / Hoàn một phần | |
| Trạng thái | `Badge` theo bước | |
| Chờ | phút từ lúc đặt; đỏ khi quá `slaMinutes` | |
| Nguồn | Web / Gọi điện | |
| (thao tác) | `IconButton` **Xem nhanh** (S3) và nút bước kế tiếp chính (vd. "Nhận") | |

5. Bấm dòng → S4. Phân trang 20 dòng.

Trạng thái: trống theo tab ("Chưa có đơn chờ nhận"), lọc không ra kết quả ("Không có đơn khớp bộ lọc" + nút xóa lọc).

Realtime: SSE `GET /ordering/admin/stream` (chỉ event của chi nhánh trong scope); polling
`GET /ordering/admin/orders/summary?since=` mỗi 20 giây làm dự phòng. Có đơn mới → cập nhật số đếm, chèn dòng tô
vàng ở đầu tab Chờ nhận, và mở S2.

## S2. Hộp thoại đơn mới (trên mọi trang Admin)

Theo TastyIgniter `status_workflow_modal`.

- Hiện khi có event `order.created` của chi nhánh trong scope và người dùng có `order.process`. Gắn ở cấp app
  admin (như widget hộp thư đặt bàn), nên hiện ở mọi trang.
- Nhiều đơn mới cùng lúc → xếp hàng, hiện "1/3".
- `Modal` không tự đóng khi bấm ra ngoài; có âm báo nếu người dùng bật (lưu `localStorage`, như hộp thư đặt bàn).

Nội dung: "Salanca Q1 · **SLC-000124** · Tự lấy lúc 12:30 (hoặc ASAP)", danh sách món rút gọn (tên × SL, tùy chọn
in nhỏ), ghi chú cả đơn, tổng và trạng thái thanh toán.

Nút:

| Nút | API | Ghi chú |
| --- | --- | --- |
| **Nhận** (primary) | `POST /ordering/admin/orders/:id/transition { to: <bước nhận>, notifyCustomer: true }` | |
| **Nhận và lùi ▾** (`SimpleMenu`: 10 / 20 / 30 phút từ setting) | như trên + `delayMinutes` | dời `estimatedReadyAt`, báo khách giờ mới |
| **Từ chối ▾** (`SimpleMenu` lý do từ setting + "Lý do khác…") | `transition { to: <bước từ chối>, reasonCode, note }` | lý do khác mở `Textarea` bắt buộc |
| Để sau | đóng hộp thoại, đơn vẫn ở tab Chờ nhận | |

Lỗi `INVALID_TRANSITION` (người khác đã xử lý) → thông báo "Đơn đã được <tên> xử lý", tải lại đơn.

## S3. Xem nhanh

Theo WooCommerce Preview. `Modal` mở từ S1: thông tin như S2 + nút bước kế tiếp + link "Mở chi tiết". Không sửa
được gì khác.

## S4. Chi tiết đơn

- Route: `/plugins/ordering/orders/:code`. Quyền `order.read`.
- API: `GET /ordering/admin/orders/:id` → đơn, group, line (snapshot), adjustment, payment, refund, timeline, các
  bước kế tiếp hợp lệ (`nextTransitions: [{ to, label, kind: 'primary'|'danger', requires: ['reason'|'cash'] }]`).

Header: mã + badge trạng thái bước + badge thanh toán; phụ đề "Đặt hh:mm · Lấy hh:mm (hoặc ASAP) · <chi nhánh>
· Nguồn". Bên phải: các nút bước kế tiếp lấy từ `nextTransitions` (theo Vendure: nút sinh từ workflow, không viết
cứng) + `SimpleMenu` "…" gồm Hủy đơn, In phiếu (để sau), Sao chép link khách.

Hai cột (theo Medusa):

| Cột trái | Cột phải |
| --- | --- |
| **Món**: bảng tên + biến thể, tùy chọn và ghi chú in nhỏ, SL, thành tiền; mỗi dòng `IconButton` "Hủy món" (quyền `order.edit-lines`); dòng đã hủy một phần hiện "đã hủy 1" | **Khách**: tên, SĐT đầy đủ (nút gọi `tel:`), email nếu có, đồng ý xử lý dữ liệu (kênh, thời điểm) |
| **Tiền**: tạm tính, từng khoản giảm/phí, làm tròn tiền mặt (nếu có), tổng, đã thu, đã hoàn, còn thiếu | **Nhận hàng**: cách nhận, giờ lấy, `estimatedReadyAt`, chi nhánh |
| **Thanh toán**: danh sách payment và refund (cách trả, số tiền, người ghi, thời điểm) | **Lịch sử** (S4b) |
| Ghi chú cả đơn của khách (`Alert` info) | |

### S4b. Lịch sử và ghi chú nội bộ

Theo Medusa `order-activity-section` + Saleor `OrderHistory`.

- Dòng thời gian mới nhất ở trên: nội dung, người làm, thời gian tương đối ("5 phút trước", tooltip giờ đầy đủ),
  nhãn **Khách thấy** cho event `isPublic`.
- Ô "Thêm ghi chú nội bộ" (`Textarea` + nút) → `POST /ordering/admin/orders/:id/notes { text }` (≤ 1000 ký tự,
  `isPublic=false`, quyền `order.process`).

## S5. Các hộp thoại thao tác

Mọi hộp thoại dùng `Modal` (hoặc `Dialog` cho xác nhận ngắn), nút chính đổi màu theo mức độ (danger cho hủy/từ
chối/hoàn), nút "Hủy bỏ" bên trái. Gửi xong → `useNotification` thành công, tải lại đơn.

| Hộp thoại | Field | API | Quy tắc |
| --- | --- | --- | --- |
| Chuyển bước (khi bước có `requires`) | Ghi chú (tùy chọn), **Báo khách** `Switch` (mặc định bật nếu bước `isPublic`) | `transition { to, note, notifyCustomer }` | theo TastyIgniter `orderstatus` |
| Từ chối | Lý do `Select` từ setting, "Lý do khác" `Textarea` | `transition { to: rejected, reasonCode, note }` | bắt buộc lý do |
| Hủy đơn | Lý do, ghi chú; nếu đã thu tiền: hiện "Sẽ hoàn X đ tiền mặt" | `POST .../cancel { reasonCode, note }` | quyền `order.cancel`; chỉ khi workflow cho phép |
| **Thu tiền và giao** | Số cần thu (chỉ đọc), cách trả `Toggle` Tiền mặt / Chuyển khoản tại quầy | `POST .../cash-handover { method }` | một transaction; lỗi thì không đổi gì |
| **Hủy món** | Số lượng `NumberInput` (1..còn lại), lý do bắt buộc; hiện số tiền hoàn tính trước | `POST .../lines/:lineId/cancel { quantity, reason }` | quyền `order.edit-lines`; hoàn theo số đã phân bổ |
| Hoàn tiền mặt | Số tiền (≤ tối đa được hoàn, hiện "tối đa X đ"), lý do | `POST .../refunds { method: 'cash', amount, reason }` | theo Vendure `refund-order-dialog`; quyền `refund.manage` |

Số tiền hoàn hiện trước khi bấm lấy từ `GET .../lines/:lineId/cancel-preview?quantity=` để khớp đúng số server sẽ
ghi (không tự tính ở trình duyệt).

## S6. Tạo đơn hộ

Theo Saleor `OrderDraftPage` + Vendure draft.

- Route: `/plugins/ordering/orders/new` (tạo nháp ngay khi mở) và danh sách nháp ở tab "Nháp" của S1.
- Quyền: `order.create`. Chi nhánh chỉ trong scope.
- API: `POST /ordering/admin/drafts` → nháp; `PATCH /ordering/admin/drafts/:id` (lines, contact, receive, consent);
  `POST /ordering/admin/drafts/:id/quote` → giá; `POST /ordering/admin/drafts/:id/confirm` → đơn thật;
  `DELETE /ordering/admin/drafts/:id`.

Bố cục hai cột:

| Trái | Phải |
| --- | --- |
| `Combobox` tìm món (gọi API catalog của O2); chọn món mở `Modal` chọn biến thể, tùy chọn, SL, ghi chú; bảng món đã chọn có sửa SL và xóa | Chi nhánh `Select`; Khách: tên *, SĐT * (kiểm số Việt Nam), email; Nhận hàng: Tự lấy + slot `Select` (từ API slot) hoặc ASAP; Thanh toán: Trả khi nhận; `Checkbox` "Khách đã đồng ý xử lý dữ liệu qua điện thoại" * |
| Tổng tiền do server báo giá; đổi gì cũng báo giá lại | Nút **Lưu nháp**, **Xác nhận đơn** (disabled đến khi đủ field bắt buộc) |

Giá không sửa tay ở v1. Xác nhận lỗi `PRICE_CHANGED`/`SELLABLE_UNAVAILABLE` → hiện ngay trên dòng món liên quan.

## S7. Chi nhánh

- Route: `/plugins/ordering/branches` (danh sách) và `/plugins/ordering/branches/:code`.
- Quyền: xem `settings.manage`; chỉ chi nhánh trong scope trừ khi `allLocations`.
- API: `GET/POST /ordering/admin/branches`, `GET/PATCH /ordering/admin/branches/:code`.

Danh sách: tên, mã, bán online (badge), cách nhận đang bật, số nhân viên. Nút **+ Thêm chi nhánh**.

Trang sửa: `Tabs`:

1. **Thông tin**: mã (chỉ đọc sau khi tạo), tên VI/EN, địa chỉ, SĐT, email, múi giờ `Select` (mặc định
   `Asia/Ho_Chi_Minh`), giờ chốt ngày kinh doanh `TimePicker` (04:00), bật bán online `Switch`.
2. **Giờ mở**: theo TastyIgniter `workinghour`: kiểu `Toggle` 24/7 · Hằng ngày · Theo từng ngày; "Theo từng ngày"
   là bảng 7 dòng, mỗi dòng nhiều ca (mở – đóng), đóng nhỏ hơn mở hiển thị "qua nửa đêm"; ngày nghỉ lễ (danh sách
   ngày).
3. **Tự lấy** (theo TastyIgniter `collectionsettings`):

| Field | Kiểu | Mặc định | Ghi chú |
| --- | --- | --- | --- |
| Nhận tự lấy | `Switch` | bật | |
| Cho đặt | `Toggle` ASAP · Đặt trước · Cả hai | Cả hai | |
| Thời gian chuẩn bị tối thiểu | `NumberInput` phút | 180 | "tối thiểu 3 giờ" |
| Khoảng slot | `NumberInput` phút | 15 | |
| Sức chứa mỗi slot | `NumberInput` đơn | 8 | |
| Đặt trước tối đa | `NumberInput` ngày | 7 | |
| Đơn tối thiểu | `NumberInput` đ | 0 | |
| Khách tự hủy trước giờ lấy | `NumberInput` phút | 30 | sau đó nút hủy của khách ẩn |
| Thời điểm trả tiền | `Select` Trả trước · Quán nhận rồi trả · Trả khi nhận | Trả khi nhận | |
| Cách trả | `Checkbox` Tiền mặt (SePay ở O4) | Tiền mặt | |
| Làm tròn tiền mặt | `Select` Không · 1.000đ | Không | |
| Báo chậm khi chờ nhận quá | `NumberInput` phút | 10 | `slaMinutes` |

4. **Giao tận nơi**: tab hiện "Có ở O5", disabled.

Lưu: `PATCH` một lần cho cả trang; `Alert` "Đổi cài đặt chỉ áp dụng cho đơn mới" trên nút lưu; lỗi validate hiện
dưới đúng field.

## S8. Nhân viên và chi nhánh

- Route: `/plugins/ordering/staff`. Quyền `scope.manage`.
- API: `GET /ordering/admin/staff-scopes` (kèm admin user: tên, email, role); `PUT /ordering/admin/staff-scopes/:adminUserId
  { allLocations, locationRefs }`.

Bảng: nhân viên, role Strapi, chi nhánh (`Tag` mỗi chi nhánh hoặc "Tất cả chi nhánh"), nút Sửa. Người chưa có scope:
`Badge` đỏ "Chưa gán: không thấy đơn nào", lên đầu bảng.

`Modal` sửa (theo Saleor "Channels permissions"): `Switch` **Xem mọi chi nhánh**; khi tắt, `Combobox` chọn nhiều chi
nhánh có tìm. Super Admin hiện "Mặc định xem mọi chi nhánh", không sửa được.

## S9. Cài đặt bán hàng chung

- Route: Settings → "Bán hàng" (`app.addSettingsLink`, như "Email thông báo" của app). Quyền `settings.manage`.
- API: `GET/PUT /ordering/admin/settings`.

| Field | Kiểu | Mặc định |
| --- | --- | --- |
| Hiện hộp thoại đơn mới (S2) | `Switch` | bật |
| Âm báo đơn mới mặc định | `Switch` | bật |
| Lý do từ chối | danh sách (mã + nhãn VI/EN), thêm/xóa/sắp xếp | Hết món · Quá tải · Ngoài giờ · Không liên lạc được khách |
| Số phút lùi khi nhận | danh sách số | 10, 20, 30 |

## Dữ liệu cần thêm so với O1 (phát sinh từ nghiên cứu UI)

- `fulfillment-group.estimatedReadyAt` (UTC): đặt khi nhận đơn (= giờ lấy đã chọn, hoặc bây giờ + thời gian chuẩn bị
  với ASAP), cộng thêm khi "Nhận và lùi"; hiện cho khách và trong email.
- `order-event` của ghi chú nội bộ dùng type `note`, `isPublic=false`.
- Setting chung (S9) lưu bằng `strapi.store({ type: 'plugin', name: 'ordering' })`.
- `branch.fulfillment.pickup` thêm `orderTiming` (asap/scheduled/both), `minOrderAmount`,
  `customerCancelBeforeMinutes`, `maxAdvanceDays`.
