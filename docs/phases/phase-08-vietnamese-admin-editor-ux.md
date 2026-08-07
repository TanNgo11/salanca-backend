# Phase 8 — Việt hóa trải nghiệm biên tập trong Strapi Admin

**Trạng thái:** Planned / optional. Chỉ triển khai khi owner ưu tiên; chưa được tính là work đang authorized.

## 1. Mục tiêu

Giúp nhân viên nội dung hoàn thành các luồng thường dùng trong Strapi Admin bằng tiếng Việt mà không phải đoán thuật ngữ kỹ thuật.

Phase này **không hứa Việt hóa 100% toàn bộ Strapi**. “Hoàn tất” ở đây có nghĩa là các màn hình và thao tác thuộc vai trò Content Editor/Publisher trong phạm vi Salanca có nhãn, nút, trạng thái, hướng dẫn và lỗi chính bằng tiếng Việt.

Tận dụng hai seam đã có trong repository:

- `src/admin/translations/vi.ts` để override các translation key của Admin/plugin.
- `config.metadatas` trong schema cùng bootstrap `src/bootstrap/content-manager-labels/` để đồng bộ nhãn field.

**Ước lượng:** 0.5–1.5 ngày dev + 0.5 ngày editor UAT. Nếu mở rộng sang toàn bộ Settings, Content-Type Builder và plugin kỹ thuật, phải estimate lại; không nhét thêm vào phase này.

## 2. Phạm vi người dùng và luồng ưu tiên

### P0 — Bắt buộc

- Content Editor/Publisher tạo, sửa, lưu, xuất bản và hủy xuất bản nội dung.
- Chuyển locale nội dung `vi` / `en` mà không nhầm với ngôn ngữ giao diện Admin.
- Upload/chọn ảnh, nhập alt text và caption.
- Tìm kiếm, lọc, sắp xếp và phân trang danh sách nội dung.
- Hiểu lỗi required, duplicate slug, relation được bảo vệ và dữ liệu không hợp lệ.
- Quản lý các collection type vận hành:
  - Ảnh gallery
  - Chi nhánh
  - Gói buffet
  - Món và Nhóm món
  - Ưu đãi / sự kiện
  - Tin nhắn liên hệ
  - Yêu cầu đặt bàn
- Chỉnh các single type website đã bàn giao cho editor.

### P1 — Nên có nếu còn trong timebox

- Media Library trong các thao tác editor thực tế dùng.
- Hồ sơ cá nhân và bước chọn ngôn ngữ giao diện `Vietnamese (vi)`.
- Các empty state, confirmation dialog và notification xuất hiện trong luồng P0.

## 3. Non-goals

- Việt hóa toàn bộ Settings dành cho Super Admin.
- Việt hóa Content-Type Builder cho developer.
- Dịch các trang pricing, upgrade, audit, token, SSO hoặc tính năng Enterprise không dùng.
- Fork hoặc patch trực tiếp package trong `node_modules`.
- Xây custom Admin UI hoặc cài plugin dịch không được kiểm soát.
- Đổi tên attribute trong schema chỉ để đổi label. Việc đổi `title`, `description`, `displayOrder`, v.v. sẽ làm thay đổi API/data contract và là giải pháp tệ.
- Dùng Chrome auto-translate làm tiêu chí nghiệm thu. Nó chỉ là workaround tạm thời.
- Dịch nội dung website VI/EN; đó là editorial content, không phải Admin UI translation.

## 4. Quyết định khóa

| Hạng mục | Quyết định |
| --- | --- |
| Phạm vi dịch | Theo hành trình Content Editor/Publisher, không theo toàn bộ số trang Strapi |
| Translation source | Override có version-control trong `src/admin/translations/vi.ts` |
| Nhãn field | `config.metadatas` + bootstrap hiện có; không rename schema attribute |
| Content type name | Giữ `info.displayName` tiếng Việt |
| Interface locale | `vi` được expose; preference vẫn theo từng Admin user nếu Strapi không có API supported để đặt mặc định toàn cục |
| Fallback | Key chưa thuộc scope được phép fallback sang English; phải ghi nhận, không khai gian “100%” |
| Upgrade safety | Không import translation từ đường dẫn nội bộ/private của package Strapi |

## 5. Work breakdown

### P8-01 — Chụp baseline và lập inventory

**Thực hiện**

- Dùng tài khoản Content Editor và Publisher thật, không chỉ Super Admin.
- Đi qua các luồng P0 và ghi lại chuỗi tiếng Anh nhìn thấy theo màn hình.
- Phân loại mỗi chuỗi:
  1. translation key của Strapi core;
  2. translation key của plugin;
  3. content type/component display name;
  4. field label/description/placeholder;
  5. technical value cần giữ nguyên.
- Chốt danh sách key P0 trước khi sửa để tránh dịch mò cả framework.

**Nghiệm thu**

- Có checklist baseline theo luồng, gồm ít nhất create/edit/list/media/publish/locale/error.
- Mỗi chuỗi P0 có owner kỹ thuật rõ: translation override hoặc schema metadata.

### P8-02 — Hoàn thiện translation override cho luồng editor

**Thực hiện**

