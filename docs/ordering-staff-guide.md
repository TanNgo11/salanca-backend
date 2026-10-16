# Hướng dẫn xử lý đơn (nhân viên chi nhánh)

Dành cho nhân viên và quản lý chi nhánh dùng Admin để nhận đơn online và đơn gọi điện (phase O3: khách tự
đến lấy; O5: quán tự giao tận nơi; O7: giờ đặc biệt, giới hạn phần mỗi ngày, sửa đơn, trang người giao).
Hướng dẫn nhập món: `docs/ordering-catalog-guide.md`.

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
- Đầu khối **Thanh toán** có bốn số: **Cần thu · Đã thu · Đã hoàn · Còn thiếu**. "Còn thiếu" đỏ khi khách
  còn nợ; nếu có phiếu hoàn chuyển khoản chưa đối chiếu, dòng "Đang chờ hoàn …" hiện bên dưới (số này chưa
  nằm trong "Đã hoàn").
- **Hủy món** (biểu tượng thùng rác ở dòng món): chọn số lượng và lý do; số tiền hoàn hiện trước khi bấm,
  tính theo phần giảm giá đã chia lúc đặt. Chỉ hoàn khi khách đã trả *nhiều hơn* số còn phải trả: đơn chưa
  trả hoặc mới trả một phần không có phiếu hoàn, "Còn thiếu" giảm đúng phần món hủy và lúc thu tiền chỉ thu
  phần còn lại. Đơn đã thu tiền thì phiếu hoàn tiền mặt ghi tên bạn.
- **…** → Hủy đơn (bắt buộc lý do; tiền mặt đã thu hoàn cùng lúc, tiền chuyển khoản thành phiếu hoàn chờ), Hoàn tiền mặt (tối đa số
  còn giữ), Sao chép mã đơn.
- **Lịch sử**: chấm "Khách thấy" là bước khách thấy trên trang đơn; ghi chú nội bộ khách không thấy.

## Sửa đơn

- Nút **Sửa đơn** ở chi tiết đơn khi vai trò có quyền **Sửa đơn** (`order.edit`) và đơn còn sửa được:
  đang chờ nhận hoặc đang chuẩn bị. Đơn giao thêm lúc sẵn sàng, khi chưa có người đi giao.
- Không sửa được đơn nháp, đơn đã đóng, đơn đang chờ khách thanh toán, đơn đang giao, và đơn tự lấy đã
  sẵn sàng. Nút hiện lý do.
- Trong trang sửa: giảm số lượng món đã có (không tăng dòng cũ), thêm món mới theo giá hiện tại, đổi giờ
  nhận, đổi địa chỉ nếu là đơn giao. **Lý do** bắt buộc. Mặc định gửi email cho khách.
- Cột phải hiện trước khi lưu: hoàn tiền mặt, phiếu hoàn chuyển khoản chờ trả, hoặc số khách cần trả thêm.
  Đơn đã trả trước thì phần tăng gửi link thanh toán. Đơn trả khi nhận thì chỉ tăng số cần thu.
- Hai người sửa cùng lúc: người sau thấy "Đơn vừa được người khác sửa" và bấm tải lại. Món hết phần trong
  ngày thì không thêm được.

## Đơn gọi điện (Tạo đơn hộ)

1. Chọn **Loại đơn** (Món ăn tự lấy, hoặc Bán thẻ quà tặng — xem dưới), chi nhánh, tìm món, chọn biến thể
   (nếu món có nhiều cỡ), tùy chọn và số lượng.
2. Nhập tên, số điện thoại Việt Nam, email nếu khách có.
3. Chọn ASAP hoặc giờ lấy.
4. Tích **Khách đã đồng ý xử lý dữ liệu qua điện thoại** (bắt buộc). Hệ thống tự ghi phiên bản điều khoản
   đang hiệu lực (Cài đặt → Bán hàng → Phiên bản điều khoản đồng ý); bạn không chọn phiên bản.
5. **Lưu nháp** (giữ chỗ khung giờ) hoặc **Xác nhận đơn** (vào hộp đơn ngay). Giá lấy từ catalog, không sửa
   tay.

### Bán thẻ quà tặng tại quầy

Chọn **Loại đơn → Bán thẻ quà tặng**: danh sách chỉ còn sản phẩm thẻ, **mệnh giá là biến thể** (chọn khi
thêm vào đơn). Không trộn món ăn và thẻ trong một đơn; đổi loại đơn sẽ làm trống giỏ. Thu **tiền mặt** tại
quầy (không giao hàng, không hẹn giờ, không mã khuyến mãi).

- **Thẻ giấy in sẵn:** quét từng thẻ vào ô **Quét mã thẻ giấy** (mỗi dòng một mã). Số thẻ quét phải bằng số
  thẻ bán ("Đã quét n / m thẻ"), đúng mệnh giá, chưa bán và chưa nằm trong đơn khác. Mã không được lưu —
  đơn chỉ giữ thẻ nào đã bán. Thẻ có hiệu lực khi bấm **Thu tiền** ở đơn.
- **Thẻ điện tử:** để trống ô quét và nhập **email người nhận** (hoặc email khách); thẻ được gửi sau khi
  thu tiền. Có thể thêm tên người nhận và lời nhắn (≤ 300 ký tự).
- Cần ít nhất một trong hai cách giao (quét hoặc email) thì nút lưu mới bật.

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

## Giao của tôi (điện thoại)

