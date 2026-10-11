# Hướng dẫn xử lý đơn (nhân viên chi nhánh)

Dành cho nhân viên và quản lý chi nhánh dùng Admin để nhận đơn online và đơn gọi điện (phase O3: khách tự
đến lấy, trả tiền mặt). Hướng dẫn nhập món: `docs/ordering-catalog-guide.md`.

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
- **Từ chối**: chọn lý do có sẵn hoặc "Lý do khác…" (bắt buộc ghi). Khách nhận email kèm lý do.
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
- **…** → Hủy đơn (bắt buộc lý do; đã thu tiền thì hoàn tiền mặt cùng lúc), Hoàn tiền mặt (tối đa số
  còn giữ), Sao chép mã đơn.
- **Lịch sử**: chấm "Khách thấy" là bước khách thấy trên trang đơn; ghi chú nội bộ khách không thấy.

## Đơn gọi điện (Tạo đơn hộ)

1. Chọn chi nhánh, tìm món, chọn tùy chọn và số lượng.
2. Nhập tên, số điện thoại Việt Nam, email nếu khách có.
3. Chọn ASAP hoặc giờ lấy.
4. Tích **Khách đã đồng ý xử lý dữ liệu qua điện thoại** (bắt buộc).
5. **Lưu nháp** (giữ chỗ khung giờ) hoặc **Xác nhận đơn** (vào hộp đơn ngay). Giá lấy từ catalog, không sửa
   tay.

## Khách tự hủy, tra cứu

- Khách tự hủy được khi đơn còn chờ quán nhận và trước mốc "Khách tự hủy trước giờ lấy" của chi nhánh. Sau
  đó khách phải gọi chi nhánh.
- Khách không để email tra cứu bằng mã đơn + số điện thoại trên website; chỉ thấy trạng thái.

## Cài đặt (quản lý)

- **Chi nhánh**: giờ mở (cho phép qua nửa đêm), ngày nghỉ, thời gian chuẩn bị tối thiểu (180 = 3 giờ),
  khoảng slot, sức chứa mỗi slot, đặt trước tối đa, đơn tối thiểu, hạn khách tự hủy, cách trả, báo chậm.
  Đổi cài đặt chỉ áp dụng cho đơn mới.
- **Cài đặt → Bán hàng**: bật hộp thoại đơn mới, âm báo mặc định, danh sách lý do từ chối, số phút lùi.

## Giới hạn hiện tại

- Chạy một máy chủ (một instance): báo đơn realtime và giới hạn tần suất nằm trong bộ nhớ của tiến trình.
- Chưa có chuyển khoản (O4), giao tận nơi (O5), chốt tiền cuối ngày và báo cáo (O6).