- Mở rộng `src/admin/translations/vi.ts` cho các key P0/P1 đã inventory.
- Ưu tiên:
  - tiêu đề create/edit entry;
  - trạng thái Draft/Published;
  - Save/Publish/Unpublish/Delete và confirmation;
  - list/search/filter/sort/pagination;
  - upload/select/replace/remove asset;
  - locale switcher và notification/error chính.
- Giữ key trong enum/typed map hoặc cấu trúc type-safe tương đương.
- Không copy mù toàn bộ catalog tiếng Anh sang file custom.

**Nghiệm thu**

- Không có missing-translation warning cho danh sách key P0 đã chốt.
- Production Admin build load được locale `vi`.
- English fallback ngoài scope không bị ghi đè sai.

### P8-03 — Việt hóa nhãn field và component

**Thực hiện**

- Audit mọi content type/component editor nhìn thấy.
- Bổ sung `config.metadatas` cho label, description và placeholder cần thiết.
- Dùng thuật ngữ nghiệp vụ nhất quán, ví dụ:
  - `title` → `Tiêu đề`
  - `description` → `Mô tả`
  - `displayOrder` → `Thứ tự hiển thị`
  - `isActive` → `Đang hoạt động`
  - `isFeatured` → `Nổi bật`
  - `area` → `Khu vực`
  - `location` → `Chi nhánh`
- Dịch display name còn tiếng Anh của shared component mà editor trực tiếp thao tác.
- Giữ nguyên attribute key, enum value, relation UID và REST contract.

**Nghiệm thu**

- Mọi field P0 có label dễ hiểu bằng tiếng Việt trong edit view.
- Label vẫn đúng sau restart/DB mới nhờ bootstrap, không phụ thuộc click tay trên một database.
- `pnpm run verify:schema` xác nhận contract không bị đổi ngoài metadata cho phép.

### P8-04 — Onboarding ngôn ngữ giao diện

**Thực hiện**

- Cập nhật `docs/cms-editor-guide.md` với đường dẫn:
  - avatar → Profile;
  - Experience → Interface language;
  - chọn `Vietnamese (vi)` → Save.
- Xác minh preference được lưu riêng theo từng Admin user.
- Chỉ nghiên cứu auto-default cho user mới nếu Strapi có extension point/public API được hỗ trợ. Không update thẳng bảng Admin user và không monkey-patch bundle.

**Nghiệm thu**

- Editor mới có thể chuyển giao diện sang VI trong dưới 1 phút.
- Tài liệu phân biệt rõ interface language với content locale VI/EN.

### P8-05 — Automated checks và manual UAT

**Automated**

- Unit test cho custom translation map: key không trùng, value không rỗng, locale VI có các key P0 bắt buộc.
- Mở rộng schema verification/label bootstrap tests để bắt content model P0 thiếu metadata.
- Chạy:

```powershell
pnpm run lint
pnpm run verify:schema
pnpm run typecheck
pnpm run test
pnpm run build
```

**Manual UAT**

- Tài khoản Content Editor tạo và lưu một Ảnh gallery VI.
- Upload ảnh, nhập alt text, chuyển VI → EN và lưu bản EN.
- Publisher publish/unpublish độc lập từng locale.
- Tìm kiếm/lọc một collection và xử lý một confirmation dialog.
- Cố tình gây required error và duplicate slug để kiểm tra thông báo.
- Kiểm tra desktop ở viewport vận hành thực tế; không yêu cầu redesign responsive Admin.

## 6. Acceptance matrix

| Khu vực | Điều kiện pass |
| --- | --- |
| Điều hướng editor | Tên content type thuộc P0 bằng tiếng Việt |
| List view | Search/filter/sort/status/action chính dễ hiểu bằng tiếng Việt |
| Edit view | Tiêu đề trang, nhãn field, helper cần thiết và action chính bằng tiếng Việt |
| Media | Add/select/replace/remove và alt/caption flow đủ hiểu để thao tác |
| Publish workflow | Draft/Published/Save/Publish/Unpublish và confirmation không gây nhầm |
| Locale | Editor phân biệt được ngôn ngữ giao diện với locale nội dung |
| Error UX | Các lỗi P0 có thông báo hành động được, không chỉ mã kỹ thuật |
| Contract safety | Không rename field, không đổi REST response, không migration dữ liệu |
| Persistence | Nhãn tồn tại sau restart và database bootstrap sạch |

## 7. Documentation impact

| File | Thay đổi khi implement |
| --- | --- |
| `docs/cms-editor-guide.md` | Hướng dẫn chọn VI và các luồng đã Việt hóa |
| `docs/STATUS.md` | Trạng thái, gate đã chạy, manual UAT còn mở |
| `docs/phase-08-verification.md` | Evidence automated + editor UAT |
| `docs/strapi-backend-roadmap.md` | Chuyển Planned → Implemented/Closed đúng bằng chứng |

## 8. Exit gate

Phase 8 chỉ được đóng khi:

1. Danh sách luồng P0 được owner/editor chấp thuận.
2. Automated gates nêu trên pass.
3. Content Editor và Publisher hoàn thành manual UAT bằng giao diện VI.
4. Không có schema/API rename hoặc custom Admin screen phát sinh.
5. Mọi English fallback còn lại được xác nhận là ngoài scope, không dùng tuyên bố sai “Việt hóa 100%”.