- Mục **Vận hành → Giao của tôi**. Hiện khi vai trò có cả **Xử lý đơn** và **Thu tiền mặt**, hoặc khi có
  **Xử lý đơn** và đang có đơn được gán hôm nay.
- Trang một cột: tab **Đang làm** và **Đã xong**, nút làm mới, tự làm mới mỗi 30 giây. Chỉ đơn được gán
  cho bạn, trong ngày kinh doanh hôm nay của chi nhánh.
- Mỗi thẻ có mã, trạng thái, giờ hẹn, địa chỉ, món và số tiền mặt cần thu. **Gọi** mở số của khách.
  **Bản đồ** mở Google Maps với địa chỉ đó.
- Sẵn sàng → **Bắt đầu giao**. Đang giao và còn tiền → **Thu tiền và giao**; đã trả đủ → **Đã giao**.
  **Giao thất bại**: chọn lý do (Không liên lạc được / Sai địa chỉ / Khách từ chối / Khác — Khác cần ghi chú).
- Tài khoản chỉ đi giao, không có quyền xem mọi đơn, không thu tiền và không chuyển bước đơn của người
  khác. Tài khoản đó không có dòng đơn mới theo thời gian thực; trang tự làm mới mỗi 30 giây.

## Khách tự hủy, tra cứu

- Khách tự hủy được khi đơn còn chờ quán nhận và trước mốc "Khách tự hủy trước giờ lấy" của chi nhánh. Sau
  đó khách phải gọi chi nhánh.
- Khách không để email tra cứu bằng mã đơn + số điện thoại trên website; chỉ thấy trạng thái.

## Cài đặt (quản lý)

- **Chi nhánh**: giờ mở (cho phép qua nửa đêm), ngày nghỉ, thời gian chuẩn bị tối thiểu (180 = 3 giờ),
  khoảng slot, sức chứa mỗi slot, đặt trước tối đa, đơn tối thiểu, hạn khách tự hủy, cách trả, báo chậm.
  Đổi cài đặt chỉ áp dụng cho đơn mới.
- **Ngày đặc biệt** (tab Giờ mở của tự lấy và của giao): một ngày có thể đóng cửa, hoặc mở theo các khoảng
  giờ riêng (tối đa 6, khoảng có thể qua nửa đêm). Ghi chú ngắn, ví dụ "Mùng 2 Tết". Ngày đó thay giờ mở
  cửa thường và ngày nghỉ. Ngày đã qua được gom lại, không tự xóa. Có nút chép danh sách sang tab kia.
- **Tạm hết món → Giới hạn/ngày**: số phần tối đa của món, biến thể hoặc tùy chọn tại đúng chi nhánh trong
  một ngày kinh doanh. Hết phần thì khách thấy hết hôm nay, đến ngày kinh doanh mai mới bán lại. Công tắc
  **Đang bán** không đổi. Để trống ô là bỏ giới hạn.
- **Cài đặt → Bán hàng**: bật hộp thoại đơn mới, âm báo mặc định, danh sách lý do từ chối, số phút lùi.
- **Phiên bản điều khoản đồng ý** (cùng trang): để trống = dùng giá trị mặc định của hệ thống. Khi quản lý
  đổi sang phiên bản mới (sau khi cập nhật chính sách quyền riêng tư), mọi khách phải đồng ý lại — đơn gửi
  với phiên bản cũ bị từ chối cho tới khi trang đặt món đọc lại phiên bản mới. Thay đổi được ghi vào Lịch
  sử thay đổi.
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
6. Nếu **sau khi chốt** người thu còn thu thêm tiền mặt trong ngày, cột **Chênh lệch** hiện số **sống**
   theo sổ hiện tại, kèm dòng nhỏ "Lúc chốt: …" ghi số đã chốt. Bản chốt (số đã chốt, người chốt, giờ
   chốt) **không đổi** — đó là bằng chứng kiểm toán; số sống chỉ cho biết tiền phát sinh thêm.

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

Từ trang **Đơn hàng** bấm **Tải CSV**, từ trang **Báo cáo** bấm **Xuất CSV** (quyền Xuất): chọn
khoảng ngày kinh doanh (tối đa 92 ngày, 10.000 đơn) và chi nhánh rồi tải về — mở được bằng Excel.
File chứa tên và số điện thoại khách nên cần lưu ý bảo mật; chỉ đơn trong phạm vi chi nhánh được
phân được xuất.

## Cảnh báo (quản lý, kế toán)

Mục **Vận hành → Cảnh báo** liệt kê các sự cố đang cần xử lý, chia ba tab: **Đang mở**, **Đã biết**,
**Đã đóng**. Mỗi dòng ghi loại cảnh báo, số lần lặp lại, thời điểm gần nhất và nhóm người nhận.

- Bấm **Đã biết** khi đã nhận thông tin và đang xử lý — hệ thống ngừng nhắc lại cùng mức; nếu tình
  hình xấu hơn (đạt ngưỡng nghiêm trọng) vẫn báo tiếp.
- Cảnh báo tự đóng khi nguyên nhân hết (ví dụ giao dịch được khớp, đơn được nhận, điều chỉnh chốt
  tiền về đúng số); vài loại cần xử lý ở màn liên quan (Duyệt chuyển khoản, Chốt tiền mặt).
- Mỗi loại chỉ hiện cho nhóm được phân — quản lý chi nhánh thấy cảnh báo chi nhánh mình, kế toán
  thấy cảnh báo tiền và chốt tiền.

## Lịch sử thay đổi (quản lý, kế toán)

