# Salanca CMS editor guide — VI/EN workflow

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
- `isActive`, `isFeatured`, `displayOrder`, `noIndex`.
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
2. Bản ghi mới có `status = new`.
3. Đọc nội dung; đổi `status` thành `read` khi đã xử lý, `archived` khi xong.
4. Không xóa lead trừ khi có quy trình PII/retention; ưu tiên archive.
5. Public không xem được danh sách — chỉ Admin/Authenticated roles.

Email staff notify **opt-in** (Resend + `FORM_NOTIFY_TO`); lead vẫn luôn lưu trong Admin dù mail lỗi. Copy trang form (heading, topic) vẫn nằm ở **Trang liên hệ**.

## Yêu cầu đặt bàn (form intake)

Collection **Yêu cầu đặt bàn** (`reservation-request`) nhận lead đặt bàn từ website.

1. Mở Content Manager → **Yêu cầu đặt bàn**.
2. Bản ghi mới có `status = new`.
3. Kiểm tra `preferredDate`, `preferredTime`, `guestCount`, `phone`.
4. `menuSelectionMode = later` → khách chọn món tại nhà hàng; `now` → xem relation gói buffet / món lẻ.
5. Lọc `overlapCount > 0` để ưu tiên các khung giờ có nhiều request (cảnh báo mềm — **không** tự chặn chỗ).
6. Đổi `status` thành `read` khi đã gọi khách, `archived` khi xong.
7. Public không xem được danh sách — chỉ Admin.

Form **không** kiểm tra bàn trống realtime. Email staff notify **opt-in** (cùng Resend + `FORM_NOTIFY_TO` như liên hệ). Copy trang đặt bàn vẫn nằm ở **Trang đặt bàn**.

## Trước khi publish

- Đúng locale và đúng trạng thái Draft/Published.
- Không còn copy tiếng Việt trong bản EN hoặc ngược lại.
- Relation trỏ đúng bản locale tương ứng.
- Giá/trạng thái/ngày giờ giống locale còn lại khi đó là field dùng chung.
- Ảnh đúng asset, alt text đúng ngôn ngữ.
- Translation chưa duyệt phải để Draft hoặc không tạo; tuyệt đối không publish bản dịch rác.
