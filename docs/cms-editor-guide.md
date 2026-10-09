# Salanca CMS editor guide — VI/EN workflow

## Owner content refresh, 2026-09-29

The revised brand-story DOCX is authoritative for the narrative, including the 2020 rename. PDF pages 2–3 supplement the Churrasco origins; the older 2022 brand timeline does not replace the revised DOCX. Edit short story card text in `body` and expanded text in `detailBody` (optional, 1,600 characters), in both VI and EN. Menu categories determine the frontend tabs and their order; each locale needs its own category name/slug and published items. Shared prices stay numeric VND; localized `portion` carries physical units such as kg, 100 g, bowl, or box. A zero price on an included salad, side, or sauce is displayed without a price label. Keep Steak Salanca without an asserted meat cut, wings at 750,000 VND, and Moqueca without an invented price. PDF exports have a 3,840-pixel width; provenance records identify upscaled sources. Real dining-room and dish photographs remain where the PDF does not provide an appropriate replacement.

To change a PDF-style star, open the dish in Content Manager → Món and toggle **Hiện ngôi sao trong thực đơn** (`showStar`), then publish. This field is shared by VI and EN and is separate from `isFeatured`, which controls featured-item behavior elsewhere. The source PDF stars Jasmine butter rice and Feijoada only.

## Nhật ký hoạt động (audit log, 2026-10-04)

Menu **Nhật ký hoạt động** (biểu tượng đồng hồ) mở màn hình chỉ đọc ghi lại mọi
hành động trong Admin: ai làm, việc gì, lúc nào, đối tượng nào, thành công hay
thất bại. Dùng để điều tra "ai đã sửa/xoá nội dung này".

- **Bộ lọc:** tìm kiếm theo người/đối tượng/mã sự kiện (bắt buộc kèm khoảng
  ngày), nhóm hành động, hành động cụ thể, nguồn, kết quả, khoảng ngày.
  Mặc định hiển thị **30 ngày gần nhất theo giờ Việt Nam**.
- **Chạm vào một dòng** để mở panel chi tiết. Phần kỹ thuật (request ID, HTTP
  method, đường dẫn, mã trạng thái) chỉ hiện với vai trò có quyền
  *Audit log details*.
- **Xuất CSV:** nút *Xuất CSV* (cần quyền *Audit log export*), tối đa 31 ngày
  và 5.000 dòng mỗi lần — thu hẹp khoảng ngày nếu báo lỗi.
- Lịch sử chỉ đọc: không thể sửa hay xoá dòng nào.
- Quyền xem được cấp trong Settings → Roles → Plugins → Audit log
  (`read` / `details` / `export`); mặc định chỉ Super Admin có đủ ba quyền.

## Standard flow

1. Chọn locale `vi` và tạo nội dung tiếng Việt trước.
2. Điền đủ copy, slug, SEO và alt text; lưu Draft.
3. Kiểm tra preview/content rồi publish VI.
4. Dùng action tạo localization `en` trên cùng document.
5. Dịch copy, slug, SEO, CTA, alt và caption. Không bịa nội dung còn thiếu.
6. Giữ EN ở Draft cho đến khi người phụ trách duyệt.
7. Publish EN độc lập. Unpublish EN không được làm VI mất Published.

## Field phải dịch

- Heading, title, name, summary, description và rich text.
- Slug public.
- SEO title/description/canonical path.
- CTA/link label và internal URL theo locale.
- Alt/caption.
- Campaign terms và các label hiển thị.

## Field không dịch

- Giá, enum kỹ thuật, ngày giờ campaign.
- `isActive`, `isFeatured`, `showStar`, `displayOrder`, `noIndex`.
- Hotline, email, external map URL.
- Media binary khi VI/EN dùng cùng ảnh.

Strapi lưu một số field kỹ thuật nằm trong component theo từng locale. Vì vậy khi tạo EN, editor vẫn phải giữ `noIndex`, thời gian trong component và media reference giống VI nếu nghiệp vụ không yêu cầu khác. Không upload lại cùng file chỉ để đổi alt; chọn lại cùng asset và dịch alt/caption.

## Slug

- Dùng chữ thường, không dấu, nối bằng dấu gạch ngang.
- VI và EN được phép khác nhau, ví dụ `thuc-don-churrascaria` và `churrascaria-menu`.
- Không đổi slug chỉ để “trông đẹp” sau khi URL đã public nếu chưa có redirect plan.
- Nếu Admin báo trùng slug trong cùng locale, chọn slug khác; không thêm số ngẫu nhiên mà không hiểu URL.

