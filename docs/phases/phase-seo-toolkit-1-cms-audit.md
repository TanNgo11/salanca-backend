# Phase SEO-1 (v0.1) — Audit dữ liệu SEO trong CMS

Trạng thái: spec chờ duyệt (2026-10-16). Roadmap: [`plans/seo-toolkit-roadmap.html`](../plans/seo-toolkit-roadmap.html).
Kế hoạch thực hiện: [`plans/seo-toolkit-v0.1-cms-audit.md`](../plans/seo-toolkit-v0.1-cms-audit.md).
Nghiên cứu: [`plans/seo-admin-page-research.md`](../plans/seo-admin-page-research.md). Nhánh: `feat/seo-toolkit` (worktree `salanca-seo`).

## Goal

Dev chạy một lệnh (hoặc gọi một API admin) và nhận danh sách lỗi SEO nhìn thấy được trong dữ liệu CMS, theo từng
entry và từng ngôn ngữ, trước khi go-live. Đây là release đầu của plugin local `seo-toolkit`, và plugin phải
tổng quát ngay từ release này (luật G1 đến G8 trong roadmap): sau này gắn vào nhiều backend Strapi khác mà không sửa mã plugin.

Nguồn quyết định: chủ dự án ngày 16/10 chốt plugin local, tổng quát trước; giao D1 (duyệt plugin local) và D5 (cách phân phối)
cho mình xử lý; làm trong worktree riêng để không ảnh hưởng phần khác.

## Điều kiện bắt đầu

- Không phụ thuộc phase nào của ordering. Nhánh dựng từ `feat/ordering` chỉ để dùng chung khung build và `config/plugins.ts`;
  plugin không import mã của ordering.
- Spec và kế hoạch này được chủ dự án duyệt trước khi viết code.

## Scope

### 1. Plugin local `src/plugins/seo-toolkit`

- Namespace `plugin::seo-toolkit.*`. Không import `src/domain`, `src/api` hay mã ordering. Không ghi cứng UID của Salanca.
- Chỉ có server. Chưa có màn admin (v0.2). Không content type, không migration: v0.1 không lưu gì.
- Bật bằng `SEO_TOOLKIT_ENABLED=true` (mặc định tắt), cùng kiểu `ORDERING_ENABLED`. Tắt thì plugin không nạp, phần còn lại của app không đổi.
- `package.json` có `exports` cho `strapi-server`, `peerDependencies` theo phiên bản Strapi, README có bảng cấu hình (G7).

### 2. Cấu hình (do app chủ khai báo, G2)

Khóa `plugin::seo-toolkit`. Map theo mã, không dùng mảng (Strapi gộp mảng theo chỉ số khi merge cấu hình mặc định, như ghi chú
trong validator của ordering).

```ts
'seo-toolkit': {
  enabled,
  resolve: './src/plugins/seo-toolkit',
  config: {
    contentTypes: {
      'api::home-page.home-page': {},                          // seoField mặc định 'seo'
      'api::campaign.campaign': { seoField: 'seo', labelField: 'slug' },
    },
    fields: { title: 'metaTitle', description: 'metaDescription', image: 'shareImage', noIndex: 'noIndex' }, // mặc định
    status: 'published',                                       // 'published' | 'draft'
    limits: { title: 60, description: 160 },
    severities: { 'seo.noindex-set': 'notice' },               // tùy chọn: error | warn | notice | off
  },
}
```

- `contentTypes`: rỗng mặc định. Mỗi khóa là UID. `seoField` là tên field component SEO của content type đó (mặc định `seo`),
  hoặc **mảng** tên field khi một content type có nhiều khối SEO (mỗi khối thành một đơn vị kiểm riêng, ví dụ `menu-page` có `seo` và `cateringSeo`).
  `labelField` là field chuỗi dùng làm nhãn trong báo cáo (tùy chọn).
- `fields`: tên field bên trong component SEO. Mặc định `metaTitle`, `metaDescription`, `shareImage`, `noIndex` (tên của component `shared.seo`).
  `image` và `noIndex` đặt `null` được: nghĩa là web đó không có field ấy, các quy tắc `media.*` hoặc `seo.noindex-set` bị bỏ qua. `title` và `description` bắt buộc có.
