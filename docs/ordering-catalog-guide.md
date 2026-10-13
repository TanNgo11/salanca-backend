# Hướng dẫn nhập catalog bán online (Ordering)

Tài liệu cho nhân viên nhập liệu. Catalog của plugin `ordering` gồm: **Danh mục bán
hàng** (cây), **Sản phẩm bán online** → **Biến thể** → **Giá**, **Nhóm tùy chọn** →
**Tùy chọn**, **Khung giờ bán**, và trạng thái **Tạm hết món** theo chi nhánh.

Hai màn hình chuyên dụng trong menu **Ordering** của Admin:

- **Ordering → Danh mục**: cây danh mục, thêm/sửa/xóa, kéo-thả đổi thứ tự và cha.
- **Ordering → Tạm hết món**: bật/tắt bán theo chi nhánh cho sản phẩm/biến thể/tùy chọn.

Phần còn lại nhập qua **Content Manager** (collection **Sản phẩm bán online**, **Biến
thể**, **Giá**, **Nhóm tùy chọn**, **Tùy chọn**, **Khung giờ bán**).

## Điều kiện để món hiện lên web/order được

Một sản phẩm chỉ bán online khi thỏa **tất cả**:

1. `status` = **active** (không phải `draft`/`archived`).
2. `sellOnline` bật.
3. Có ít nhất một biến thể có giá hợp lệ tại thời điểm bán.
4. Trong **Khung giờ bán** nếu sản phẩm/danh mục có gắn khung giờ.
5. Không bị **Tạm hết món** tại chi nhánh của đơn.
6. Danh mục chứa nó không ở trạng thái tắt (`isActive`) và không phải `isInternal`
   (danh mục nội bộ không xuất hiện trên API công khai).

## Trường đa ngôn ngữ (`{vi, en, ...}`)

Các ô **Tên**, **Mô tả**, **Slug** trên danh mục/sản phẩm/biến thể/tùy chọn hiển thị
một ô nhập **cho mỗi ngôn ngữ đang bật** (vi, en). Đây là một giá trị duy nhất — không
phải hai bản dịch tách rời như content i18n thường:

- Nhập đủ `vi` (bắt buộc) và `en` nếu web hiển thị tiếng Anh.
- Để trống `slug`: hệ thống tự sinh slug theo tên **từng locale** khi lưu
  (`bun-bo-hue` / `hue-beef-noodle`). Không đổi slug sau khi URL đã public trừ khi có
  kế hoạch redirect.

## Quy trình nhập một món mới

### 1. Danh mục — Ordering → Danh mục

- **Thêm danh mục gốc**: nút trên đầu trang. **Thêm con**: nút `+` trên dòng cha.
- **Sửa**: tên (vi/en), slug, mô tả, `isActive`, `isInternal`.
- **Sắp xếp / đổi cha**: kéo-thả trực tiếp trên cây, hoặc dùng nút ↑/↓ và ô chọn cha.
  Cấm chọn chính nó hoặc con cháu làm cha (chống vòng lặp).
- **Xóa**: bị chặn khi còn danh mục con — phải dời/xóa con trước. Nếu danh mục còn sản
  phẩm, hệ thống hỏi xác nhận: sản phẩm **không bị xóa** nhưng mất liên kết — danh sách
  sản phẩm bị "mất danh mục" được liệt kê để gán lại sau.

### 2. Sản phẩm — Content Manager → Sản phẩm bán online

| Trường | Ý nghĩa |
| --- | --- |
| `productType` | `food` (mặc định; giữ nguyên nếu chưa có loại khác) |
| `name` | Tên theo từng locale (bắt buộc) |
| `description`, `slug` | Mô tả / slug theo locale; slug tự sinh nếu để trống |
| `categories` | Danh mục chứa món (chọn nhiều được) |
| `image` | Ảnh món |
| `status` | `draft` → `active` khi sẵn sàng bán; `archived` = ngừng |
| `sellOnline` | Bắt buộc bật để lên web |
| `minQuantity` | Số lượng tối thiểu mỗi dòng đơn (mặc định 1) |
| `fulfillmentKinds` | `["pickup","delivery"]` — hình thức nhận hàng hỗ trợ |
| `modifierGroups` | Gắn nhóm tùy chọn (xem mục 4) |
| `bundleSlots` | Định nghĩa combo (xem mục 5) |
| `availabilityWindows` | Khung giờ bán (xem mục 6) |