Mục **Cấu hình → Lịch sử thay đổi** (quyền "Lịch sử thay đổi") ghi lại ai đã làm gì, lúc nào, ở chi nhánh
nào: sửa giá/món/danh mục, bật tắt tạm hết, nhận/từ chối/hủy đơn, hủy bớt món, thu tiền mặt, tạo link thanh
toán, ghi/duyệt chuyển khoản, hoàn tiền, chốt tiền, giao hàng, đổi cấu hình và quyền.

- Lọc theo ngày (giờ Việt Nam), người làm, nhóm (Tiền / Đơn / Món / Giao hàng / Cấu hình / Quyền / Vận
  hành), chi nhánh, hoặc gõ mã đơn / tên món. Bấm một dòng để xem **trước → sau** từng field; "Cùng thao
  tác" liệt kê các dòng của cùng một lần bấm (ví dụ hủy đơn kèm hoàn tiền).
- Trong chi tiết đơn có link **Lịch sử thay đổi** mở sẵn lịch sử của đơn đó.
- **Xuất CSV** (cần thêm quyền xuất) cho kế toán, tối đa 92 ngày / 10.000 dòng.
- Nhân viên chi nhánh chỉ thấy lịch sử chi nhánh mình; thay đổi cấu hình chung chỉ người xem mọi chi nhánh
  thấy. Thông tin khách (tên, số điện thoại, địa chỉ) không có trong lịch sử. Lịch sử không sửa, không xóa
  được.

## Lịch sử gửi (quản lý)

Mục **Bán hàng → Cấu hình → Lịch sử gửi** (quyền "Xem lịch sử gửi thông báo") cho biết mỗi lần hệ thống gửi hoặc bỏ qua một
thông báo: gửi cho **vai trò** nào, qua **kênh** nào, kết quả ra sao, và **vì sao** khi không gửi.

- **Trạng thái**: **Đã gửi** (đã đi được), **Lỗi** (chưa đi được — hệ thống tự thử lại qua hàng đợi), **Bỏ qua** (không gửi theo
  cấu hình, xem cột **Lý do**), **Đang chờ** (còn trong hàng đợi).
- **Lý do** chỉ có ở dòng **Bỏ qua**, ví dụ "Email chưa bật (chưa cấu hình SMTP)" hoặc "Hết hạn mức gửi trong ngày".
- **Lọc** theo khoảng ngày, trạng thái, kênh, mẫu thông báo, vai trò người nhận, hoặc gõ **mã đơn**. Dải số trên cùng là
  24 giờ gần nhất và hạn mức gửi tính phí của hôm nay.
- **Địa chỉ người nhận không hiển thị ở đây** — bảng chỉ lưu mã băm nên màn chỉ hiện vai trò (Nhân viên / Khách) và kênh.
  Đây là chủ ý bảo vệ dữ liệu khách, không phải thiếu sót.
- **Chi tiết** một dòng mở ra mẫu, ngôn ngữ tin, lần thử. Nếu bạn có thêm quyền "Xem chi tiết lỗi gửi thông báo" thì có nút
  **Xem chi tiết kỹ thuật** (lỗi thô của nhà cung cấp, mã tin, chi phí ước tính) — dùng khi cần gửi cho kỹ thuật.
- **Banner "Chi nhánh chưa có email nhận đơn mới"**: hiện khi có chi nhánh trong phạm vi bạn xem chưa nhập email. Nhân viên các
  chi nhánh đó **không nhận** mail đơn mới. Bấm **Mở Chi nhánh** để nhập email.
- Nếu thấy banner **"Môi trường thử: chỉ gửi tới người nhận trong danh sách cho phép"**, hệ thống đang ở chế độ thử của kỹ thuật
  nên người ngoài danh sách bị bỏ qua — đúng thiết kế, không phải lỗi.
- Chưa có nút **Gửi lại**: mail **Lỗi** đã được hệ thống tự thử lại; cần gửi gấp thì nhờ kỹ thuật chạy job `outbox` ở
  **Vận hành → Tình trạng vận hành**.
- Ngày trong màn tính theo múi giờ của hệ thống, ghi ngay dưới tiêu đề.

## Nhập/xuất menu bằng CSV (Món → Nhập/xuất)

Dùng khi cần sửa giá/nội dung hàng loạt bằng Excel thay vì sửa từng món:

1. **Tải products.csv** (và modifiers.csv nếu sửa nhóm tùy chọn) — file UTF-8, mở được ngay trong
   Excel, giữ nguyên dòng tiêu đề.
2. Sửa trong Excel, lưu lại dạng CSV.
3. Ở khối **Nhập**: chọn loại file (Món/Tùy chọn — nhập **Tùy chọn trước** nếu cả hai đều sửa), chọn
   file, bấm **Kiểm tra**. Báo cáo cho biết sẽ tạo mới bao nhiêu, sửa bao nhiêu, lỗi bao nhiêu dòng
   (kèm tên cột và lý do).
4. Không lỗi thì bấm **Áp dụng**. Có lỗi thì sửa file và kiểm tra lại — một dòng lỗi cũng không áp
   gì cả.
5. Nếu thấy "Menu vừa thay đổi, kiểm tra lại file": có người khác vừa sửa menu — kiểm tra lại file
   (bấm Kiểm tra) rồi áp lại.

Nhập chỉ **tạo/sửa**, không xóa — món ngừng bán đặt `sellOnline=false`. Mọi lần nhập đều ghi vào
**Lịch sử thay đổi**.