- `status`: kiểm bản đã xuất bản (mặc định) hay bản nháp. Mặc định `published` vì trang nháp không lên Google.
- `limits`: ngưỡng ký tự là cấu hình có mặc định, không phải luật của Google (Google cắt theo độ rộng hiển thị, không theo số ký tự).
  Web khác có thể không có `maxLength` như Salanca.
- Validator (hình dạng cấu hình) chạy khi Strapi nạp cấu hình: `limits` là số nguyên dương, `severities` chỉ chứa mã có thật, `contentTypes` là object (không phải mảng).
- Kiểm theo schema (UID là content type có thật, `seoField` là field component, component có đủ các field trong `fields`) chạy ở `bootstrap` và **không làm sập CMS**:
  sai thì ghi `strapi.log.error` và đánh dấu cấu hình không hợp lệ; service `run` ném lỗi 400 nêu từng vấn đề, lệnh thoát mã 2. Lý do: công cụ chỉ-đọc không được phép chặn khởi động site.
- Chưa có khóa `path` hay cách dựng URL. Chỉ thêm khi một release cần tới (từ v0.3), để khỏi đóng khung trừu tượng quá sớm.

### 3. Quy tắc audit v0.1

Chỉ những gì nhìn thấy được trong dữ liệu CMS. Mức mặc định là phán đoán của mình, đổi được qua `severities`.

| Mã | Mức | Điều kiện |
| --- | --- | --- |
| `seo.block-missing` | error | Entry không có dữ liệu ở field component SEO (null). |
| `seo.title-missing` | error | Có khối SEO nhưng title rỗng sau khi cắt khoảng trắng. |
| `seo.description-missing` | error | Tương tự cho description. |
| `seo.title-too-long` | warn | Số ký tự (đếm code point, sau khi cắt khoảng trắng) lớn hơn `limits.title`. |
| `seo.description-too-long` | warn | Tương tự với `limits.description`. |
| `seo.title-duplicate` | warn | Cùng title (cắt khoảng trắng, gộp khoảng trắng liên tiếp, không phân biệt hoa thường) ở hơn một entry cùng ngôn ngữ, tính chung mọi content type đã khai báo. Bỏ qua entry đang noIndex. |
| `seo.description-duplicate` | warn | Tương tự cho description. |
| `i18n.translation-missing` | warn | Content type bật i18n; document có bản ở một ngôn ngữ (theo `status` đang kiểm) nhưng thiếu ở ngôn ngữ cấu hình khác. Báo ở ngôn ngữ bị thiếu. |
| `media.share-image-missing` | notice | Khối SEO có nhưng chưa có ảnh chia sẻ. |
| `media.share-image-alt-missing` | notice | Có ảnh chia sẻ nhưng `alternativeText` rỗng. |
| `seo.noindex-set` | warn | Entry đang noIndex. Chưa chắc là lỗi (có trang cố ý), nên chỉ cảnh báo để người duyệt xác nhận. |

Cố ý không có ở v0.1 (chuyển sang v0.3): canonical sai, noindex nằm trong sitemap, robots chặn. Lý do: với Salanca, canonical do route
registry của frontend quyết (`seo-cms-integration.md`: "canonical vẫn từ route registry") và sitemap do `sitemap.ts` dựng từ
`routeRegistry` cộng `noIndex`. Dữ liệu CMS không cho biết hai thứ đó nên báo ở v0.1 sẽ là nói điều mình không biết.

Ảnh chỉ kiểm ảnh chia sẻ trong khối SEO. Ảnh trong nội dung trang nằm ngoài phạm vi vì phải duyệt schema bất kỳ.

### 3b. Định nghĩa chính xác (để code không phải đoán)

- **Đơn vị kiểm** là bộ ba (document, ngôn ngữ, khối SEO). Một content type có nhiều khối SEO (mục 2) thì mỗi khối là một đơn vị riêng.
  Content type bật i18n (theo `strapi.plugin('i18n').service('content-types').isLocalizedContentType`) có một đơn vị cho mỗi ngôn ngữ có bản ghi.
  Content type không i18n có đúng một đơn vị với `locale: null`, bất kể giá trị cột `locale` trong DB.