## Tin nhắn liên hệ (form intake)

Collection **Tin nhắn liên hệ** (`contact-message`) nhận lead từ website.

1. Mở Content Manager → **Tin nhắn liên hệ**.
2. Bản ghi mới có **Trạng thái xử lý** (`leadStatus`) = `new`.
3. Đọc nội dung; đổi **Trạng thái xử lý** thành `read` khi đã xử lý, `archived` khi xong, rồi **Lưu**.
4. Không xóa lead trừ khi có quy trình PII/retention; ưu tiên archive.
5. Public không xem được danh sách — chỉ Admin/Authenticated roles.

Email staff notify **opt-in** (Resend + `FORM_NOTIFY_TO`); lead vẫn luôn lưu trong Admin dù mail lỗi. Copy trang form (heading, topic) vẫn nằm ở **Trang liên hệ**.

## Yêu cầu đặt bàn (form intake)

Collection **Yêu cầu đặt bàn** (`reservation-request`) nhận lead đặt bàn từ website.

1. Mở Content Manager → **Yêu cầu đặt bàn**.
2. Bản ghi mới có **Trạng thái xử lý** (`leadStatus`) = `new`.
3. Kiểm tra `preferredDate`, `preferredTime`, `guestCount`, `phone`.
4. `menuSelectionMode = later` → khách chọn món tại nhà hàng; `now` → xem relation gói buffet / món lẻ.
5. Lọc `overlapCount > 0` để ưu tiên các khung giờ có nhiều request (cảnh báo mềm — **không** tự chặn chỗ).
6. Đổi **Trạng thái xử lý** thành `read` khi đã gọi khách, `archived` khi xong (hoặc dùng nút trong Hộp thư đặt bàn).
7. Public không xem được danh sách — chỉ Admin.

Form **không** kiểm tra bàn trống realtime. Email staff notify **opt-in** (cùng Resend + `FORM_NOTIFY_TO` như liên hệ). Copy trang đặt bàn vẫn nằm ở **Trang đặt bàn**.

## Hộp thư đặt bàn (thông báo realtime, 2026-10-04)

Menu **Hộp thư đặt bàn** (biểu tượng chuông) mở màn hình liệt kê các yêu cầu
đặt bàn mới. Khi khách gửi form trên website, mọi tab Admin đang mở nhận được
thông báo trong khoảng 1 giây — không cần tải lại trang.

- **Popup trong Admin:** mỗi yêu cầu mới hiện một toast "Đặt bàn mới: …" với
  nút **Xem** mở thẳng hồ sơ trong Content Manager.
- **Chấm tròn góc phải dưới:** hiện số yêu cầu chưa đọc trên mọi màn hình;
  bấm để mở Hộp thư. Chấm màu **xanh lá** = kết nối trực tiếp (realtime);
  **vàng** = đang kiểm tra mỗi 20 giây (khi kết nối trực tiếp bị gián đoạn).
- **Cài đặt theo từng trình duyệt** (đầu trang Hộp thư): *Thông báo hệ điều
  hành* — lần bật đầu tiên trình duyệt sẽ hỏi quyền thông báo, hãy chọn Cho
  phép; *Âm thanh* — bật để nghe tiếng chuông ngắn mỗi yêu cầu mới (chuông chỉ
  phát được sau khi đã bấm công tắc trong phiên đó — giới hạn của trình
  duyệt). Cả hai mặc định tắt.
- **Hành động trên từng dòng:** **Mở** = xem chi tiết; **Sửa** = sang trang
  chỉnh sửa trong Content Manager; hai nút còn lại là bước tiếp theo hay dùng
  nhất (ví dụ yêu cầu mới: **Xác nhận**, **Huỷ**). Đủ các bước nằm trong cửa sổ
  chi tiết, mục *Chuyển trạng thái*.
- **Trạng thái (2026-10-08):** *Mới* → *Đã đọc* (đã xem, chưa gọi) →
  *Đã xác nhận* (đã gọi, khách chốt) → *Khách không đến* nếu khách bỏ hẹn.
  *Đã huỷ* khi khách huỷ. *Lưu trữ* để dọn danh sách. Chỉ *Mới* được đếm trên
  chấm tròn. Đơn *Đã huỷ* / *Khách không đến* / *Lưu trữ* không tính vào số
  khách hôm nay trên trang chủ Admin.