## Sửa mẫu email (Cài đặt bán hàng → Mẫu email)

Câu chữ các email hệ thống gửi cho khách/nhân viên sửa được mà không cần đổi code:

1. Vào **Cài đặt bán hàng → Mẫu email** — mỗi mẫu hiện badge **Mặc định/Đã sửa** cho từng ngôn ngữ.
2. Chọn mẫu → chọn ngôn ngữ → sửa **Tiêu đề** và **Nội dung**. Bên phải là danh sách **biến** được
   phép — bấm để chèn `{{code}}`, `{{items}}`… Chỉ dùng biến trong danh sách; biến lạ sẽ báo đỏ và
   không cho lưu.
3. Nội dung hỗ trợ chữ **đậm** (`**chữ**`), gạch đầu dòng (`- `), và link `[nhãn](https://…)`.
4. **Xem trước** để thấy email với dữ liệu mẫu; **Gửi thử tới tôi** để nhận bản thật vào email đăng
   nhập của bạn.
5. **Khôi phục mặc định** xóa bản sửa, email quay về nội dung hệ thống.

Nếu một mẫu đã sửa bị lỗi lúc gửi, hệ thống tự dùng lại mẫu mặc định và báo cảnh báo cho đội vận hành
— email khách không bị mất.

## Khách hàng (Bán hàng → Khách hàng)

Khách được tạo **tự động** khi đặt đơn hoặc đăng nhập OTP — không cần nhập tay.

- **Tìm khách:** gõ SĐT (09… hay +84… đều được — hệ thống so khớp bằng mã băm, không quét số thô),
  tên hoặc email vào ô tìm kiếm; lọc thêm theo Đã xác thực/Chưa xác thực và Đồng ý nhận ưu đãi.
  SĐT/email trong bảng luôn **che một phần** (vd `091•••3333`).
- **Phạm vi:** nhân viên chỉ thấy khách đã từng đặt đơn ở chi nhánh mình phụ trách — khách của chi
  nhánh khác hiện "không tìm thấy", giống đơn hàng.
- **Chi tiết khách** (bấm vào dòng): thống kê đơn/chi tiêu, danh sách đơn (bấm mã đơn → chi tiết đơn),
  sổ địa chỉ (chỉ xem), lịch sử đồng ý tiếp thị, lịch sử yêu cầu dữ liệu.
- **"Hiện số"** (quyền `customer.manage`): hiện SĐT đầy đủ một lần — hệ thống **ghi lại ai đã xem**
  vào lịch sử thay đổi. Chỉ bấm khi thật sự cần gọi khách.
- **"Sửa tên/ghi chú"** (`customer.manage`): đổi tên hiển thị và ghi chú nội bộ; cũng ghi lịch sử
  thay đổi (giá trị trước/sau được che trong sổ).
- **"Xuất dữ liệu (JSON)"** (`customer.manage`): tải toàn bộ hồ sơ + đơn + địa chỉ của khách ra file —
  dùng khi khách yêu cầu bản sao dữ liệu theo Nghị định 13.

## Yêu cầu dữ liệu (Cấu hình → Yêu cầu dữ liệu)

Nghị định 13/2023 cho khách quyền xuất và xóa dữ liệu cá nhân. Hàng đợi 4 tab: **Mới · Chờ đơn đóng ·
Đã xử lý · Từ chối**. Cột "Hạn" là mốc gợi ý 72 giờ (theo cấu hình `dataRights.deadlineHours`, chờ
pháp lý xác nhận) — yêu cầu đỏ khi quá hạn. Yêu cầu quá hạn còn mở cũng bật cảnh báo **Yêu cầu dữ liệu
cá nhân quá hạn** (Vận hành → Cảnh báo, nhóm quản lý/vận hành xem tất cả chi nhánh); cảnh báo tự đóng ở
lần job kế tiếp (tối đa 35 phút) sau khi yêu cầu được xử lý hoặc từ chối.

- Khách tự xóa tài khoản trên web cũng tạo một yêu cầu "Khách" — nếu khách còn **đơn đang mở**, yêu cầu
  nằm ở "Chờ đơn đóng" và hệ thống tự xử lý khi đơn đóng xong; phần đơn đã đóng được ẩn danh ngay.
- **"Xử lý"**: chạy xóa ngay (đơn đã đóng → ẩn danh tên/SĐT/email/địa chỉ trên đơn; hồ sơ, địa chỉ, giỏ
  bị xóa; **số tiền và sổ sách kế toán giữ nguyên** — báo cáo và chốt tiền không đổi). Không hoàn tác
  được — đọc kỹ hộp xác nhận.
- **"Từ chối"**: bắt buộc nhập lý do (vd nghĩa vụ lưu trữ sổ sách) — khách vẫn giữ hồ sơ.
- **"+ Tạo yêu cầu"**: khi khách **gọi điện** yêu cầu xuất/xóa — nhập SĐT khách đọc + loại + ghi chú.
  Mặc định là **Xuất**; chọn **Xóa** thì phải qua **hai bước**: bấm nút → hiện cảnh báo đỏ → bấm
  "Xóa vĩnh viễn" mới xóa thật ("Quay lại" để hủy). Hệ thống chỉ lưu mã băm của số, không lưu số thô
  trong sổ yêu cầu.
- Từ trang chi tiết khách (C2) cũng có nút "Tạo yêu cầu xóa" — nút này gửi mã khách, không cần biết
  số thật.