- **Có khối SEO:** giá trị field `seoField` là object khác null. `null` hoặc thiếu là `seo.block-missing`, và khi đó **không** chạy các quy tắc `title`, `description`, `media`, `noindex` cho đơn vị đó (tránh một lỗi gốc sinh bốn lỗi).
- **Chuỗi rỗng:** không phải chuỗi, hoặc chuỗi chỉ có khoảng trắng sau `trim`, là thiếu. Độ dài đếm theo code point của chuỗi đã `trim` (`Array.from(text).length`), không đếm byte.
- **Ảnh chia sẻ:** `undefined` nghĩa là web không có field ảnh (bỏ qua quy tắc media); `null` nghĩa là field có nhưng chưa chọn ảnh (`share-image-missing`); object là có ảnh, rồi xét `alternativeText` (rỗng sau `trim` là `share-image-alt-missing`).
- **noIndex:** `undefined` nghĩa là web không có field này (bỏ qua); `true` là `seo.noindex-set`; `false` hoặc `null` là bình thường.
- **Trùng title và description:** khóa so sánh là `locale ?? ''` cộng giá trị đã chuẩn hóa. Mỗi thành viên của nhóm trùng nhận một lỗi, `params.count` là số entry **khác** trong nhóm, `params.others` tối đa 5 phần tử `{uid, documentId, locale, seoField}` đã sắp xếp. Entry noIndex và entry thiếu giá trị không tham gia so sánh. Có `seoField` để hai khối SEO của cùng một document không bị nhầm thành tự trùng.
- **Thiếu bản dịch:** chỉ cho content type i18n. Với mỗi document, tập ngôn ngữ đang có (theo `status` đang kiểm); mỗi ngôn ngữ cấu hình mà không có trong tập đó, **khi tập khác rỗng**, sinh một lỗi ở ngôn ngữ thiếu, `params.sourceLocales` là tập đang có. Chỉ xét các ngôn ngữ trong phạm vi `locales` của lần chạy.
  Giới hạn đã biết (sửa ở v0.2, khi mở cờ `--locales`): collector lọc các hàng ngoài phạm vi `locales` trước khi vào engine, nên khi chạy có lọc, một document chỉ có bản ở ngôn ngữ ngoài phạm vi sẽ biến mất và `translation-missing` cho ngôn ngữ trong phạm vi có thể bị sót. Hiện chưa có đường chạy nào lọc `locales` (CLI không có cờ này), nên chưa ảnh hưởng thực tế.
- **`status: 'draft'`:** kiểm bản nháp. Có giá trị vì Strapi chỉ ép `required` khi xuất bản, không ép với bản nháp (đã đọc `entity-validator` của `@strapi/core` 5.51.1: `required: !options.isDraft && attr.required`).
  Với `published`, thiếu title hoặc description chỉ xảy ra với dữ liệu nhập qua seed hoặc import, hoặc khi schema đổi sau khi đã xuất bản.
- **`severities`:** `off` ẩn hẳn mã đó khỏi `issues` và `summary`.

### 4. Hợp đồng báo cáo

Một hàm thuần `runAudit(input)` (G4) nhận danh sách entry đã chuẩn hóa và cấu hình, trả báo cáo. Collector đọc Strapi và chuẩn hóa dữ liệu là
phần riêng, mỏng, ở server.

```json
{
  "generatedAt": "2026-10-16T08:00:00.000Z",
  "scope": { "status": "published", "locales": ["vi", "en"], "contentTypes": ["api::home-page.home-page"] },
  "summary": { "entries": 42, "error": 1, "warn": 3, "notice": 0 },
  "issues": [
    { "code": "seo.title-missing", "severity": "error", "uid": "api::home-page.home-page",
      "documentId": "abc123", "locale": "vi", "label": null, "seoField": "seo", "field": "metaTitle", "params": {} }
  ]
}
```

- Mỗi lỗi định danh bằng `uid + documentId + locale + seoField` (vì một document có thể có nhiều khối SEO); đây cũng là thứ "Sửa" ở v0.2 cần để mở đúng entry.
- `params` mang số liệu cho thông điệp (ví dụ `length`, `limit`, `count`, `others` tối đa 5 bản ghi trùng). Báo cáo chỉ có mã và tham số, không có câu chữ (G5).
- Sắp xếp xác định: mức (error trước), `uid`, `documentId`, `locale`, `code`, `seoField`, `field`. Hai lần chạy trên cùng dữ liệu cho cùng kết quả, để so sánh được.
- Không có điểm số tổng. Điểm sức khỏe là quyết định của v0.2 và chưa đóng khung ở đây.
- `entries` đếm đơn vị (document, ngôn ngữ, khối SEO) đã kiểm.

### 5. Hai cách chạy, cùng một service