### 3. Biến thể và giá

Mỗi sản phẩm có **ít nhất một biến thể** (mặc định), mỗi biến thể có **ít nhất một giá**.

**Biến thể** — Content Manager → Biến thể:

- `product`: sản phẩm cha; `name` theo locale (vd "Tô thường"/"Tô đặc biệt"); `sku`
  duy nhất nếu có mã kho; `isDefault` bật cho biến thể bán mặc định; `rank` thứ tự.
- `attributes`: JSON tự do cho kích cỡ/thuộc tính hiển thị.

**Giá** — Content Manager → Giá:

- `variant`: biến thể được định giá; `amount`: số nguyên VND (65000 = 65.000 ₫);
  `compareAtAmount`: giá gốc gạch ngang (khuyến mãi); `currency`: `VND`.
- `rules` (JSON, có thể trống): `{"locationRef":"Q1"}` (giá riêng chi nhánh),
  `{"channel":"web"}` (kênh), `{"customerGroup":"vip"}`. Hàng có nhiều rule khớp hơn
  được ưu tiên; hàng rule lệch ngữ cảnh bị loại. `priority` phá hòa.
- `validFrom`/`validTo`: cửa sổ theo thời gian.
- `minQuantity`: giá chỉ áp dụng khi số lượng ≥ ngưỡng (giá sỉ theo số lượng).
- `rules.channel`: `pickup`, `delivery`, `dine-in` hoặc `staff`. Kênh cũ `web-checkout` không còn là kênh giá
  (migration `0009-o14-price-lists` bỏ rule đó); `phone-staff` được đổi thành `staff`.
- `rules.weekdays` (`mon`…`sun`) và `rules.timeRanges` (`{start,end}` giờ địa phương chi nhánh, cuối khoảng
  không tính). Khoảng qua đêm khi `end` nhỏ hơn `start`. Không có timezone thì rule giờ không khớp.

### 3b. Bảng giá và nhóm khách (O14) — Món → Bảng giá, Vận hành → Nhóm khách

Quyền `price.manage`. Không sửa từng dòng giá trong Content Manager cho các bảng này.

- **Giá riêng (override):** mỗi món/biến thể một giá. Hệ thống nhân điều kiện (kênh × chi nhánh × nhóm)
  thành các dòng giá catalog. Tắt bảng thì các dòng vẫn còn nhưng không được chọn.
- **Điều chỉnh (adjust):** giảm % hoặc số tiền trên giá đã chọn. Không cộng dồn nhiều bảng: ưu tiên cao
  nhất thắng; hòa ưu tiên thì lấy giá thấp hơn. Giảm làm tròn xuống đồng, không âm, không vượt giá gốc.
  Khi giá giảm, `compareAtAmount` là giá trước điều chỉnh.
- **Nhóm khách:** mã không đổi sau khi tạo. Thành viên tay (`manual`) hoặc tự động (`auto`: tổng chi,
  số đơn hoàn tất, và/hoặc trong N ngày). Job `customer-group-refresh` (03:15 mỗi ngày) chỉ gỡ thành viên
  tự động không còn đủ điều kiện. Gỡ tay một khách tự động: job hôm sau có thể thêm lại nếu khách vẫn đủ
  điều kiện.
- Giá nhóm chỉ áp khi khách đã đăng nhập (`X-Customer-Token`) hoặc khi nhân viên tạo đơn hộ và số điện
  thoại khớp hồ sơ. Khách vãng lai luôn trả giá thường, kể cả khi số trùng hồ sơ trong nhóm.
- Khuyến mãi tính **sau** bảng giá. Đơn đã đặt giữ giá lúc đặt; sửa đơn chỉ tính lại dòng mới theo nhóm
  của hồ sơ đang gắn vào đơn.

### 4. Tùy chọn (modifier) — thư viện dùng chung

Nhóm/tùy chọn là **thư viện** — tạo một lần, gắn vào nhiều món:

1. **Nhóm tùy chọn**: `name`, `selectionType` (`single` = chọn 1, `multiple` = chọn
   nhiều, `quantity`, `text`), `minQuantity`/`maxQuantity`, `freeQuantity` (số tùy
   chọn miễn phí), `rank`.
2. **Tùy chọn**: `group` (nhóm cha), `name` theo locale, `priceDelta` (phụ thu VND,
   0 = miễn phí), `rank`.