## Khuyến mãi (quản lý — quyền "Quản lý khuyến mãi")

1. **Bán hàng → Khuyến mãi → Tạo khuyến mãi.** Chọn **Mã giảm giá** (khách nhập mã) hoặc **Tự động**
   (áp cho mọi đơn đủ điều kiện). Loại không đổi được sau khi lưu.
2. **Giảm gì:** phần trăm (có thể đặt giảm tối đa), số tiền, miễn phí giao, giảm phí giao. Phần trăm và số
   tiền áp cho cả đơn, món chọn hoặc danh mục chọn (ô tìm không cần dấu).
3. **Điều kiện:** tạm tính tối thiểu, chi nhánh, cách nhận, chỉ đơn đầu tiên của số điện thoại. **Thời
   gian:** bắt đầu/kết thúc, ngày trong tuần, tối đa 3 khung giờ theo giờ chi nhánh.
4. **Giới hạn:** tổng lượt, lượt mỗi khách, cộng dồn với khuyến mãi khác, ưu tiên. Khi nhiều khuyến mãi cùng
   hợp, hệ thống chọn phương án giảm nhiều nhất cho khách.
5. **Lưu nháp** (chưa chạy) hoặc **Lưu và bật**. Sửa khuyến mãi chỉ áp cho đơn mới; đơn cũ giữ số giảm.
6. Tab **Mã**: thêm một mã, hoặc **Sinh hàng loạt** (tối đa 5000, mặc định mỗi mã dùng 1 lần, đặt tên lô).
   **Xuất CSV** cần thêm quyền xuất. Tắt một mã bằng công tắc trên dòng.
7. Tab **Thống kê**: số đơn, tổng giảm, doanh thu đơn có khuyến mãi, lượt đang giữ, danh sách đơn đã dùng.
   Đơn bị hủy trả lại lượt.

Khuyến mãi "đơn đầu" và "mỗi khách N lần" không hiện số giảm lúc báo giá: hệ thống chỉ kiểm theo số
điện thoại khi lưu đơn, nên tổng thật có thể thấp hơn tổng báo. Tạo đơn hộ khách có ô **Mã khuyến mãi**.
Sửa đơn (O7) giữ khuyến mãi đã áp và tính lại số giảm trên món còn lại.

## Thẻ quà tặng (Bán hàng → Thẻ quà tặng — quyền "Quản lý thẻ quà tặng")

Khách mua thẻ trên web (mục **Thẻ quà tặng** trong menu, mệnh giá cố định): trả tiền online, mã được
phát và email tới người nhận sau khi thu tiền — chưa thu thì chưa có mã. Tại quầy, nhân viên tạo đơn
hộ chọn **Loại đơn → Bán thẻ quà tặng**, chọn mệnh giá và quét mã thẻ giấy in sẵn (ô **Quét mã thẻ giấy**);
thẻ giấy chỉ có giá trị từ lúc bán.

1. **Danh sách thẻ:** tab trạng thái (đang dùng / hết hạn / bị khóa / chưa bán), lọc nguồn (bán online,
   phát tặng, thẻ giấy), ba thẻ tổng trên đầu trang (đang lưu hành, bán tháng này, đã dùng tháng này).
   Ô tìm kiếm nhận 4 số cuối hoặc mã đơn; mã đầy đủ dán vào ô **Tìm theo mã** riêng (đi qua nội dung
   request, không qua URL — ô tìm thường từ chối mã đầy đủ).
   Mọi nơi chỉ hiện `•••• 4 ký tự cuối`; không ai đọc lại mã đầy đủ sau khi phát.
2. **Phát thẻ tặng:** nút **Phát thẻ**. Có email người nhận → hệ thống gửi mã qua mail, màn hình không
   hiện mã. Không email → mã hiện **một lần duy nhất**, ghi lại ngay cho khách. Lý do bắt buộc.
3. **Chi tiết thẻ:** trạng thái, số dư, hạn dùng, nguồn phát hành, người nhận (email che), đơn liên
   quan và sổ cái — mọi biến động tiền của thẻ (phát, dùng, hoàn, hết hạn, điều chỉnh) là một dòng
   append-only, không sửa không xóa.
4. **Hành động trên thẻ:** **Khóa/Mở khóa** (thẻ khóa không dùng được, khách tra cứu thấy "mã không
   đúng"), **Gia hạn** (chỉ kéo dài, không rút ngắn), **Điều chỉnh số dư** (cộng/trừ, không cho âm —
   cần thêm quyền "Điều chỉnh số dư thẻ"), **Gửi lại mã** (gửi về đúng email người nhận đã lưu — chỉ
   trong `sealedCodeHours`, mặc định 24 giờ sau phát; hết hạn lưu thì mã đã xóa, phát thẻ mới thay thế).
5. **Lô thẻ giấy:** tab **Lô thẻ** — **Tạo lô** (chọn mệnh giá + số lượng → tải danh sách mã để in, một
   lần duy nhất), **Nhập lô** (dán danh sách mã in sẵn — sai một dòng thì cả lô bị từ chối), **Xuất CSV**
   mã thẻ của lô (cần quyền "Xuất"). Thẻ trong lô bắt đầu "chưa bán", giá trị 0đ, tự có giá trị khi bán
   tại quầy; hạn dùng tính từ lúc kích hoạt. **In thẻ trong 24 giờ sau khi tạo lô:** sau
   `sealedCodeHours` mã chưa bán bị xóa khỏi hệ thống, Xuất CSV không còn mã. Thẻ đã bán không bao giờ
   xuất mã. Bán tại quầy: quét mỗi thẻ một lần, đúng mệnh giá món bán; thẻ đang nằm trong đơn khác
   (kể cả đơn nháp) bị từ chối ngay — hủy/xóa đơn kia để nhả thẻ. Khách đã cầm thẻ, nên nếu bán sau
   24 giờ thì không có mail mã.
