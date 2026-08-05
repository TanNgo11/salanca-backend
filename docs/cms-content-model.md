# Salanca CMS content model

Tài liệu này mô tả schema đang chạy trong `src/components` và `src/api`. Đây không phải wishlist. Marketing content (Phase 2–3) quản lý copy/public pages. Lead forms: `contact-message` (Forms MVP) và `reservation-request` (Forms-2, create public). Booking engine (tồn bàn, hard slot, thanh toán) vẫn deferred.

## Quy ước chung

- Tất cả 15 content type bật Draft & Publish. `published`, `isActive` và `isFeatured` là ba trạng thái độc lập.
- Giá dùng `decimal`, giá trị tối thiểu `0`, không lưu ký hiệu hoặc chuỗi đã format.
- `displayOrder` là số nguyên không âm. Frontend phải thêm secondary sort ổn định khi nhiều record cùng thứ tự.
- Media mang nội dung dùng `shared.image` để bắt buộc alt text. Ảnh chia sẻ SEO là media trực tiếp và có mục đích riêng.
- URL nội bộ và ngoài hệ thống cùng dùng `shared.link`; validation URL nâng cao được hoãn cho phase API hardening.
- Localization bật cho toàn bộ 15 content type. `vi` là mặc định, `en` là locale thứ hai. Copy, slug, SEO text, CTA và alt/caption được localized; giá, enum, timestamp, boolean, display order, hotline, email và map URL không localized.
- Relation của Strapi i18n được resolve theo locale. Test menu xác nhận item EN populate category EN thay vì trộn copy VI.
- Giới hạn Strapi 5.50.2: khi một component phải localized để chứa copy/alt riêng, field kỹ thuật nằm bên trong component đó vẫn được lưu theo từng locale. Ví dụ `shared.seo.noIndex` và media reference trong `shared.image` không tự đồng bộ vật lý. Editor/seed phải chọn cùng asset và giữ cùng giá trị kỹ thuật ở VI/EN; `npm run smoke:i18n` kiểm tra policy này với SEO component.

## Shared components

| Component | Mục đích | Trường chính |
| --- | --- | --- |
| `shared.seo` | Metadata từng trang/record | `metaTitle`, `metaDescription`, `shareImage`, `canonicalPath`, `noIndex` |
| `shared.link` | Link có nhãn | `label`, `url`, `openInNewTab` |
| `shared.image` | Ảnh có accessibility + focal crop | `media`, `alt`, `caption`, `focalPointX` (0–100, default 50), `focalPointY` (0–100, default 50) |
| `shared.hero` | Hero cố định của page | eyebrow, title, description, hai ảnh, primary link |
| `shared.cta` | Khối kêu gọi hành động | `heading`, `body`, `link` |
| `shared.operating-period` | Khung giờ hoạt động | `label`, `opensAt`, `closesAt` |
| `shared.step` | Bước quy trình | `number`, `title`, `body`, `image` |
| `shared.timeline-entry` | Mốc câu chuyện | `label`, `title`, `body`, `image` |
| `shared.option` | Lựa chọn form tĩnh | `label`, `value`, `displayOrder` |
| `shared.list-item` | Mục văn bản ngắn | `title`, `description` |
| `shared.social-link` | Kênh mạng xã hội | `platform`, `label`, `url` |
| `shared.editorial-card` | Card nội dung dùng lại | eyebrow, title, body, image, link |

## Single types

| API ID | Vai trò |
| --- | --- |
| `global-setting` | Thương hiệu, logo, liên hệ, giờ mở cửa, social, navigation, địa điểm chính và SEO mặc định |
| `home-page` | Hero, trải nghiệm, menu/package nổi bật, câu chuyện, không gian và CTA trang chủ |
| `menu-page` | Copy/hero/section heading/CTA của trang menu; record món nằm ở collection riêng |
| `campaign-page` | Copy/hero/section heading/CTA của trang ưu đãi & sự kiện; campaign nằm ở collection riêng |
| `story-page` | Nguồn gốc, timeline, triết lý, nguyên liệu, kỹ nghệ, giá trị và CTA |
| `experience-page` | Giới thiệu, quy trình, nghi thức, hương vị, manifesto, bàn ăn và CTA |
| `space-page` | Giới thiệu, gallery, sự kiện, trải nghiệm, tiện ích và CTA |
| `contact-page` | Nội dung thăm nhà hàng, bản đồ, topic form tĩnh, trợ giúp, social và CTA |
| `booking-page` | Nội dung form đặt bàn, option giờ/khách/dịp, các bước, lưu ý và hỗ trợ; submission nằm ở `reservation-request` |

`menu-page` và `campaign-page` là schema riêng vì prototype có hero, heading và CTA riêng. Bỏ hai model này sẽ buộc frontend hardcode nội dung public, trái mục tiêu CMS.

## Collection types

### `location`

Địa điểm nhà hàng: tên/slug, địa chỉ, map, phone/email, giờ hoạt động, ảnh, gallery, trạng thái, thứ tự và SEO. Quan hệ một-nhiều với `gallery-item` qua `galleryItems` ↔ `location`.

### Menu