- **Ghi chú nội bộ:** trong cửa sổ chi tiết, gõ ghi chú (ví dụ "đã gọi 10h,
  khách đổi sang 6 người") rồi bấm **Lưu ghi chú**. Chỉ nhân viên thấy, không
  bao giờ lên website.
- Cột **Trùng khung giờ** hiện nhãn vàng khi `overlapCount > 0` — cảnh báo mềm
  nhiều bàn cùng khung giờ, không tự chặn chỗ.
- Cần quyền *Xem hộp thư đặt bàn* (`reservation-inbox.read`) trong
  Settings → Roles; mặc định chỉ Super Admin có. Yêu cầu do Admin tạo tay
  trong Content Manager không bật thông báo realtime.

## Xuất dữ liệu khách (CSV, 2026-10-08)

Mở danh sách **Yêu cầu đặt bàn** hoặc **Tin nhắn liên hệ**, bấm nút **Xuất CSV**
ở góc phải trên bảng. Ở Tin nhắn liên hệ chọn thêm loại (*Tin nhắn liên hệ* hoặc
*Đăng ký nhận tin*). Chọn khoảng ngày khách gửi (mặc định từ đầu tháng
đến hôm nay; để trống cả hai = toàn bộ), bấm **Xuất CSV**. File mở thẳng bằng
Excel, giờ theo giờ Việt Nam. Tối đa 10.000 dòng mỗi lần — quá thì chọn khoảng
ngày ngắn hơn. Cần quyền *Xuất CSV khách hàng* (`lead-export.export`); mặc
định chỉ Super Admin có. File chứa thông tin cá nhân của khách: không gửi qua
kênh công khai.

## Email thông báo

**Cài đặt → Salanca → Email thông báo**: nhập email nhận báo khi khách đặt bàn hoặc gửi liên hệ, mỗi dòng một
email (tối đa 10). Để trống một mục = không gửi email cho mục đó. Bấm **Lưu**, rồi **Gửi thử** để
kiểm tra hộp thư (xem cả Spam). Chỉ Super Admin và vai trò Quản lý thấy mục này.

## Giao diện Admin (2026-10-04)

- **Ngôn ngữ:** Admin mở bằng tiếng Việt ngay từ màn đăng nhập. Tài khoản
  admin mới mặc định tiếng Việt; tài khoản cũ chưa chọn ngôn ngữ được chuyển
  sang tiếng Việt một lần khi server khởi động. Ai đã chọn English trong Hồ sơ
  thì giữ nguyên.
- **Menu trái:** trên màn hình rộng, menu hiện chữ cạnh biểu tượng. Nút
  **Thu gọn menu** ở cuối menu chuyển về dạng chỉ biểu tượng; lựa chọn được
  nhớ theo trình duyệt.
- **Banner "Trang quản trị vừa được cập nhật":** xuất hiện khi server vừa
  deploy bản mới trong lúc tab Admin đang mở. Lưu phần đang làm rồi bấm
  **Tải lại**; trang không tự tải lại để không mất dữ liệu đang nhập.
- Các mục chỉ có ở bản trả phí của Strapi (Lịch sử nội dung, Releases, Review
  Workflows, SSO, Nhật ký kiểm tra) đã được ẩn khỏi Cài đặt.

## Trước khi publish

- Đúng locale và đúng trạng thái Draft/Published.
- Không còn copy tiếng Việt trong bản EN hoặc ngược lại.
- Relation trỏ đúng bản locale tương ứng.
- Giá/trạng thái/ngày giờ giống locale còn lại khi đó là field dùng chung.
- Ảnh đúng asset, alt text đúng ngôn ngữ.
- Translation chưa duyệt phải để Draft hoặc không tạo; tuyệt đối không publish bản dịch rác.

## Native menu, 2026-10-01

`menu-page.priceNote` is an optional localized string (255 characters maximum),
returned by the existing read API. Edit the tax/service sentence here; publish
VI and EN independently. FE renders native HTML from menu-package, menu-category
and menu-item, including CMS images and displayOrder. Takeaway contact uses
global-setting hotline. Blank priceNote is omitted. No permissions are expanded.

Use `node scripts/seed-production-content.mjs` for the complete approved release.
It validates schema/media, blocks unpublished edits and records recovery content.
Optional `--preview` inspects without writes.
The Rodizio, origin and experience photos are separate image components, not
whole PDF pages.