6. **Trong chi tiết đơn:** thanh toán bằng thẻ hiện `Thẻ quà tặng •••• LAST4` (bấm vào mở đúng thẻ);
   đơn mua thẻ hiện khối **Thẻ đã phát** (mã che + trạng thái email); hoàn tiền về thẻ được đánh dấu
   riêng. Báo cáo tách riêng **bán thẻ** (tiền bán đơn thẻ), **đã dùng thẻ**, **đang lưu hành** và **số
   dư thẻ hết hạn** — không lẫn vào doanh thu món: doanh thu tính lúc thẻ được dùng mua món, không
   tính lúc bán thẻ. Đơn bán thẻ không nhận giảm giá tay hay khuyến mãi theo đơn. Hoàn tiền đơn bán thẻ:
   chỉ hoàn phần trả dư, giá trị thẻ đã phát không hoàn ra tiền (khóa thẻ nếu cần). Chốt tiền mặt
   không đổi: thẻ không phải tiền mặt.

Thẻ hết hạn tự động: job `gift-card-expiry` chạy 03:45 hằng ngày, ghi sổ `expire` phần số dư còn lại
và đưa số dư về 0. Mã sai quá nhiều từ một IP mở cảnh báo **Dò mã thẻ quà tặng** trên bảng Cảnh báo.

## Điểm và hạng thành viên (Bán hàng → Khuyến mãi & thẻ → Điểm & hạng)

Quyền: **Quản lý chương trình điểm và hạng** (`loyalty.manage`) cho cấu hình; **Điều chỉnh điểm khách** (`loyalty.adjust`)
cho nút điều chỉnh. Chương trình **tắt mặc định** — khách chưa tích hay dùng điểm cho tới khi bạn bật.

1. **Chương trình điểm.** Lần bật đầu tiên hệ thống ghi mốc bắt đầu (chỉ đơn hoàn tất từ lúc đó mới được tích điểm) và tạo ba
   hạng mặc định cùng hai nhóm khách `hang-bac`, `hang-vang`. Các số (1 điểm / bao nhiêu đồng, giá trị điểm, tối thiểu, tối đa % tiền
   món, hạn, nhắc trước, trần/ngày) đổi được bất kỳ lúc nào, áp cho giao dịch mới.
2. **Tích điểm.** Khi đơn hoàn tất, khách đã xác minh OTP được cộng điểm trên **tiền món sau giảm giá** (không tính phí giao, phí
   dịch vụ, phần trả bằng thẻ quà tặng hay bằng điểm). Điểm có hạn theo lô (12 tháng). Đơn hoàn tiền một phần/toàn phần thì thu hồi điểm
   tương ứng; nếu khách đã dùng hết điểm, số dư có thể âm và khách không dùng được điểm cho tới khi bù lại.
3. **Dùng điểm.** Khách đăng nhập chọn số điểm ở bước thanh toán; giảm giá áp sau khuyến mãi, tối đa 50% tiền món. Hủy cả đơn thì điểm về
   lại đúng lô cũ; hủy bớt món thì **không** hoàn điểm (tiền hoàn theo phân bổ). Sửa đơn làm tiền món nhỏ đi thì giảm giá điểm bị kéo về
   mức tối đa mới và phần chênh được hoàn.
4. **Hạng.** Tính theo chi tiêu 12 tháng. Lên hạng ngay khi đơn hoàn tất vượt mốc; xuống hạng khi dưới mốc liên tục 30 ngày. Mỗi hạng gắn
   một nhóm khách (O14) — dùng nhóm đó cho bảng giá hạng hoặc điều kiện khuyến mãi ("Chỉ áp dụng cho nhóm khách" trong form khuyến mãi).
   Bỏ khách khỏi nhóm hạng bằng tay sẽ bị job hạng thêm lại. **Tính lại hạng** ghi đơn hoàn tất 12 tháng qua vào lịch sử để hạng khởi
   đầu đúng (không cộng điểm; chạy lại an toàn).
5. **Điểm của khách.** Chi tiết khách → tab **Điểm**: số dư, hạng và còn bao nhiêu để lên hạng, điểm sắp hết hạn, các lô, sổ điểm. **Điều
   chỉnh điểm** bắt buộc có lý do, ghi vào Lịch sử thay đổi; trừ không được vượt số dư. Nhân viên chỉ thấy khách có đơn ở chi nhánh mình.
6. **Báo cáo.** Dưới báo cáo bán hàng: điểm phát, dùng, hoàn lại, hết hạn, thu hồi, **đang lưu hành** (điểm × giá trị = nợ điểm) và số
   khách theo hạng. Lọc theo chi nhánh chỉ tính điểm gắn với đơn của chi nhánh.
7. **Tự động.** `loyalty-earn-sweep` (10 phút) tích điểm cho đơn hoàn tất mà sự kiện không tới; `loyalty-expiry` (03:30) hết hạn lô và gửi
   mail nhắc một lần; `loyalty-tiers` (04:00) xét hạng. Khách xóa dữ liệu thì điểm còn lại bị hủy.
