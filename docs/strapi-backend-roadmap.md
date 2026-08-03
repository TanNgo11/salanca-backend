# Salanca Strapi Backend Roadmap

## 1. Mục tiêu

Khởi tạo một Strapi backend ổn định để đội nội dung có thể quản lý website Salanca ngay trong Strapi Admin, trước khi tích hợp frontend.

Kết quả của giai đoạn này phải là một CMS có thể triển khai lên môi trường staging, hỗ trợ tiếng Việt và tiếng Anh, có schema rõ ràng, dữ liệu mẫu, phân quyền và tài liệu API. Frontend hiện tại không được di chuyển hoặc sửa trong giai đoạn này.

## 2. Phạm vi

### Trong phạm vi

- Strapi 5, TypeScript và PostgreSQL.
- Backend là repository độc lập; Strapi nằm ngay repository root.
- Strapi Admin CRUD mặc định, không xây admin riêng.
- Quản lý menu, gói buffet, ưu đãi/sự kiện, không gian, thông tin nhà hàng và nội dung các trang.
- Đa ngôn ngữ với `vi` là locale mặc định và `en` là locale thứ hai.
- Draft & Publish cho nội dung public.
- Media Library và cấu hình object storage cho production.
- Admin roles, API permissions, CORS, secrets và các cấu hình an toàn tối thiểu.
- Seed dữ liệu mẫu từ prototype hiện tại.
- API contract để đội frontend tích hợp ở giai đoạn sau.
- Build, smoke test, backup/restore notes và runbook triển khai.

### Ngoài phạm vi

- Tích hợp frontend với Strapi.
- Thay đổi HTML/CSS hoặc cấu trúc route của prototype.
- Public API nhận đặt bàn và liên hệ.
- Email, SMS, Zalo, CAPTCHA và chống spam cho form.
- Kiểm tra bàn trống, giữ slot, chống overbooking, đặt cọc hoặc thanh toán.
- Calendar, Kanban, dashboard hoặc custom Strapi Admin.
- Review Workflow trả phí hoặc plugin không cần thiết cho MVP.

Những mục ngoài phạm vi chỉ được thực hiện khi có phase riêng. Không lén nhét chúng vào lúc dựng schema.

## 3. Quyết định kiến trúc

| Hạng mục | Quyết định |
| --- | --- |
| CMS | Strapi 5, khóa phiên bản cụ thể trong lockfile |
| Ngôn ngữ code | TypeScript |
| Database | PostgreSQL cho local, staging và production |
| Vị trí backend | Repository root `salanca-backend` |
| Admin | Strapi Admin mặc định |
| API | REST trước; không thêm GraphQL khi chưa có consumer thực tế |
| Locale | `vi` mặc định, `en` bổ sung |
| Nội dung public | Bật Draft & Publish |
| Media local | Local upload trong development |
| Media production | S3/R2-compatible object storage |
| Schema | Lưu bằng code và review qua Git |
| Secrets | Environment variables; chỉ commit `.env.example` |
| Frontend | Giữ nguyên trong phase này |

Không dùng SQLite ngoài thử nghiệm throwaway. Dùng SQLite ở local rồi PostgreSQL ở production là cách rẻ tiền để mua lỗi khác biệt môi trường.

## 4. Cấu trúc repository mục tiêu

```text
salanca-backend/
├── config/
├── database/
│   └── migrations/
├── scripts/
│   ├── seed.ts
│   └── verify-seed.ts
├── src/
│   ├── api/
│   ├── components/
│   └── extensions/
├── types/
├── docs/
│   ├── strapi-backend-roadmap.md
│   ├── cms-content-model.md
│   ├── cms-editor-guide.md
│   ├── cms-api-contract.md
│   └── cms-operations-runbook.md
├── .env.example
├── compose.yaml
├── package.json
└── tsconfig.json
```

Prototype được giữ tại sibling repository `../salanca-cms` và chỉ dùng làm nguồn tham chiếu. Backend không được phụ thuộc runtime vào sibling repository này.

## 5. Content model đề xuất

### 5.1 Shared components

#### `shared.seo`

- `metaTitle`: string, required, localized.
- `metaDescription`: text, required, localized.
- `shareImage`: media, single image.
- `canonicalPath`: string, localized.
- `noIndex`: boolean, default `false`.

