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
- **Hủy món** (biểu tượng thùng rác ở dòng món): chọn số lượng và lý do; số tiền hoàn hiện trước khi bấm,
  tính theo phần giảm giá đã chia lúc đặt. Đơn đã thu tiền thì phiếu hoàn tiền mặt ghi tên bạn.
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
pháp lý xác nhận) — yêu cầu đỏ khi quá hạn.

- Khách tự xóa tài khoản trên web cũng tạo một yêu cầu "Khách" — nếu khách còn **đơn đang mở**, yêu cầu
  nằm ở "Chờ đơn đóng" và hệ thống tự xử lý khi đơn đóng xong; phần đơn đã đóng được ẩn danh ngay.
- **"Xử lý"**: chạy xóa ngay (đơn đã đóng → ẩn danh tên/SĐT/email/địa chỉ trên đơn; hồ sơ, địa chỉ, giỏ
  bị xóa; **số tiền và sổ sách kế toán giữ nguyên** — báo cáo và chốt tiền không đổi). Không hoàn tác
  được — đọc kỹ hộp xác nhận.
- **"Từ chối"**: bắt buộc nhập lý do (vd nghĩa vụ lưu trữ sổ sách) — khách vẫn giữ hồ sơ.
- **"+ Tạo yêu cầu"**: khi khách **gọi điện** yêu cầu xuất/xóa — nhập SĐT khách đọc + loại + ghi chú.
  Hệ thống chỉ lưu mã băm của số, không lưu số thô trong sổ yêu cầu.
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

## Đánh giá đơn (Bán hàng → Đánh giá)

- Khách đánh giá 1–5 sao, chọn nhãn, ghi chú trong 7 ngày sau khi đơn hoàn tất; sửa được trong 24 giờ.
  Email mời gửi 60 phút sau khi hoàn tất (đổi ở **Cài đặt bán hàng → Đánh giá**, cùng danh sách nhãn).
- Đánh giá ≤ 2 sao mở cảnh báo **Khách đánh giá thấp** cho người xem báo cáo của chi nhánh (đổi ngưỡng ở
  Cảnh báo).
- Danh sách lọc theo chi nhánh, sao, ngày, có ghi chú, trạng thái. Đánh giá đã ẩn vẫn hiện trong danh sách
  nhưng không tính vào điểm trung bình (trang Đánh giá và báo cáo). Bấm dòng để xem đầy đủ; người có quyền
  "Quản lý đánh giá" ẩn/hiện đánh giá và ghi chú nội bộ (không gửi khách). Chi tiết đơn có khối đánh giá;
  báo cáo có điểm trung bình. Ghi chú của khách tự xóa sau 365 ngày, số sao giữ lại.

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