8. **Trước khi mở cho khách thật:** chốt điều khoản chương trình với pháp lý và cách hạch toán điểm đang lưu hành với kế toán.

## Bảng giá (Món → Bảng giá — quyền "Quản lý bảng giá và nhóm khách")

1. **Bảng giá mới.** Đặt tên. Chọn **Giá riêng** (một giá cho từng món) hoặc **Điều chỉnh** (giảm % hoặc số
   tiền trên giá đang bán).
2. **Áp khi:** kênh (mang về, giao, tại bàn, nhân viên đặt), chi nhánh, nhóm khách, thứ, một khung giờ.
   Bỏ trống một ô nghĩa là mọi giá trị của ô đó. Giờ theo đồng hồ chi nhánh; khung qua đêm khi giờ kết thúc
   nhỏ hơn giờ bắt đầu.
3. **Ưu tiên.** Nhiều bảng cùng khớp: bảng điều chỉnh không cộng dồn — ưu tiên cao hơn thắng, hòa thì giá
   thấp hơn thắng. Giảm không bao giờ âm.
4. **Xem thử giá** trên cùng trang: chọn món, kênh, chi nhánh, nhóm và thời điểm để thấy bảng nào thắng.
5. Tắt bảng bằng công tắc. Đơn đã đặt giữ giá lúc đặt. Sửa đơn chỉ tính giá mới cho dòng thêm vào.

## Nhóm khách (Vận hành → Nhóm khách)

1. Mã viết thường, số và gạch ngang. Mã không sửa được sau khi tạo.
2. **Thêm tự động:** tổng chi, số đơn hoàn tất, hoặc trong số ngày gần đây. Ít nhất một điều kiện. Job chạy
   03:15 mỗi ngày. Thành viên thêm tay giữ nguyên; thành viên tự động hết điều kiện thì bị gỡ. Nếu bạn gỡ một
   khách tự động mà khách vẫn đủ điều kiện, job hôm sau thêm lại.
   Điều kiện chỉ có "trong N ngày" nghĩa là có ít nhất 1 đơn hoàn tất trong N ngày đó.
3. Tìm khách theo tên hoặc số để thêm/bớt. Màn hình chỉ hiện số đã che. Nhật ký chỉ ghi số người thêm và bớt,
   không ghi tên hay số điện thoại.
4. Khách phải đăng nhập mới được giá nhóm trên web. Đơn hộ dùng nhóm của hồ sơ trùng số điện thoại. Khách
   không đăng nhập luôn trả giá thường.

## Đánh giá đơn (Bán hàng → Đánh giá)

- Khách đánh giá 1–5 sao, chọn nhãn, ghi chú trong 7 ngày sau khi đơn hoàn tất; sửa được trong 24 giờ.
  Email mời gửi 60 phút sau khi hoàn tất (đổi ở **Cài đặt bán hàng → Đánh giá**, cùng danh sách nhãn).
- Đánh giá ≤ 2 sao mở cảnh báo **Khách đánh giá thấp** cho người xem báo cáo của chi nhánh (đổi ngưỡng ở
  Cảnh báo).
- Danh sách lọc theo chi nhánh, sao, ngày, có ghi chú, trạng thái. Đánh giá đã ẩn vẫn hiện trong danh sách
  nhưng không tính vào điểm trung bình (trang Đánh giá và báo cáo). Bấm dòng để xem đầy đủ; người có quyền
  "Quản lý đánh giá" ẩn/hiện đánh giá và ghi chú nội bộ (không gửi khách). Chi tiết đơn có khối đánh giá;
  báo cáo có điểm trung bình. Ghi chú của khách tự xóa sau 365 ngày, số sao giữ lại.

## Tạm dừng nhận đơn / Quán đông (O12)

- Thanh **Tạm dừng** nằm trên đầu trang Đơn hàng và Bếp của chi nhánh bạn được phân.
- **Tạm dừng**: chọn kênh (Tự lấy · Giao hàng · Tại bàn) và thời lượng (15′–cuối ngày) hoặc hết ngày;
  khách đặt kênh đó thấy "Chi nhánh đang tạm dừng" kèm giờ mở lại. Hết giờ hệ thống tự mở; nút **Mở lại**
  mở sớm. Kênh khác vẫn nhận bình thường.
- **Quán đông**: bật/tắt kèm số phút cộng thêm — khách chỉ thấy giờ lấy xa hơn, đơn vẫn đến.
- Cả hai đều ghi vào Lịch sử thay đổi.

## Bếp (Bán hàng → Bếp — quyền "Đọc bếp", O12)

- Mục **Bếp** chỉ hiện với tài khoản có quyền **Đọc bếp** (`kitchen.read`) — đúng bằng quyền của mọi
  route bếp (bảng, stream, bắt đầu, xong món, xong cả đơn). Chỉ có quyền xử lý đơn (`order.process`)
  **không** mở được màn này (nút chuẩn bị/xong dùng chung quyền đọc bếp).
- Bảng toàn màn hình tối, tự cập nhật qua stream (có còi báo đơn mới, bật/tắt được). Ba cột:
  **Mới** (chờ bếp bắt đầu) · **Đang làm** · **Xong** (15 phút gần nhất).
- **Bắt đầu** trên thẻ Mới: đánh dấu bếp đã nhận đơn (đơn vẫn ở "Đang chuẩn bị" phía khách).
- Tích từng dòng món khi xong món đó; nút **Xong cả đơn** khi đủ món — đơn tự lấy sang "Sẵn sàng",
  đơn tại bàn sang "Sẵn sàng" chờ phục vụ ra bàn, đơn giao chờ điều xe.
