# Hướng dẫn xử lý đơn (nhân viên chi nhánh)

Dành cho nhân viên và quản lý chi nhánh dùng Admin để nhận đơn online và đơn gọi điện (phase O3: khách tự
đến lấy; O5: quán tự giao tận nơi). Hướng dẫn nhập món: `docs/ordering-catalog-guide.md`.

## Trước khi bắt đầu

- Quản trị chuỗi phải gán bạn vào chi nhánh ở **Nhân viên bán hàng**. Chưa gán thì bạn không thấy đơn nào.
- Quyền theo vai trò ở `docs/admin-roles.md` (mục Ordering). Không thấy nút nào đó nghĩa là vai trò của
  bạn chưa có quyền ấy.

## Đơn mới đến

- Hộp thoại **Đơn mới** hiện ở mọi trang Admin, kèm âm báo (bật/tắt ở hộp đơn). Nhiều đơn cùng lúc hiện
  "1/3".
- **Nhận**: đơn sang "Đang chuẩn bị", khách nhận email (nếu có email). Giờ sẵn sàng dự kiến là giờ khách
  chọn, hoặc bây giờ + thời gian chuẩn bị nếu khách đặt ASAP.
- **Nhận và lùi 10/20/30 phút**: như Nhận, dời giờ sẵn sàng; khách nhận email giờ mới.
- **Từ chối**: chọn lý do có sẵn hoặc "Lý do khác…" (bắt buộc ghi). Khách nhận email kèm lý do. Đơn đã chuyển
  khoản trước thì hệ thống tạo phiếu hoàn chờ; chuyển trả xong thì ghi mã ngân hàng trên đơn.
- **Để sau**: đóng hộp thoại; đơn vẫn nằm ở tab **Chờ nhận**.
- Hai người cùng bấm: người sau thấy "Đơn đã được người khác xử lý"; không có gì bị làm hai lần.
- Đơn chờ nhận quá số phút "Báo chậm" của chi nhánh (mặc định 10) thì cột **Chờ** đỏ và email cảnh báo gửi
  về email chi nhánh.

## Hộp đơn (Bán hàng → Đơn hàng)

- Chọn chi nhánh và ngày kinh doanh (mặc định hôm nay theo giờ chốt của chi nhánh, ví dụ 04:00: đơn 01:30
  sáng thuộc ngày hôm trước).
- Tìm theo mã đơn, số điện thoại hoặc tên (tìm thì bỏ qua lọc ngày).
- Tab: Chờ nhận · Đang chuẩn bị · Sẵn sàng · Xong · Hủy · Tất cả · Nháp. Biểu tượng mắt mở xem nhanh.

## Trong chi tiết đơn

- Nút ở góc phải là các bước kế tiếp hợp lệ: Nhận → Sẵn sàng → **Thu tiền và giao**.
- **Thu tiền và giao**: nhận đủ số "Cần thu" rồi bấm. Hệ thống ghi tiền mặt và chuyển đơn sang "Đã giao"
  cùng lúc; nếu lỗi thì không có gì thay đổi, bấm lại. Không giao được khi chưa thu đủ.
- **Hủy món** (biểu tượng thùng rác ở dòng món): chọn số lượng và lý do; số tiền hoàn hiện trước khi bấm,
  tính theo phần giảm giá đã chia lúc đặt. Đơn đã thu tiền thì phiếu hoàn tiền mặt ghi tên bạn.
- **…** → Hủy đơn (bắt buộc lý do; tiền mặt đã thu hoàn cùng lúc, tiền chuyển khoản thành phiếu hoàn chờ), Hoàn tiền mặt (tối đa số
  còn giữ), Sao chép mã đơn.
- **Lịch sử**: chấm "Khách thấy" là bước khách thấy trên trang đơn; ghi chú nội bộ khách không thấy.

## Đơn gọi điện (Tạo đơn hộ)

1. Chọn chi nhánh, tìm món, chọn tùy chọn và số lượng.
2. Nhập tên, số điện thoại Việt Nam, email nếu khách có.
3. Chọn ASAP hoặc giờ lấy.
4. Tích **Khách đã đồng ý xử lý dữ liệu qua điện thoại** (bắt buộc).
5. **Lưu nháp** (giữ chỗ khung giờ) hoặc **Xác nhận đơn** (vào hộp đơn ngay). Giá lấy từ catalog, không sửa
   tay.

## Đơn giao tận nơi (Bán hàng → Đơn giao)

- Đơn khách chọn "Giao hàng" chạy qua các tab: **Sẵn sàng** (đợi đi giao) · **Đang giao** · **Giao lỗi** ·
  Tất cả. Nhận đơn, chuẩn bị và chuyển "Sẵn sàng" giống đơn lấy tại quán; từ "Sẵn sàng" trở đi dùng bảng
  Đơn giao.
- **Phân công**: mỗi chuyến giao cần một người phụ trách trước khi đi. Chọn **Gán người giao** rồi chọn
  nhân viên cùng chi nhánh (danh sách chỉ gồm người trong phạm vi của bạn). Giao bằng xe ngoài thì chọn
  **Hãng xe ngoài** và nhập tên hãng + mã vận đơn; hệ thống tự điền link tra cứu nếu hãng có mẫu URL.
- **Đi giao**: chuyển chuyến sang "Đang giao"; khách nhận email đang trên đường giao. Đơn tiền mặt chỉ đi
  được khi đã có người giao hoặc hãng xe.
- **Giao lỗi**: chọn lý do (Không liên lạc được / Sai địa chỉ / Khách từ chối / Khác). Khách nhận email
  kèm lý do. Từ "Giao lỗi" bấm **Giao lại** để đưa chuyến về "Sẵn sàng" chờ chuyến sau — khách nhận email
  báo sẽ giao lại.