- **Service**: `strapi.plugin('seo-toolkit').service('audit').run({ status?, contentTypes?, locales? })`.
- **API admin**: `POST /seo-toolkit/audit/run`, chỉ quản trị viên có action `plugin::seo-toolkit.audit.run`. Dùng POST vì là thao tác tốn tài nguyên,
  không để cache. Chỉ đọc, không ghi gì. Tên hiển thị của action bằng tiếng Anh (G5); bản dịch vào màn admin ở v0.2.
- **Lệnh**: `pnpm run seo:audit -- [--json] [--out=<file>] [--fail-on=error|warn|notice|never] [--status=published|draft] [--lang=vi|en]`.
  Chạy trong cùng process Strapi (`loadStrapiApp`), không cần token. Mặc định `--fail-on=error`, `--lang=en`.
  `--status` để trống thì dùng `status` trong cấu hình (CLI không ép), tránh ghi đè lựa chọn của web.
  Mã thoát: 0 sạch, 1 còn lỗi đạt ngưỡng `--fail-on`, 2 không chạy được (plugin tắt, cấu hình sai, không đọc được DB).
  `--json` in đúng báo cáo ở mục 4; không `--json` in bảng gọn đã dịch theo `--lang`.
  `--out=<file>` ghi báo cáo dạng JSON ra file: log khởi động/tắt của Strapi đi ra stdout nên stdout không pipe sạch được, file là bản sạch để `jq` hoặc so sánh giữa hai lần chạy. Dấu `--` đứng đầu (do `pnpm run ... -- ...`) được bỏ trước khi phân tích tham số.
  Phần định dạng bảng và tính mã thoát nằm trong `shared/cli.ts` (hàm thuần, có test); `scripts/seo-toolkit/audit.mjs` chỉ đọc tham số, gọi service và dùng hai hàm đó.
- Danh mục thông điệp `vi` và `en` nằm trong `shared/messages.ts`, khóa theo mã lỗi (G5), v0.2 dùng lại.

### 6. Cấu hình Salanca (client đầu tiên)

Khối `seo-toolkit` trong `config/plugins.ts` của Salanca khai báo 12 content type mang `shared.seo` và là trang thật:
`home-page`, `menu-page`, `story-page`, `space-page`, `experience-page`, `campaign-page`, `booking-page`, `contact-page`,
`campaign`, `menu-category`, `menu-package`, `location`.

`menu-page` có hai khối SEO (`seo` và `cateringSeo`) nên `seoField` là mảng; bốn collection dùng `slug` làm `labelField`.
`global-setting` bị loại: khối SEO của nó (`defaultSeo`) là bản dự phòng dùng khi trang không có SEO riêng, trùng nội dung
với trang chủ là đúng thiết kế, nên audit chỉ sinh cảnh báo trùng không thật (quyết định của chủ dự án, 2026-10-16). Nếu v0.2
mở cờ loại trừ trùng theo UID thì có thể đưa lại.

- Tám single type đầu khớp tám route trong `routeRegistry` của `salanca-web`. `campaign` có trang chi tiết `campaigns/[slug]`;
  `menu-category` và `location` có route (`menu/category/[slug]`, `locations`). `menu-package` giữ lại: web có trang `/menu/[section]` và cảnh báo trùng mô tả rodizio/buffet là thật.
- Không đổi schema và seed của Salanca.
- Lệnh của Salanca: `seo:audit` chạy với `--lang=vi`.

## Non-goals

- Canonical, sitemap, robots, kiểm trang đã render (v0.3).
- Màn admin, bỏ qua lỗi có lý do, lưu kết quả, lịch sử, so sánh lần trước (v0.2, v0.11).
- Điểm sức khỏe tổng, cách dựng URL trang, mẫu title mặc định.
- Sửa dữ liệu hộ người dùng. Audit chỉ đọc.
- Gói Next.js, `robots.ts` của Salanca (v0.4).
- Kiểm ảnh trong nội dung trang, hreflang, độ dễ đọc, mật độ từ khóa.
- Đổi schema, seed hay content type của Salanca.

## Acceptance

### Automated