#### `shared.link`

- `label`: string, required, localized.
- `url`: string, required, localized khi trỏ đến nội dung theo locale.
- `openInNewTab`: boolean, default `false`.

#### `shared.image`

- `media`: media, required, single image.
- `alt`: string, required, localized.
- `caption`: string, localized.

Không dùng trực tiếp Media Library cho nội dung public nếu hình cần `alt` theo ngôn ngữ. Media asset có thể dùng chung, metadata hiển thị phải nằm trong component localized.

#### `shared.operating-period`

- `label`: string, localized, ví dụ `Buổi trưa`.
- `opensAt`: time.
- `closesAt`: time.

#### `shared.cta`

- `heading`: string, localized.
- `body`: text, localized.
- `link`: component `shared.link`.

### 5.2 Single types

#### `global-setting`

- Tên thương hiệu, logo, hotline, email.
- Địa chỉ mặc định và URL bản đồ.
- Giờ mở cửa.
- Facebook, Instagram và các social links.
- Default SEO.
- Footer copy và footer links.

Chỉ các field hiển thị bằng chữ mới localized. Số điện thoại, email, tọa độ và URL không nhân bản vô nghĩa theo locale.

#### Page single types

- `home-page`.
- `menu-page`.
- `campaign-page`.
- `story-page`.
- `experience-page`.
- `space-page`.
- `contact-page`.
- `booking-page`.

Mỗi page dùng schema cố định bám theo prototype: hero, các section đã biết, CTA và SEO. Không tạo generic page builder và không cho editor tự ráp tùy ý hàng chục Dynamic Zone.

`booking-page` chỉ quản lý copy hướng dẫn và thông tin liên hệ. Nó không chứa reservation records trong phase này.

### 5.3 Collection types

#### `location`

- `name`, `slug`, `address`, `mapUrl`.
- `phone`, `email`.
- `operatingHours`.
- `heroImage` và gallery.
- `isActive`, `displayOrder`.
- SEO.

#### `menu-category`

- `name`, `slug`, `description`.
- `image`.
- `displayOrder`, `isActive`.
- Quan hệ one-to-many với `menu-item`.

#### `menu-item`

- `name`, `slug`, `shortDescription`, `description`.
- `price`: decimal, đơn vị VND.
- `image`.
- `category`: relation required.
- `isFeatured`, `isActive`, `displayOrder`.
- `allergenNotes` và `dietaryTags` nếu nội dung thực tế có nhu cầu.

Không lưu chuỗi `950.000 VNĐ` vào một text field. Giá phải là số; frontend chịu trách nhiệm format.

#### `menu-package`

- `name`, `slug`, `description`.
- `adultPrice`, `childPrice`: decimal.
- `includedItems`: repeatable localized text hoặc relation nếu cần truy vấn món.
- `image`, `isFeatured`, `isActive`, `displayOrder`.
- SEO.

#### `campaign`

Một model chung cho nội dung đang xuất hiện tại trang Ưu đãi & Sự kiện:

- `kind`: enumeration `promotion`, `event`, `private_event`.
- `title`, `slug`, `summary`, `body`.
- `coverImage`, gallery.
- `startsAt`, `endsAt`.
- `terms`.
- CTA.
- `isFeatured`, `displayOrder`.
- SEO.

Không tách `promotion` và `event` chỉ vì tên gọi khác nhau khi cấu trúc dữ liệu hiện tại giống nhau. Tách model chỉ khi workflow hoặc field của chúng thực sự phân kỳ.

#### `gallery-item`

- `title`, `description`.
- `image`.
- `area`: enumeration `main_hall`, `bar`, `private_room`, `night`, `food`, `experience`.
- `location`: optional relation.
- `displayOrder`, `isActive`.

### 5.4 Models bị hoãn

- `reservation-request`.
- `contact-message`.
- `availability-slot`.
- `table`.
- `payment`.

Không tạo các model này cho đẹp schema. Chúng chỉ được tạo cùng API và workflow thực sự sử dụng chúng.

## 6. Chính sách đa ngôn ngữ

### Locale và trạng thái nội dung

