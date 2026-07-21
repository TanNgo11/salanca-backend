# Phase 3 — Internationalization và Editorial Workflow

## 1. Mục tiêu

Hoàn thiện CMS hai ngôn ngữ với tiếng Việt (`vi`) là locale mặc định và tiếng Anh (`en`) là locale thứ hai. Editor phải tạo, dịch, lưu draft và publish từng locale độc lập ngay trong Strapi Admin.

Phase này chưa tích hợp frontend. Mục tiêu là chứng minh data model và workflow đa ngôn ngữ đúng trước khi team frontend phụ thuộc vào API.

**Ước lượng:** 1–2 ngày làm việc của một backend developer và tối thiểu một buổi UAT với editor. Thời gian dịch nội dung không nằm trong ước lượng này.

## 2. Phụ thuộc

- Phase 1 và Phase 2 đã pass exit gate.
- Content model documentation khớp schema.
- Có ít nhất một editor đại diện tham gia UAT.
- Có nội dung mẫu tiếng Việt; bản tiếng Anh chỉ dùng khi đã được duyệt.

## 3. Chính sách locale

| Hạng mục | Quyết định |
| --- | --- |
| Default locale | `vi` |
| Secondary locale | `en` |
| Publish | Độc lập theo locale |
| Translation fallback | Chưa thực hiện ở backend; quyết định trong frontend phase |
| Missing EN | Giữ Draft hoặc không tồn tại; không bịa nội dung |
| Identifier tích hợp | `documentId` |
| Public route identifier | Localized slug |
| Media binary | Có thể dùng chung |
| Alt/caption | Localized |

Backend không âm thầm trả tiếng Việt khi consumer hỏi tiếng Anh. Fallback ngầm làm API trông tiện nhưng che giấu content thiếu và tạo SEO rác.

## 4. Field localization matrix

### Localized

- Page headings, hero copy và body copy.
- Name/title/summary/description.
- Rich text.
- Public slug.
- SEO title và description.
- Image alt/caption.
- CTA label và localized internal URL.
- Campaign terms.
- Operating period label nếu label hiển thị ra UI.

### Không localized

- Giá và currency.
- Phone, email, coordinates và external map URL.
- Start/end timestamps.
- `isActive`, `isFeatured`, `displayOrder`.
- Technical enum values.
- Media binary.
- Seed/system identifiers.

Người triển khai phải kiểm tra hành vi thực tế của field không localized trong phiên bản Strapi đã khóa. Nếu Strapi vẫn tạo giá trị theo từng locale thay vì chia sẻ vật lý, documentation phải nói thẳng và seed/validation phải giữ chúng đồng bộ. Đừng dựa vào suy đoán UI.

## 5. Work breakdown

### P3-01 — Enable và configure Internationalization

#### Thực hiện

- Xác nhận tính năng Internationalization có trong Strapi version đã khóa.
- Thiết lập `vi` làm default locale.
- Thêm `en`.
- Không giữ locale mặc định scaffold khác nếu project không dùng.
- Ghi locale codes chính xác vào technical decisions và API contract draft.

#### Nghiệm thu

- Admin hiển thị đúng hai locale `vi`, `en`.
- Record mới mặc định vào `vi`.
- Không có locale rác hoặc trùng nghĩa.

### P3-02 — Localize content types

#### Thực hiện

- Bật localization cho các page single types.
- Bật localization cho `location`, `menu-category`, `menu-item`, `menu-package`, `campaign`, `gallery-item` khi có user-facing copy.
- Đối chiếu từng field với matrix mục 4.
- Generate/update types sau schema change.

#### Nghiệm thu

- Mỗi content type có localization behavior đúng documentation.
- Field kỹ thuật không bị editor hiểu nhầm là phải dịch.
- Build và typecheck pass sau khi bật localization.

### P3-03 — Localized slug policy

#### Thực hiện

- Cho phép slug VI và EN khác nhau.
- Xác định normalization rule cho dấu tiếng Việt và ký tự đặc biệt.
- Unique constraint phải được kiểm tra theo scope locale thực tế của Strapi.
- Không dùng slug làm relation key hoặc seed identity.

#### Test cases

- VI: `thuc-don-churrascaria`.
- EN: `churrascaria-menu`.
- Hai locale có slug khác nhau nhưng thuộc cùng document.
- Duplicate slug trong cùng locale bị từ chối hoặc được xử lý theo policy.

#### Nghiệm thu

- Editor đổi slug EN không làm đổi slug VI.
- Relation vẫn đúng sau khi đổi slug.
- API query theo locale/slug cho kết quả xác định.

### P3-04 — Localized relations

#### Thực hiện

- Tạo category VI/EN và item VI/EN.
- Kiểm tra item EN liên kết đúng category EN theo policy.
- Kiểm tra campaign, location và gallery relations qua hai locale.
- Ghi rõ relation nào bắt buộc có localized target và relation nào có thể dùng chung.

#### Nghiệm thu

- Không có item EN vô tình trỏ relation hiển thị sang copy VI nếu policy không cho phép.
- Việc tạo localization mới không làm rơi relation hiện có mà không cảnh báo.
- Query populate theo locale không trả hỗn hợp copy VI/EN ngoài ý muốn.

### P3-05 — Media và localized accessibility text

#### Thực hiện

