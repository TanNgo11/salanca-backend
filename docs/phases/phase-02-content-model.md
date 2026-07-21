# Phase 2 — Content Model và Strapi Admin CRUD

## 1. Mục tiêu

Biến prototype Salanca thành một content model có cấu trúc, đủ rõ để đội nội dung quản lý bằng Strapi Admin mặc định và đủ ổn định để frontend tích hợp sau này.

Phase này tạo schema và kiểm tra CRUD. Chưa nhập toàn bộ nội dung thật, chưa mở API public và chưa tích hợp frontend.

**Ước lượng:** 2–4 ngày làm việc của một backend developer, cộng một buổi review với người phụ trách nội dung. Nếu không có content owner review, schema chỉ là phỏng đoán được code hóa.

## 2. Phụ thuộc

- Phase 1 đã pass toàn bộ exit gate.
- Strapi chạy trên PostgreSQL.
- Schema changes được thực hiện trong development và commit vào Git.
- Prototype HTML hiện tại là nguồn tham chiếu cho field/section, không phải nơi bị sửa.

## 3. Nguyên tắc modeling

- Fixed schema theo nhu cầu Salanca; không dựng generic page builder.
- Dữ liệu dùng để lọc, sắp xếp hoặc tính toán phải có field riêng, không nhét vào rich text.
- Giá lưu dạng số, không lưu chuỗi đã format.
- Boolean và status phải có default rõ ràng.
- Relation chỉ tạo khi có nhu cầu quản trị hoặc query thật.
- Không tạo field “để dành sau này” nếu chưa có consumer/workflow.
- Tên API dùng tiếng Anh, ổn định và nhất quán; label admin có thể thân thiện với editor.
- Schema phải chuẩn bị localization ngay từ thiết kế, nhưng kiểm thử locale đầy đủ thuộc Phase 3.

## 4. Deliverables

- Shared components trong `src/components`.
- Single types và collection types trong `src/api`.
- Draft & Publish cho content public.
- Admin list/edit views được cấu hình đủ dùng.
- `docs/cms-content-model.md` phản ánh schema thực tế.
- Schema verification checklist và evidence CRUD.

## 5. Work breakdown

### P2-01 — Content inventory từ prototype

#### Thực hiện

Lập ma trận source → model cho:

- Trang chủ.
- Câu chuyện.
- Thực đơn.
- Trải nghiệm.
- Không gian.
- Ưu đãi & Sự kiện.
- Đặt bàn — chỉ content tĩnh.
- Liên hệ — chỉ content tĩnh.
- Header/footer/global contact information.

Mỗi đoạn phải được phân loại:

- Global dùng lại nhiều nơi.
- Page-specific.
- Repeatable collection.
- Media.
- Không nên đưa vào CMS vì là UI/decorative behavior.

#### Nghiệm thu

- Không có content public quan trọng trong prototype bị bỏ quên.
- CSS class, animation và layout implementation không bị biến thành CMS fields.
- Có quyết định rõ field nào thuộc global, page hay collection.

### P2-02 — Shared components

#### `shared.seo`

| Field | Type | Rule |
| --- | --- | --- |
| `metaTitle` | string | required, max length được ghi trong docs |
| `metaDescription` | text | required |
| `shareImage` | media | single image |
| `canonicalPath` | string | path, không lưu domain environment |
| `noIndex` | boolean | default `false` |

#### `shared.link`

| Field | Type | Rule |
| --- | --- | --- |
| `label` | string | required |
| `url` | string | required |
| `openInNewTab` | boolean | default `false` |

#### `shared.image`

| Field | Type | Rule |
| --- | --- | --- |
| `media` | media | required, single image |
| `alt` | string | required cho ảnh mang nội dung |
| `caption` | string | optional |

#### `shared.operating-period`

| Field | Type | Rule |
| --- | --- | --- |
| `label` | string | required |
| `opensAt` | time | required |
| `closesAt` | time | required |

#### `shared.cta`

- `heading`: string.
- `body`: text.
- `link`: `shared.link`, required khi CTA được bật.

#### Nghiệm thu

- Component dùng lại đúng nơi, không copy cùng nhóm field sang nhiều content type.
- Không tạo component chỉ được dùng đúng một lần mà không có lý do.
- Media public có alt metadata, không dựa vào filename.

### P2-03 — Global và page single types

#### `global-setting`

- Brand name và logo.
- Hotline, email, address, map URL.
- Operating periods.
- Social links.
- Default SEO.
- Footer copy và navigation links.

#### Fixed page schemas

- `home-page`.
- `menu-page`.
- `campaign-page`.
- `story-page`.
- `experience-page`.
- `space-page`.
- `contact-page`.
- `booking-page`.

Mỗi page chỉ có các section đã xác định từ prototype: hero, structured content blocks cố định, CTA và SEO. Nếu hai page có layout khác nhau thì model khác nhau; đừng ép chúng vào một Dynamic Zone khổng lồ.

`booking-page` và `contact-page` chỉ chứa copy, thông tin hỗ trợ và SEO. Không chứa submission records.

#### Nghiệm thu

- Mỗi single type có đúng một edit surface rõ ràng trong Admin.
- Editor nhìn field label có thể hiểu mà không cần đọc code.
- Không có field layout/CSS như `marginTop`, `gridColumns`, `animationClass`.

### P2-04 — `location`

#### Fields

- `name`: string, required.
- `slug`: UID/string, required.
- `address`: text, required.
- `mapUrl`: string.
- `phone`: string.
- `email`: email.
- `operatingHours`: repeatable `shared.operating-period`.
- `heroImage`: `shared.image`.
- `gallery`: repeatable `shared.image` nếu gallery riêng cho location.
- `isActive`: boolean, default `true`.
- `displayOrder`: integer, default rõ ràng.
- `seo`: `shared.seo`.