- `vi` là default locale và bắt buộc có trước khi nội dung được xem là hoàn tất.
- `en` là locale thứ hai; bản dịch chưa đủ phải giữ Draft.
- Không tự động publish bản tiếng Anh khi publish tiếng Việt.
- Không dùng machine translation làm dữ liệu production mà không có editor duyệt.

### Field localization

Localized:

- Tên, tiêu đề, mô tả, rich text.
- Slug public.
- SEO title/description.
- Alt text, caption và CTA label.
- Điều khoản ưu đãi.

Không localized:

- Giá, currency.
- Điện thoại, email.
- Ngày bắt đầu/kết thúc.
- Trạng thái active/featured.
- Display order.
- Media binary và các identifier kỹ thuật.

### Quan hệ giữa locale

- Category, item và campaign phải được kiểm tra ở cả hai locale trong seed và smoke test.
- API contract phải luôn yêu cầu consumer truyền locale rõ ràng.
- Chính sách fallback `en → vi` thuộc frontend phase; backend không âm thầm trộn hai locale trong cùng response.
- Slug có thể khác giữa `vi` và `en`; định danh tích hợp dùng `documentId`, không dùng slug làm foreign key.

## 7. Phân quyền và bảo mật

### Admin roles

#### Super Admin

- Quản lý hệ thống, plugin, role, token và schema.
- Chỉ cấp cho người phụ trách kỹ thuật.

#### Content Editor

- Tạo và sửa nội dung.
- Upload/chọn media.
- Không quản lý users, API tokens, plugin hoặc cấu hình hệ thống.
- Không publish nếu quy trình nội bộ yêu cầu kiểm duyệt.

#### Publisher

- Có quyền của Content Editor.
- Được publish/unpublish nội dung public.

Nếu edition đang dùng không hỗ trợ đúng mức phân quyền mong muốn, ghi rõ giới hạn và dùng bộ role tối giản. Không phụ thuộc vào tính năng trả phí mà chưa được duyệt ngân sách.

### API permissions

- Mặc định tất cả API public là deny.
- Chỉ mở `find` và `findOne` cho content public khi bắt đầu phase tích hợp frontend.
- Không mở create/update/delete public trong CMS phase.
- API token cho server-to-server phải có scope tối thiểu và có kế hoạch rotate.
- Không đưa admin token hoặc full-access token vào browser.
- CORS chỉ cho phép origin local/staging/production đã khai báo bằng environment variables.
- Bật security headers và giới hạn kích thước upload phù hợp.

## 8. Media strategy

- Development có thể dùng local upload để khởi động nhanh.
- Staging và production dùng S3/R2-compatible object storage.
- Chỉ chấp nhận MIME type ảnh đã duyệt.
- Có giới hạn dung lượng upload.
- Editor phải nhập alt text qua `shared.image`.
- Tên file được chuẩn hóa; không phụ thuộc tên file để làm business identifier.
- Không commit file upload runtime vào Git.
- Xác định trước ownership và quy trình xoá asset để tránh xoá ảnh đang được nhiều locale sử dụng.

## 9. Seed và dữ liệu ban đầu

Seed script phải:

- Chạy được trên database trống.
- Idempotent: chạy lại không nhân đôi dữ liệu.
- Dùng `seedKey` hoặc identifier ổn định cho dữ liệu hệ thống.
- Tạo locale `vi` trước, sau đó tạo/link `en`.
- Import nội dung mẫu từ prototype hiện tại.
- Không seed admin password cố định.
- Không nhúng secret hoặc URL production vào source.
- In summary số record tạo mới, cập nhật và bỏ qua.

Dữ liệu tiếng Anh chưa được duyệt phải ở Draft, không bịa bản dịch chỉ để đạt đủ record.

## 10. API contract cho frontend phase sau

Trong CMS phase chỉ định nghĩa và kiểm thử contract; không sửa frontend.

Tài liệu `docs/cms-api-contract.md` phải mô tả tối thiểu:

- Base URL theo environment.
- Endpoint cho global settings, pages, menu, campaigns và gallery.
- Cách truyền `locale`.
- Quy ước `documentId`, slug, pagination, filters, sort và populate.
- Response examples cho `vi` và `en`.
- Quy tắc Draft/Published.
- Media URL và alt text.
- Error envelope.
- Cache expectations để đội frontend quyết định build-time fetch hay runtime fetch.