- **Thu tiền và giao xong**: đơn tiền mặt thu tiền mặt tận nơi (ghi nhận người thu là người giao); đơn đã
  trả trước chỉ cần xác nhận xong. Khách nhận email đã giao.
- Cột **Người giao** lọc theo: Chưa gán · Của tôi · Người khác · một nhân viên cụ thể.

## Khách tự hủy, tra cứu

- Khách tự hủy được khi đơn còn chờ quán nhận và trước mốc "Khách tự hủy trước giờ lấy" của chi nhánh. Sau
  đó khách phải gọi chi nhánh.
- Khách không để email tra cứu bằng mã đơn + số điện thoại trên website; chỉ thấy trạng thái.

## Cài đặt (quản lý)

- **Chi nhánh**: giờ mở (cho phép qua nửa đêm), ngày nghỉ, thời gian chuẩn bị tối thiểu (180 = 3 giờ),
  khoảng slot, sức chứa mỗi slot, đặt trước tối đa, đơn tối thiểu, hạn khách tự hủy, cách trả, báo chậm.
  Đổi cài đặt chỉ áp dụng cho đơn mới.
- **Cài đặt → Bán hàng**: bật hộp thoại đơn mới, âm báo mặc định, danh sách lý do từ chối, số phút lùi.
- **Tab Giao hàng của chi nhánh**: bật giao tận nơi, thời gian chuẩn bị + đi giao tối thiểu, cách trả và
  các **vùng giao** — mỗi vùng chọn xã/phường theo mã hành chính, phí giao theo nấc tạm tính, đơn tối
  thiểu của vùng và thời gian cộng thêm. Vùng ưu tiên cao thắng khi địa chỉ khớp nhiều vùng. Cần có danh
  mục đơn vị hành chính trước khi bật.

## Chốt tiền mặt cuối ngày (quản lý)

Mục **Báo cáo → Chốt tiền mặt** (quyền Báo cáo) đối chiếu tiền mặt hệ thống ghi nhận với tiền đếm
được, theo từng người thu và ngày kinh doanh:

1. Chọn **chi nhánh** và **ngày kinh doanh** (mặc định hôm nay; đơn sau 04:00 sáng mới tính sang
   ngày mới — đơn nửa đêm vẫn thuộc ngày hôm trước).
2. Bảng liệt kê từng người thu: số đơn, tiền hệ thống ghi nhận, tiền đã hoàn mặt, số **phải có**.
3. Đếm tiền mặt thực tế, nhập vào ô **Đếm được**. Nếu khác số phải có thì **bắt buộc ghi chú** lý
   do chênh lệch rồi bấm **Chốt** và xác nhận.
4. Chênh lệch ≠ 0 sẽ mở cảnh báo "Chốt tiền mặt chênh lệch" và gửi mail cho nhân sự có quyền Báo
   cáo trong chi nhánh (quản lý, kế toán).
5. Sai sau khi chốt: bấm **Điều chỉnh**, nhập lại số đếm và **lý do bắt buộc** — hệ thống tạo bản
   mới (tăng revision), bản cũ giữ lại trong lịch sử. Điều chỉnh về đúng số sẽ tự đóng cảnh báo.

## Báo cáo bán hàng (quản lý, kế toán)

Mục **Báo cáo → Báo cáo** (quyền Báo cáo) xem doanh thu theo **ngày kinh doanh**:

1. Chọn chi nhánh (hoặc "Tất cả trong phạm vi"), khoảng ngày Từ–Đến (mặc định 7 ngày gần nhất) và
   **Nhóm theo**: Ngày, Danh mục, Món, Cách trả hoặc Cách nhận. Bấm **Xem**.
2. Bốn thẻ trên cùng: **Doanh thu** (tiền đã thu qua mọi cách trả, tính theo ngày thu tiền), **Số
   đơn** (đơn đã bán — đơn hủy và nháp không tính), **Giá trị đơn trung bình**, **Đã hoàn** (và dòng
   nhỏ **Thực thu** = doanh thu trừ hoàn).
3. Bảng đổi theo cách nhóm: theo ngày có cột Đã thu / Đã hoàn để đối chiếu; theo Danh mục/Món có số
   lượng và doanh số (tên lấy theo tên lúc khách đặt, đổi tên sau này không ảnh hưởng); theo Cách
   trả/Cách nhận tách tiền mặt, chuyển khoản, tự lấy, giao hàng.
4. Nhân viên chỉ xem được báo cáo của chi nhánh mình được phân; kế toán xem được tất cả.

## Xuất CSV đơn (kế toán)

Từ trang **Đơn hàng** hoặc **Báo cáo**, bấm **Tải CSV** (quyền Xuất): chọn khoảng ngày kinh doanh
(tối đa 92 ngày, 10.000 đơn) và chi nhánh rồi tải về — mở được bằng Excel. File chứa tên và số điện
thoại khách nên cần lưu ý bảo mật; chỉ đơn trong phạm vi chi nhánh được phân được xuất.

## Giới hạn hiện tại

- Chạy một máy chủ (một instance): báo đơn realtime và giới hạn tần suất nằm trong bộ nhớ của tiến trình.
- Giao tận nơi là quán **tự giao** (O5): hãng xe chỉ là thông tin kèm theo, chưa có tích hợp GHN/Ahamove/
  Grab (dự kiến O6). Danh mục đơn vị hành chính hiện là **dữ liệu mẫu (XT…)** — cần nguồn chính thức trước
  khi bật cho chi nhánh thật.
- Chưa có xuất CSV (O6 các bước sau).