- Món được xếp cột theo **trạm bếp** của danh mục (xem hướng dẫn nhập món); bộ lọc trạm ở góc phải
  chỉ giữ dòng của trạm đó. Đơn quá phút "Báo chậm" của chi nhánh nhấp nháy đỏ.

## In phiếu (O12)

- Trong chi tiết đơn, nút **…** có **In phiếu bếp** và **In tạm tính** — mở trang in riêng (khổ 80mm
  hoặc 58mm, đổi được ngay trên trang). Phiếu bếp không có giá; tạm tính có đủ tiền, phí, đã thu và
  địa chỉ giao (nếu là đơn giao). SĐT khách luôn bị che.
- **Máy in quầy**: ô tick trên thanh Tạm dừng — máy nào tick sẽ tự in phiếu bếp cho mọi đơn mới của
  chi nhánh đó (cần Chrome kiosk bật `--kiosk-printing` để in không hỏi; chi nhánh phải bật
  "Tự in phiếu bếp" trong phần In của cài đặt chi nhánh).
- Số lần in của đơn nằm trong Lịch sử thay đổi của đơn.

## Bàn & QR (Cấu hình → Bàn & QR — quyền "Quản lý bàn", O12)

- Danh sách bàn theo chi nhánh. **Thêm bàn** cho một bàn; **Thêm nhiều bàn** nhập tiền tố + khoảng
  số (ví dụ B + 1…20 tạo B1…B20) — mỗi bàn có mã QR riêng.
- **In thẻ bàn** / **Tải QR**: mã QR chứa link menu kèm khóa bàn; dán lên bàn. Khách quét thấy đúng
  menu của chi nhánh và đặt thẳng không cần chọn bàn.
- **Đổi QR**: hủy hiệu lực mã cũ ngay khi xác nhận — in thẻ mới trước khi dùng tiếp (dùng khi thẻ bị
  chụp/lộ). **Tắt bàn** chặn đặt mới nhưng giữ nguyên phiên đang phục vụ.
- Mã bàn là duy nhất trong chi nhánh; trùng mã báo lỗi ngay trên form.

## Tại bàn (Bán hàng → Tại bàn — quyền "Quản lý bàn", O12)

- Bảng các **phiên bàn** đang phục vụ: bàn, giờ mở, số đơn, tổng tiền, đã thu, còn nợ. Đơn mới của
  khách cùng bàn tự gom vào một phiên — một bàn chỉ có một phiên mở.
- Thẻ có **N đơn chờ nhận** khi có đơn chưa xác nhận; thẻ đỏ **Chưa đóng từ hôm trước** khi phiên
  qua ngày kinh doanh mà chưa đóng (đồng thời mở cảnh báo ở trang Cảnh báo — hệ thống không tự
  thu tiền, không tự đóng).
- **In hóa đơn bàn**: tạm tính gộp mọi đơn của phiên (khách xin bill trước khi trả).
- **Thanh toán & đóng bàn** (cần thêm quyền "Ghi nhận tiền mặt"): chọn Tiền mặt hoặc Chuyển khoản
  tại quầy (nhập mã giao dịch trên sao kê). Hệ thống thu phần còn nợ của từng đơn, chuyển đơn đã phục vụ sang "Hoàn tất" rồi đóng bàn —
  phiếu thu ghi tên người bấm. Còn món đang làm/chưa phục vụ thì đóng bị chặn và liệt kê các đơn
  còn thiếu. Đơn đã thu đủ hoặc đã hủy không bị thu thêm; bấm nhầm lần hai không trừ tiền lần nữa.

## Giới hạn hiện tại

- Chạy một máy chủ (một instance): báo đơn realtime và giới hạn tần suất nằm trong bộ nhớ của tiến trình.
- Giao tận nơi là quán **tự giao** (O5): hãng xe chỉ là thông tin kèm theo, chưa có tích hợp GHN/Ahamove/
  Grab (dự kiến O6). Danh mục đơn vị hành chính hiện là **dữ liệu mẫu (XT…)** — cần nguồn chính thức trước
  khi bật cho chi nhánh thật.
- Trang **Giao của tôi** nằm trong Admin, bố cục cho màn hẹp. Chưa kiểm khung đăng nhập và menu Admin trên
  điện thoại 360px.

### Phạm vi yêu cầu dữ liệu sau review O11

Nhân viên theo chi nhánh chỉ tạo, xem, xử lý hoặc từ chối yêu cầu của khách có đơn tại chi nhánh
được phân công, kể cả khi nhập số điện thoại trực tiếp. Khách ngoài phạm vi hoặc số chưa có hồ sơ
trả về không tìm thấy. Quản lý có quyền toàn bộ chi nhánh vẫn xem được yêu cầu không có hồ sơ và
lịch sử đã xóa; sau ẩn danh, liên kết đơn với khách bị gỡ nên nhân viên chi nhánh không còn thấy
những yêu cầu đó trong hàng đợi.

Khi xóa dữ liệu khách, ghi chú đánh giá và ghi chú nội bộ của đánh giá cũng bị xóa; sao và nhãn
vẫn dùng cho báo cáo. Lịch sử lượt khuyến mãi giữ mã HMAC của số điện thoại để không đặt lại giới
hạn lượt dùng khi xóa tài khoản; số tiền giảm và sổ đối chiếu giữ nguyên.