Không dùng `populate=*` như API contract production mặc định. Chỉ populate relation/component frontend thực sự cần để response có thể kiểm soát và không phình vô hạn.

## 11. Roadmap triển khai

| Phase | Mục tiêu | Ước lượng | Spec |
| --- | --- | --- | --- |
| Phase 1 | Chốt baseline, khởi tạo Strapi TypeScript và PostgreSQL | 1–2 ngày dev | [Phase 1 — Foundation](./phases/phase-01-foundation.md) |
| Phase 2 | Dựng content model và CRUD trong Strapi Admin | 2–4 ngày dev | [Phase 2 — Content Model](./phases/phase-02-content-model.md) |
| Phase 3 | Hoàn thiện VI/EN và editorial workflow | 1–2 ngày dev + editor UAT | [Phase 3 — Internationalization](./phases/phase-03-internationalization.md) |
| Phase 0 | Đóng UAT Phase 1–3 + platform decisions (trước code Phase 4) | 0.5–1 ngày + owner | [Phase 0 — Close UAT](./phases/phase-00-close-uat-and-decisions.md) |
| Phase 4 | Hardening (`/api/v1`, CORS, tests), S3 media, Admin roles | 3–5 ngày dev | [Phase 4 — Hardening, media, roles](./phases/phase-04-hardening-media-roles.md) |
| Phase 5 | Seed nội dung prototype idempotent | 2–3 ngày dev | [Phase 5 — Seed content](./phases/phase-05-seed-content.md) |
| Phase 6 | API contract, public read allowlist, backend QA | 2–3 ngày dev | [Phase 6 — API contract and QA](./phases/phase-06-api-contract-and-qa.md) |
| Phase 7 | Staging, backup/restore, FE handoff pack | 2–4 ngày + infra | [Phase 7 — Staging and handoff](./phases/phase-07-staging-and-handoff.md) |

Overview pattern-lift (từ backend Nhà Thật, domain Salanca): [BE pattern lift plan](./plans/be-pattern-lift-plan.md).

Phase 1–3 đã có implementation; đóng UAT qua Phase 0 trước khi implement Phase 4. Spec Phase 4–7 đã draft (2026-08-03) — implement theo spec đó, không theo bullet roadmap cũ.

Ước lượng trên giả định một backend developer đã có môi trường chạy PostgreSQL, stakeholder phản hồi schema trong ngày và không bao gồm thời gian biên dịch nội dung tiếng Anh. Nếu ba điều kiện đó không đúng, cộng thêm buffer thay vì ép team chạy theo con số giả.

### Phase 1 — Foundation: Strapi và PostgreSQL

#### Công việc

- Ghi nhận phiên bản Node LTS được Strapi 5 hỗ trợ tại thời điểm triển khai.
- Khóa Node, package manager và Strapi version.
- Khởi tạo Strapi TypeScript tại repository root bằng CLI chính chủ; không dùng quickstart tạo SQLite.
- Kết nối PostgreSQL local và chuẩn hóa environment variables.
- Thiết lập health check, build, typecheck, ignore rules và baseline vận hành.
- Chụp lại Git status; không đụng vào WIP frontend hiện tại.

#### Gate hoàn tất

- CMS boot được từ database PostgreSQL trống.
- Admin login được và dữ liệu còn nguyên sau restart.
- `build` và `typecheck` pass.
- Không có secret thật trong Git.
- Các quyết định còn phụ thuộc hosting/storage đã có owner và deadline rõ ràng.

### Phase 2 — Components và content types

#### Công việc

- Tạo shared components.
- Tạo single types và collection types trong mục 5.
- Cấu hình relations, required fields, defaults và unique constraints.
- Bật Draft & Publish cho nội dung public.
- Tạo tài liệu `docs/cms-content-model.md` từ schema thực tế.

#### Gate hoàn tất

- Tất cả model xuất hiện đúng trong Strapi Admin.
- CRUD thủ công hoạt động cho mỗi model.
- Relation không tạo record mồ côi trong happy path.
- Không có generic page builder.
- Schema files nằm trong Git và có thể review.

### Phase 3 — Internationalization và editorial workflow

#### Công việc