3. Gắn vào món: mở **Sản phẩm** → field `modifierGroups` → thêm dòng `{groupRef,
   required, min, max, freeQuantity, rank, overrides}` — `groupRef` là documentId của
   nhóm (ô nhập có gợi ý). `overrides` cho phép đổi giá/ẩn/mặc định **riêng cho món
   này** mà không sửa thư viện: `{<modifierId>: {"priceDelta": 25000}}` hoặc
   `{"hidden": true}` / `{"isDefault": true}`.
4. Nhóm `required` với `min ≥ 1` bắt khách phải chọn trước khi đặt.

### 5. Combo — `bundleSlots` trên sản phẩm

Combo là một **sản phẩm** có `bundleSlots`. Mỗi slot: `{key, name, selection,
required, min, max, rank, items}`; mỗi item: `{variantRef, quantity, isDefault,
priceDelta}` — `variantRef` là documentId của **biến thể** thành phần.

- Slot `required` bắt buộc khách chọn (vd "Món chính"); `required:false` + `min:0` là
  slot tùy chọn thêm.
- `priceDelta` cộng vào giá combo khi khách chọn item đó (vd nâng "Tô đặc biệt" +20k).
- Giá combo = giá biến thể combo + tổng `priceDelta` của các item được chọn.
- Item thuộc món bị **tạm hết** tại chi nhánh thì không chọn được; slot bắt buộc hết
  item chọn được → combo hiện "tạm hết".

### 6. Khung giờ bán

Content Manager → **Khung giờ bán**: `name`, `startTime`/`endTime` (giờ địa phương chi
nhánh), `daysOfWeek` (mảng số 0–6, trống = mọi ngày), `validFrom`/`validTo`, `isActive`,
`rank`, và gắn vào `category` **hoặc** `product`.

- Món chỉ bán trong khung giờ đang chạy (vd "Chỉ buổi trưa 11:00–14:00").
- `endTime` nhỏ hơn `startTime` = khung qua đêm (vd 20:00–02:00).

## 7. Tạm hết món — Ordering → Tạm hết món

Dùng khi hết nguyên liệu trong ngày — **không phải** cách ngừng bán lâu dài (dùng
`status`/`sellOnline`):

1. Chọn **chi nhánh** trong phạm vi của bạn (nhân viên chỉ thấy chi nhánh được giao).
2. Tìm sản phẩm/biến thể/tùy chọn → gạt **tắt**.
3. Chọn thời điểm tự mở lại: **đến hết ngày kinh doanh** (theo giờ đóng cửa của chi
   nhánh) hoặc **giờ cụ thể**.
4. Gạt **bật** lại để mở bán ngay; hết hạn thì tự mở.

Mọi thao tác tắt/bật và sửa danh mục đều ghi vào **Nhật ký hoạt động** (ai làm, lúc
nào, chi nhánh nào).

## 7b. Nhập/xuất hàng loạt bằng CSV — Món → Nhập/xuất

Khi cần sửa nhiều món cùng lúc, dùng màn **Món → Nhập/xuất** (hoặc nút **Xuất CSV** trên màn Danh mục):
tải `products.csv` / `modifiers.csv`, sửa trong Excel, nhập lại qua "Kiểm tra" rồi "Áp dụng". Khớp
dòng theo slug món / SKU biến thể / mã nhóm tùy chọn; nhập chỉ tạo-sửa, không xóa. Chi tiết định dạng
và giới hạn: [`ordering-integrations.md`](ordering-integrations.md) mục 3; hướng dẫn theo từng bước:
[`ordering-staff-guide.md`](ordering-staff-guide.md) mục "Nhập/xuất menu bằng CSV".

## 8. Lưu ý

- Đơn hàng lưu **snapshot** tên/danh mục/biến thể/tùy chọn/thành phần combo lúc đặt —
  sửa catalog sau này không đổi nội dung đơn cũ.
- Xóa biến thể/sản phẩm đã có trong đơn không ảnh hưởng đơn cũ, nhưng nên dùng
  `archived` thay xóa để giữ lịch sử.
- API công khai: `GET /api/v1/ordering/catalog/products` (thêm `?locale=en` để xem
  bản tiếng Anh) — kiểm tra món có hiện chưa trước khi báo lỗi.
- `isFeatured` (Món nổi bật) là trường riêng của app — xem CMS guide nếu được giao
  quyền sửa.