- Dùng lại cùng media asset cho VI/EN khi hình giống nhau.
- Lưu `alt` và `caption` trong component localized.
- Kiểm tra ảnh decorative có policy alt rỗng rõ ràng; không bắt editor viết alt vô nghĩa.
- Không duplicate binary chỉ để đổi alt text.

#### Nghiệm thu

- Một asset dùng chung có alt VI và alt EN khác nhau.
- Thay alt EN không ghi đè alt VI.
- Admin workflow không buộc upload lại cùng file.

### P3-06 — Draft & Publish độc lập

#### Scenarios bắt buộc

1. Tạo và publish VI, chưa tạo EN.
2. Tạo EN từ document VI nhưng giữ Draft.
3. Update EN Draft, VI Published không đổi.
4. Publish EN, cả hai locale Published.
5. Unpublish EN, VI vẫn Published.
6. Update VI Published theo workflow Strapi version đã khóa và kiểm tra trạng thái.

#### Nghiệm thu

- Không có thao tác locale này tự publish/unpublish locale kia.
- Editor nhìn được trạng thái từng locale.
- Missing translation không bị trình bày như content hoàn chỉnh.

### P3-07 — Editorial workflow tối thiểu

#### Flow chuẩn

1. Editor tạo nội dung VI.
2. Điền required fields và SEO.
3. Save Draft.
4. Reviewer/editor được phép kiểm tra content.
5. Publish VI.
6. Tạo localization EN.
7. Dịch copy, slug, SEO, alt/caption và CTA.
8. Giữ Draft cho đến khi bản dịch được duyệt.
9. Publish EN độc lập.

Phase này không phụ thuộc paid Review Workflows. Nếu tổ chức cần approval nhiều bước, ghi thành requirement Phase 4 thay vì giả vờ Draft/Publish đã giải quyết hết governance.

#### Nghiệm thu

- Editor đại diện thực hiện toàn flow mà không sửa database hoặc gọi API thủ công.
- Các điểm dễ nhầm được ghi vào editor checklist.

### P3-08 — Locale API smoke tests

Phase 3 chưa mở public production API, nhưng phải kiểm thử contract bằng quyền/token nội bộ phù hợp.

#### Cases

- Query explicit `locale=vi`.
- Query explicit `locale=en`.
- Query document chưa có EN.
- Query Published vs Draft theo cơ chế Strapi version đã khóa.
- Query localized relation và media component.
- Query localized slug.

#### Nghiệm thu

- Response có locale/document identity rõ ràng.
- Không trộn ngôn ngữ ngoài policy.
- Draft không lọt vào anonymous/read-only consumer ngoài ý muốn.

### P3-09 — Editor guide draft

Tạo checklist ngắn trong `docs/cms-editor-guide.md` gồm:

- Cách chọn locale.
- Cách tạo localization.
- Field nào phải dịch và field nào không.
- Cách xử lý ảnh/alt text.
- Cách kiểm tra Draft/Published.
- Quy tắc slug.
- Cách báo content thiếu thay vì publish bản dịch rác.

Guide đầy đủ được hoàn thiện ở handoff phase, nhưng workflow cốt lõi phải được chứng minh ở Phase 3.

## 6. Test dataset tối thiểu

- 1 `global-setting` VI và EN.
- 1 page single type VI Published, EN Draft.
- 2 menu categories có đủ VI/EN.
- 3 menu items có đủ VI/EN và relation category.
- 1 menu item chỉ có VI để test missing translation.
- 1 package đủ VI/EN với cùng giá.
- 1 campaign đủ VI/EN với cùng date range.
- 1 gallery image dùng chung binary nhưng alt/caption khác nhau.

Đây là test data, chưa phải seed production của Phase 5.

## 7. Verification matrix

| Kịch bản | Kết quả mong đợi |
| --- | --- |
| Tạo VI | Record mặc định ở `vi` |
| Tạo EN localization | Cùng document, locale `en` |
| Sửa EN copy | VI không đổi |
| Publish VI | EN Draft không tự publish |
| Unpublish EN | VI vẫn Published |
| Đổi slug EN | Slug VI và relations không đổi |
| Dùng chung image | Không duplicate binary |
| Đổi alt EN | Alt VI không đổi |
| Query `locale=vi` | Chỉ dữ liệu VI theo contract |
| Query `locale=en` thiếu translation | Không fallback ngầm |
| Query relation | Không trộn copy hai locale |

## 8. Không làm trong Phase 3

- Không xây language switcher frontend.
- Không quyết định frontend route structure cuối cùng.
- Không machine-translate hàng loạt.
- Không mở public write API.
- Không custom admin UI.
- Không thêm paid workflow/plugin khi chưa được duyệt.
- Không seed toàn bộ nội dung production.

## 9. Exit gate

- [x] `vi` là default và `en` hoạt động.
- [x] Localization matrix được áp dụng cho toàn bộ schema.
- [x] Slug VI/EN độc lập.
- [x] Relations qua locale đã được kiểm thử.
- [x] Media binary dùng chung, alt/caption localized.
- [x] Draft/Publish độc lập pass toàn bộ scenarios.
- [x] Locale API smoke tests pass.
- [ ] Editor đại diện hoàn thành workflow không cần developer.
- [x] Editor guide draft đã cập nhật.
- [x] Build và typecheck pass.
- [x] Không sửa frontend.

Nếu chỉ chứng minh được “Admin có dropdown ngôn ngữ” thì Phase 3 chưa xong. Đa ngôn ngữ thật nằm ở trạng thái publish, relation, slug, media metadata và API response.