- Bật Internationalization.
- Thiết lập `vi` mặc định và `en` thứ hai.
- Cấu hình localization đúng cho từng content type/field.
- Kiểm thử create, update, draft, publish và unpublish độc lập giữa hai locale.
- Kiểm thử media dùng chung nhưng alt/caption khác theo locale.
- Viết checklist thao tác cho editor trước khi bàn giao sang Phase 4.

#### Gate hoàn tất

- Nội dung VI và EN không ghi đè nhau.
- Publish VI không tự publish EN.
- Query theo locale trả đúng dữ liệu.
- Slug và relation hoạt động theo policy đã định.
- Editor hoàn thành được luồng tạo VI → thêm EN → publish độc lập mà không cần developer.

### Phase 4 — Hardening, media, Admin roles

Chi tiết: [phase-04-hardening-media-roles.md](./phases/phase-04-hardening-media-roles.md).

Tóm tắt: Track **4A** API prefix `/api/v1`, CORS allowlist, bootstrap modules, Vitest; **4B** S3 mọi env + CDN CSP + delete guard; **4C** Admin role matrix. Public Content API vẫn deny cho đến Phase 6.

### Phase 5 — Seed nội dung prototype

Chi tiết: [phase-05-seed-content.md](./phases/phase-05-seed-content.md).

### Phase 6 — API contract và backend QA

Chi tiết: [phase-06-api-contract-and-qa.md](./phases/phase-06-api-contract-and-qa.md).

Tóm tắt: hoàn thiện contract, bootstrap Public `find`/`findOne` allowlist, smoke dương/âm, webhook ký số (optional).

### Phase 7 — Staging và handoff

Chi tiết: [phase-07-staging-and-handoff.md](./phases/phase-07-staging-and-handoff.md).

## 12. Definition of Done của CMS-first milestone

Milestone chỉ được xem là hoàn tất khi:

- Strapi backend chạy bằng PostgreSQL trên staging.
- Schema được version-control và có tài liệu.
- Admin CRUD hoạt động cho toàn bộ content model trong scope.
- `vi` và `en` hoạt động độc lập với Draft & Publish.
- Role và permission đã được kiểm thử bằng nhiều tài khoản.
- Media production không phụ thuộc filesystem tạm của container.
- Seed idempotent và có dữ liệu prototype tối thiểu.
- API contract có response mẫu cho hai locale.
- Build, typecheck và smoke tests pass.
- Backup/restore được chứng minh, không chỉ ghi trong checklist.
- Frontend hiện tại không bị sửa ngoài phạm vi.

## 13. Rủi ro cần chặn sớm

| Rủi ro | Hậu quả | Cách chặn |
| --- | --- | --- |
| Tạo generic page builder | Admin khó dùng, API khó ổn định | Fixed page schemas theo prototype |
| Localize mọi field | Dữ liệu giá/ngày/trạng thái bị nhân đôi và lệch | Chỉ localize content hiển thị |
| Dùng local uploads production | Mất ảnh sau deploy hoặc scale | Object storage |
| Public role mở quá rộng | Bị sửa/xoá data hoặc spam | Deny-by-default, test permissions |
| Dùng `populate=*` khắp nơi | Response lớn và contract không kiểm soát | Explicit populate |
| Seed không idempotent | Duplicate content, phá staging | Stable seed key và verify script |
| Sửa schema trực tiếp production | Drift giữa code và database | Schema changes qua code/PR |
| Nhét reservation vào CMS phase | Scope phình và logic nửa vời | Phase riêng cho form/booking |
| Coi EN là bản sao bắt buộc | Publish bản dịch rác | EN draft cho đến khi được duyệt |

## 14. Phase sau khi CMS ổn định

Thứ tự đề xuất, không nằm trong milestone hiện tại:

1. FE-1: tích hợp global settings, menu, campaigns, gallery và localized pages.
2. FE-2: routing/SEO cho VI và EN, cache/revalidation và fallback UX.
3. Backend Forms: `reservation-request` và `contact-message` cùng custom write endpoints.
4. Backend Automation: CAPTCHA, rate limit, email/Zalo/SMS và audit workflow.
5. Booking Engine: chỉ khi có yêu cầu thật — availability, table assignment, deposit và payment.

Không gọi `reservation-request` là booking engine. Nó chỉ là lead cho đến khi có availability và transaction rules thực sự.