- `menu-category`: tên/slug, mô tả, ảnh, items, trạng thái và thứ tự.
- `menu-item`: tên/slug, mô tả, giá decimal, ảnh, category bắt buộc, featured/active/order.
- `menu-package`: tên/slug, rich description, giá người lớn/trẻ em, danh sách nội dung gồm trong gói, ảnh, trạng thái, thứ tự và SEO.

Quan hệ category/item là `menu-category.items` one-to-many mapped by `menu-item.category`; item không hợp lệ nếu thiếu category. Document-service middleware chặn tạo item thiếu category, gỡ category khỏi item và xóa category đang được tham chiếu. Editor phải reassign hoặc xóa item có chủ đích trước khi xóa category; rule này áp dụng chung cho Admin và REST.

### `campaign`

Ưu đãi/sự kiện/private event với `kind`, title/slug, summary/body, media, thời gian, điều khoản, CTA, featured/order và SEO. `kind` chỉ nhận `promotion`, `event`, `private_event`. Rule liên trường `endsAt >= startsAt` được enforce bởi Document Service middleware (`src/domain/document-invariants/`), không chỉ schema.

### `gallery-item`

Ảnh có title/description/alt, vùng (`main_hall`, `bar`, `private_room`, `night`, `food`, `experience`), location tùy chọn, trạng thái và thứ tự.

## Source từ prototype

| Khu vực prototype | Owner trong CMS |
| --- | --- |
| Header, footer, brand, contact dùng chung | `global-setting` |
| Trang chủ | `home-page` + relation tới menu/package |
| Trang thực đơn | `menu-page`, `menu-category`, `menu-item`, `menu-package` |
| Ưu đãi & sự kiện | `campaign-page`, `campaign` |
| Câu chuyện | `story-page` |
| Trải nghiệm | `experience-page` |
| Không gian | `space-page`, `gallery-item`, `location` |
| Liên hệ (copy trang) | `contact-page`, `location` |
| Liên hệ (lead form) | `contact-message` (POST public; xem bên dưới) |
| Đặt bàn (copy trang) | `booking-page` |
| Đặt bàn (lead form) | `reservation-request` (POST public; xem bên dưới) |

CSS class, breakpoint, animation, grid và decoration không phải content nên không được đưa vào schema.

## Lead / form intake

### `contact-message`

Collection lead nhận form liên hệ từ website. **Không** i18n plugin, **không** Draft & Publish.

| Field | Ghi chú |
| --- | --- |
| `fullName` | Bắt buộc, max 120 |
| `email` / `phone` | Ít nhất một (enforce controller/validation) |
| `topic` | String tự do; FE map từ `contact-page.formTopics` |
| `message` | Bắt buộc, max 4000 |
| `sourceLocale` | `vi` \| `en` (ngôn ngữ trang gửi form; **không** phải i18n plugin) |
| `status` | `new` \| `read` \| `archived`; public create luôn `new` |
| `sourcePath` | Optional, ví dụ `/vi/lien-he` |

Honeypot `website` chỉ có trên request body, **không** có cột schema. Public chỉ `create`; không `find`/`findOne`/`update`/`delete`.

### `reservation-request`

Collection lead nhận form đặt bàn từ website. **Không** i18n plugin, **không** Draft & Publish. **Không** phải booking engine.

| Field | Ghi chú |
| --- | --- |
| `fullName` | Bắt buộc, max 120 |
| `phone` | Bắt buộc, max 40 (nhà hàng gọi xác nhận) |
| `email` | Optional |
| `preferredDate` | Date bắt buộc; validation reject ngày trước “hôm nay” `Asia/Ho_Chi_Minh` |
| `preferredTime` | String bắt buộc (value từ `booking-page.arrivalTimes`) |
| `guestCount` | Integer 1–100 |
| `occasion` / `note` | Optional |
| `menuSelectionMode` | `later` (chọn món sau) \| `now` (chọn gói/món ngay) |
| `menuPackages` / `menuItems` | M2M tới `menu-package` / `menu-item`; chỉ khi `now`; tối đa 5 gói / 20 món |
| `sourceLocale` | `vi` \| `en` |
| `status` | `new` \| `read` \| `archived`; public create luôn `new` |
| `overlapCount` | Soft detect: số lead peers cùng date+time (status `new`\|`read`) lúc create; không reject. API derive `hasOverlap = overlapCount > 0` |

Honeypot `website` request-only. Public chỉ `create`. Rate limit in-process theo IP **sau** validate thành công (env `RESERVATION_RATE_LIMIT_*`). Shared form primitives: `src/domain/form-intake/`.

## Model cố ý hoãn

`availability-slot`, `table`, `payment`, generic `page` và unrestricted Dynamic Zone vẫn deferred. Hard capacity / booking engine là phase sau.

## Kiểm tra tự động

Chạy `npm run verify:schema`. Gate này kiểm tra 12 component, 15 localized content type, lead types `contact-message` + `reservation-request`, Draft & Publish / localization matrix cho marketing content, core CRUD layers, inverse relation chính, và model ngoài scope. Chạy `npm run smoke:i18n` cho locale; `npm run smoke:contact-form` và `npm run smoke:reservation-form` cho form intake.