#### Nghiệm thu

- Tạo/sửa/xóa location trong Admin được.
- `displayOrder` không nhận giá trị rác ngoài rule đã định.
- Location inactive không bị hiểu nhầm là unpublished; hai trạng thái phải được document.

### P2-05 — Menu domain

#### `menu-category`

- `name`, `slug`, `description`.
- `image`.
- `displayOrder`, `isActive`.
- One-to-many với `menu-item`.

#### `menu-item`

- `name`, `slug`.
- `shortDescription`, `description`.
- `price`: decimal, VND.
- `image`.
- `category`: required relation.
- `isFeatured`, `isActive`, `displayOrder`.
- `allergenNotes` và `dietaryTags` chỉ thêm khi stakeholder xác nhận cần quản lý.

#### `menu-package`

- `name`, `slug`, `description`.
- `adultPrice`, `childPrice`: decimal.
- `includedItems`: structured repeatable text hoặc relation đã được quyết định trong content-model doc.
- `image`, `isFeatured`, `isActive`, `displayOrder`.
- `seo`.

#### Quy tắc

- Không lưu currency formatting trong price.
- Không copy category name vào menu item.
- Không cascade delete category nếu hành vi đó làm mất món ngoài ý muốn.
- Nếu category còn item, delete phải bị chặn hoặc có quy trình reassignment rõ ràng.

#### Nghiệm thu

- Editor tạo category → item → package hoàn toàn trong Admin.
- Relation hiển thị dễ chọn.
- Giá giữ đúng precision sau save/reload.
- Sort theo `displayOrder` cho kết quả xác định.

### P2-06 — `campaign`

#### Fields

- `kind`: enum `promotion`, `event`, `private_event`.
- `title`, `slug`, `summary`, `body`.
- `coverImage`, gallery.
- `startsAt`, `endsAt`.
- `terms`.
- `cta`.
- `isFeatured`, `displayOrder`.
- `seo`.

#### Validation

- `endsAt` không được trước `startsAt` khi cả hai có giá trị.
- `kind` required.
- Featured không có nghĩa là published.
- Campaign hết hạn không tự động bị xoá.

Phase 2 chỉ thêm validation trong khả năng schema mặc định. Validation liên field cần code phải được ghi thành follow-up rõ ràng, không giấu trong checklist.

#### Nghiệm thu

- Editor tạo đủ ba kind trong cùng Admin collection.
- Filter theo kind và trạng thái dùng được.
- Date range được hiển thị và lưu đúng timezone policy đã ghi.

### P2-07 — `gallery-item`

#### Fields

- `title`, `description`.
- `image`: `shared.image`, required.
- `area`: enum `main_hall`, `bar`, `private_room`, `night`, `food`, `experience`.
- `location`: optional relation.
- `displayOrder`, `isActive`.

#### Nghiệm thu

- Filter theo area/location được.
- Gallery item có alt text.
- Một asset có thể được tham chiếu mà không buộc duplicate file upload.

### P2-08 — Draft & Publish và admin presentation

#### Thực hiện

- Bật Draft & Publish cho page, menu content, campaign, location và gallery public.
- Cấu hình main field và columns hữu ích trong Admin nếu Strapi version hỗ trợ bằng config ổn định.
- Ghi rõ khác biệt giữa `published`, `isActive` và `isFeatured`.

#### Nghiệm thu

- Draft record không bị nhầm là live content.
- Editor có thể search/filter bằng field nghiệp vụ chính.
- Admin list không bắt editor mở từng record chỉ để biết record nào là record nào.

### P2-09 — Content model documentation

`docs/cms-content-model.md` phải có:

- Mục đích từng model.
- Field name, type, required/default/localization intent.
- Relations và delete behavior.
- Draft & Publish policy.
- Ví dụ dữ liệu tối thiểu.
- Những model bị hoãn.

Tài liệu phải phản ánh schema đã chạy, không phải wishlist cũ.

## 6. Models cấm tạo trong Phase 2

- `reservation-request`.
- `contact-message`.
- `availability-slot`.
- `table`.
- `payment`.
- Generic `page` + unrestricted Dynamic Zone.
- Dashboard/reporting models chưa có workflow.

## 7. CRUD verification matrix

Với mỗi content type:

- Create record hợp lệ.
- Reject required field thiếu.
- Update field và relation.
- Save draft.
- Publish/unpublish nếu được bật.
- Search/filter/sort field chính.
- Delete theo policy.
- Restart và xác nhận persistence.

Riêng menu:

- Category có nhiều items.
- Item bắt buộc category.
- Giá decimal không bị đổi sau reload.

Riêng campaign:

- Cả ba `kind` hoạt động.
- Date range và timezone đúng policy.

## 8. Exit gate

- [x] Shared components không bị duplicate vô lý.
- [ ] Tất cả single/collection types trong scope tồn tại trong Admin.
- [ ] CRUD matrix pass.
- [x] Draft & Publish hoạt động.
- [x] Relations và delete behavior được kiểm thử.
- [x] Không có page builder tổng quát.
- [x] Không có reservation/booking models.
- [x] `docs/cms-content-model.md` khớp schema thực tế.
- [x] Build và typecheck pass.
- [x] Không sửa frontend.

Nếu editor vẫn phải hỏi developer “field này dùng làm gì” cho phần lớn form, schema chưa đạt. CRUD tự sinh không cứu được content model tệ.