- `pnpm run build:seo-toolkit` tạo `src/plugins/seo-toolkit/dist/server/src/index.js`.
- `pnpm run typecheck` và `pnpm run typecheck:seo-toolkit` (tsconfig riêng, vì tsconfig gốc loại `src/plugins/**`) đều qua.
- `pnpm run lint` qua cho các file mới.
- Test đơn vị của engine, chạy trong `pnpm test`:
  - mỗi mã ở mục 3 có ít nhất một ca dương và một ca âm;
  - engine chạy với một cấu hình và dữ liệu giả không liên quan Salanca (G1, G4);
  - `title-duplicate` bỏ qua entry noIndex và chỉ so trong cùng ngôn ngữ;
  - `translation-missing` đúng với `status` published và draft;
  - thứ tự đầu ra xác định;
  - `severities: off` ẩn mã đó, và đổi mức được phản ánh trong `summary`.
- Test cấu hình: mặc định hợp lệ; UID không tồn tại bị từ chối với đường dẫn khóa; `SEO_TOOLKIT_ENABLED=true` mà thiếu `dist` thì ném lỗi rõ
  (không để Strapi âm thầm bỏ qua); mặc định tắt giữ nguyên cấu hình plugin hiện có.
- `pnpm run check:seo-toolkit` (build + test của plugin) qua.

### Manual (chủ dự án hoặc dev)

- Chạy `pnpm run seo:audit -- --lang=vi` trên DB local có nội dung Salanca. Mở từng lỗi `error` trong Admin xác nhận là thật.
  Ghi lại lỗi nào là dương tính giả, và loại nội dung nào không phải trang thật để loại khỏi khối cấu hình Salanca.
- Kiểm mã thoát: `0` khi sạch hoặc `--fail-on=never`, `1` khi còn lỗi `error`, `2` khi `SEO_TOOLKIT_ENABLED` tắt.
- Với `SEO_TOOLKIT_ENABLED` tắt (mặc định), khởi động Strapi và thấy menu, API, cron hiện có không đổi.

### Evidence cần ghi

- Tóm tắt báo cáo thật trên DB local (số entry, số lỗi mỗi mức) và danh sách dương tính giả. Ghi vào ghi chú xác minh của phase, không vào `docs/STATUS.md`
  ở nhánh này khi spec chưa duyệt.

## Quyết định và giả định

- **Đã chốt:** D1 plugin local (16/10). D5 plugin local trước, gói Next.js quyết ở v0.4 (16/10).
- **Dòng ngoại lệ `AGENTS.md`:** chỉ về màn admin custom, nên thêm ở v0.2. v0.1 không có màn admin.
- **Đã đọc mã nguồn `@strapi/core` 5.51.1 (chưa chạy thật):**
  - `documents(uid).findMany` hỗ trợ `status: 'published' | 'draft'` và `locale: '*'` cho content type i18n (lấy mọi ngôn ngữ trong một truy vấn). Content type không i18n bỏ qua `locale`.
  - Lớp Document Service không đặt `limit` mặc định (`findMany` chuyển thẳng tham số cho `strapi.db.query`). Dù vậy collector vẫn phân trang tường minh bằng `start`/`limit` để không phụ thuộc điều đó.
  - `required` chỉ bị ép khi không phải bản nháp (xem mục 3b). Vì vậy `seo.block-missing`, `title-missing`, `description-missing` ở `published` là lớp phòng thủ, còn ở `draft` là kết quả thường gặp.
- **Còn phải kiểm khi chạy thật (kế hoạch có bước riêng):**
  - Single type đọc bằng `findMany` trả đúng một bản ghi mỗi ngôn ngữ (nếu không, dùng `findFirst` theo từng ngôn ngữ).
  - Populate `{ [seoField]: { populate: { [fields.image]: true } } }` trả `alternativeText` của file ảnh.
  - Cột `locale` của content type không i18n: collector bỏ qua giá trị đó và đặt `null`, nên không cần kiểm.
- **Đã thấy trong schema:** `seo` của `home-page` là component không lặp (`repeatable: false`), `required: true`, i18n localized.

## Rủi ro

- Mới một client nên dễ trừu tượng hóa sai. Giảm bằng cấu hình tối thiểu hai khóa và engine thuần có test cấu hình giả.
- `package.json` là file dùng chung, dễ xung đột khi gộp (thêm `build:seo-toolkit` vào `build`, `dev`, `develop`). Sửa đúng ba dòng, không đổi gì khác.
- Dương tính giả làm mất lòng tin vào audit. Giảm bằng việc chỉ kiểm những gì CMS thấy, đặt `noindex-set` ở `warn`, và bước dry-run trước khi báo ai.
