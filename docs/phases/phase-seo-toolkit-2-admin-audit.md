# Phase SEO-2 (v0.2) — Trang "Kiểm tra SEO" trong admin

Trạng thái: spec chờ duyệt (2026-10-17). Roadmap: [`plans/seo-toolkit-roadmap.html`](../plans/seo-toolkit-roadmap.html) (card v0.2).
Kế hoạch thực hiện: [`plans/seo-toolkit-v0.2-admin-audit.md`](../plans/seo-toolkit-v0.2-admin-audit.md). Prompt giao việc: [`plans/seo-toolkit-v0.2-handoff.md`](../plans/seo-toolkit-v0.2-handoff.md).
Nghiên cứu và mockup: [`plans/seo-admin-page-research.md`](../plans/seo-admin-page-research.md), [`plans/seo-admin-page-mockup.html`](../plans/seo-admin-page-mockup.html) (tab Audit).
Phase trước: [`phase-seo-toolkit-1-cms-audit.md`](phase-seo-toolkit-1-cms-audit.md) (đã xong, commit `506d891` và `b04c43e`). Nhánh: `feat/seo-toolkit` (worktree `salanca-seo`).

## Goal

Chủ quán (không cần terminal) mở một trang trong admin Strapi, thấy điểm sức khỏe SEO và danh sách lỗi
của chính dữ liệu CMS (cùng bộ quy tắc v0.1), xem theo loại lỗi hoặc theo trang, bấm **Sửa** để nhảy thẳng tới
đúng entry và đúng ngôn ngữ trong Content Manager, và **bỏ qua có chủ ý** (kèm lý do) những cảnh báo hay lưu ý mà
họ biết là không cần sửa.

Plugin vẫn tổng quát (G1 đến G8): trang không biết gì về Salanca; mọi nhãn loại nội dung, ngôn ngữ, đường dẫn Content Manager đều
suy ra từ cấu hình và schema của host.

## Điều kiện bắt đầu

- v0.1 đã đóng (code, smoke HTTP trên DB test, 94 test) và đã commit trên `feat/seo-toolkit`.
- Chủ dự án duyệt spec và kế hoạch này. Duyệt spec cũng là duyệt **thêm một dòng ngoại lệ vào `AGENTS.md`** cho màn admin custom
  (quyết định D1 trong roadmap, đã chốt 16/10 là "chỉ thêm khi bắt đầu v0.2"). Nội dung dòng đó nằm ở mục Scope 6.
- Không phụ thuộc ordering. Không cần `salanca-web`.

## Scope

### 1. Trang admin (`admin/src`, một mục menu "SEO")

- Mục menu chính **SEO** (`/plugins/seo-toolkit`), hiện cho vai trò có action `plugin::seo-toolkit.audit.run`. Không có mục Settings.
- Trang có đúng một màn **Kiểm tra** (tab Sitemap và Go-live của mockup thuộc v0.4 và sau; chưa vẽ tab nào khác, không có thanh tab giả).
- Bố cục (bám mockup, tab Audit), từ trên xuống:
  1. Đầu trang: tiêu đề "Kiểm tra SEO", ô chọn phạm vi **Bản đã xuất bản / Bản nháp** (mặc định theo `config.status` của host, lấy từ phản hồi lần chạy đầu), nút **Chạy lại**, dòng "Cập nhật lúc …" (giờ từ `generatedAt`).
  2. Thẻ tóm tắt: **Điểm sức khỏe SEO** (`percent`% và dòng "x/y trang sạch lỗi"; `percent` null thì hiện "—"), ba thẻ đếm **Lỗi / Cảnh báo / Lưu ý** (mô tả nhỏ: "Phải sửa trước go-live" / "Nên sửa" / "Không tính vào điểm"), và dòng "N vấn đề đã bỏ qua có chủ ý" khi N > 0.
  3. Thanh công cụ: nút gạt **Theo loại lỗi** (mặc định) / **Theo trang**; chip mức (**Tất cả / Lỗi / Cảnh báo / Lưu ý**, mỗi chip kèm số); hai ô chọn **Loại nội dung** và **Ngôn ngữ** (lọc phía trình duyệt trên kết quả đã tải, không gọi lại server).
  4. Danh sách (xem 2 và 3).
  5. Khu **Đã bỏ qua** (gập, mặc định đóng) khi có ít nhất một mục (xem 4).
- Trạng thái: đang tải (loader); lỗi tải (thông báo lấy từ server nếu có và nút **Thử lại**); HTTP 403 (thông báo "Tài khoản chưa có quyền xem mục này"); không có vấn đề nào ("Không có vấn đề nào ở bộ lọc này" khi đang lọc, "Dữ liệu SEO không có vấn đề" khi không lọc); cấu hình sai (HTTP 400 `invalid configuration`): hiện nguyên thông điệp server, không hiện danh sách.
- Trang **tự chạy một lần khi mở** (một request, xem mục 5) và mỗi lần bấm Chạy lại hay đổi phạm vi. Không lưu kết quả giữa các lần (lịch sử là v0.11).
- Không dùng thư viện UI ngoài `@strapi/design-system`, `@strapi/icons`, `@strapi/strapi/admin`, `react-router-dom`, `react-intl` (đã có trong host). Không thêm dependency.

### 2. Xem theo loại lỗi

- Mỗi nhóm = một mã quy tắc có ít nhất một vấn đề đang hiện (sau lọc). Hàng đầu nhóm: huy hiệu mức, **tiêu đề quy tắc** (từ `shared/guidance.ts`), số mục bị ảnh hưởng.
  Sắp xếp nhóm: mức nặng trước (error, warn, notice), rồi số mục giảm dần, rồi mã tăng dần.
- Mở một nhóm: hai khối **Vì sao quan trọng** và **Cách sửa** (văn bản tĩnh theo mã, vi/en), rồi bảng các mục: **Trang** (`label`, nếu null thì tên hiển thị của loại nội dung), **Loại nội dung**, **Ngôn ngữ**, **Khối SEO** (`seoField`, ẩn cột khi host chỉ có một khối trong mọi mục), **Chi tiết** (thông điệp có tham số, ví dụ "Tiêu đề SEO dài 72 ký tự, vượt mức 60"), và hành động **Sửa →**, **Bỏ qua…** (xem 3 và 4).

### 3. Xem theo trang

- Nhóm theo `(uid, documentId)`; nhãn = `label` đầu tiên khác null trong nhóm, nếu không có thì tên hiển thị của loại nội dung. Hàng đầu nhóm: huy hiệu mức nặng nhất, nhãn, tên loại nội dung, số vấn đề.
  Sắp xếp: mức nặng nhất trước, rồi số vấn đề giảm dần, rồi nhãn tăng dần.
- Mở một trang: bảng các vấn đề (mức, ngôn ngữ, khối SEO, thông điệp, cách sửa ngắn) và các nút **Sửa →** theo từng ngôn ngữ có trong nhóm (mỗi ngôn ngữ một nút), cộng **Bỏ qua…** từng dòng khi được phép.

### 4. Bỏ qua có chủ ý

- Nút **Bỏ qua…** chỉ hiện khi (a) người dùng có action `plugin::seo-toolkit.manage` và (b) vấn đề `dismissible` (mức **không phải Lỗi**, xem quyết định A3). Mở hộp thoại: nhắc mã và trang, ô **Lý do** bắt buộc (sau khi cắt khoảng trắng đầu cuối: 3 đến 500 ký tự), nút **Bỏ qua** và **Hủy**.
- Sau khi bỏ qua thành công: vấn đề rời danh sách đang hiện, vào khu **Đã bỏ qua**, không tính vào các thẻ đếm Lỗi/Cảnh báo/Lưu ý và không tính vào điểm. Thẻ tóm tắt cập nhật bằng cách tải lại dữ liệu.
- Khu **Đã bỏ qua**: mỗi dòng gồm mức, tiêu đề quy tắc, trang, ngôn ngữ, **lý do**, **người bỏ qua**, **thời điểm**, nút **Khôi phục** (cần `manage`). Khôi phục xóa bản ghi bỏ qua; vấn đề quay lại danh sách đang hiện.
- Định danh một vấn đề để bỏ qua: `code + uid + documentId + locale + seoField` (locale và seoField null thì coi là chuỗi rỗng). Bỏ qua gắn với **định danh**, không gắn với nội dung: nếu nội dung đổi nhưng cùng mã lỗi vẫn xảy ra ở cùng định danh, vẫn đang bỏ qua. Dòng đã bỏ qua mà vấn đề không còn xuất hiện (đã sửa, hoặc entry bị xóa) thì không hiển thị và không đếm, nhưng bản ghi vẫn nằm trong DB (xem Rủi ro).
- Bỏ qua **không** ảnh hưởng `POST /seo-toolkit/audit/run` và `pnpm run seo:audit`: hai đường đó trả danh sách thô như v0.1.

### 5. Server

- Giữ nguyên `POST /seo-toolkit/audit/run` (hợp đồng v0.1, thô, không bỏ qua, không điểm). Thêm:
  - `POST /seo-toolkit/audit/view` (action `plugin::seo-toolkit.audit.run`): body `{ status?: 'published' | 'draft' }`, trả `AuditView` (mục 7).
  - `POST /seo-toolkit/dismissals` (action `plugin::seo-toolkit.manage`): body `{ issue: { code, uid, documentId, locale, seoField }, reason }`; trả bản ghi bỏ qua. Lỗi 400 khi `reason` ngắn hơn 3 hay dài hơn 500 ký tự (sau khi cắt), `code` không thuộc 11 mã, `uid` không khai báo trong cấu hình, hay vấn đề đang ở mức Lỗi (theo `config.severities` hiện tại). Gọi lại với cùng định danh là idempotent: trả bản ghi sẵn có, không tạo thêm, không đổi lý do.
  - `DELETE /seo-toolkit/dismissals/:id` (action `plugin::seo-toolkit.manage`): 404 khi không có, 400 khi `:id` không phải số nguyên dương. Xóa mọi bản ghi có cùng `key` với bản ghi đó (khôi phục không để sót bản trùng).
- Action mới `plugin::seo-toolkit.manage` ("Manage SEO dismissals") đăng ký cạnh `audit.run`, để hiện trong màn sửa Role. Super Admin có sẵn mọi action; các vai trò khác phải được cấp.
- **Content type của plugin** (đầu tiên): `plugin::seo-toolkit.dismissal`, bảng `plugins_seo_toolkit_dismissal`, ẩn khỏi Content Manager và Content-Type Builder, không i18n, không Draft & Publish. Thuộc tính: `key` (string, bắt buộc, `unique`: chống trùng ở mức DB), `code`, `uid`, `documentId` (string, bắt buộc), `locale`, `seoField` (string, null được), `reason` (text, bắt buộc), `adminUserId` (integer, bắt buộc), `adminLabel` (string, bắt buộc: "Tên Họ" của người bỏ qua, hoặc `admin#<id>` nếu không có tên; **không lưu email**), `dismissedAt` (datetime, bắt buộc). Chỉ truy cập qua `strapi.db.query('plugin::seo-toolkit.dismissal')`; không SQL thô, không migration (G7). Bảng được Strapi tạo khi khởi động nếu plugin bật; plugin tắt thì không có gì đổi.
- Nhật ký: mỗi lần bỏ qua hoặc khôi phục ghi một dòng `strapi.log.info` có `key` và `adminUserId`, **không** ghi lý do (văn bản tự do). Nhật ký chỉ-thêm (`audit-event`) là việc của v0.4; v0.2 không có.

### 6. Tài liệu và quy tắc dự án phải cập nhật cùng thay đổi

- `AGENTS.md` (một bullet ngay sau bullet ngoại lệ của ordering, trong "Project contract"): `Exception (owner, 2026-10-16): the generic local plugin src/plugins/seo-toolkit (SEO data audit, phase by phase per docs/plans/seo-toolkit-roadmap.html) may ship custom Admin screens and its own hidden collections; it must not import Salanca app code or change Salanca content types.` Không sửa dòng nào khác của `AGENTS.md`.
- `docs/cms-editor-guide.md`: thêm mục ngắn "Kiểm tra SEO" (đây là quy trình nhìn thấy với biên tập viên): cách mở trang, đọc điểm, bấm Sửa, bỏ qua và khôi phục, cấp quyền `audit.run` và `manage` cho vai trò nào.
- README plugin (mục admin), `docs/cms-technical-decisions.md` (mục seo-toolkit: màn admin, bảng dismissal, ranh giới), `docs/README.md` (liên kết spec và kế hoạch), card v0.2 trong roadmap.
- Không sửa `docs/STATUS.md`, schema/seed Salanca.

### 7. Hợp đồng `AuditView` (mới; `AuditReport` của v0.1 không đổi)

```json
{
  "generatedAt": "2026-10-17T03:00:00.000Z",
  "scope": { "status": "published", "locales": ["en", "vi"], "contentTypes": ["api::home-page.home-page"] },
  "summary": { "entries": 45, "error": 6, "warn": 15, "notice": 39, "dismissed": 2 },
  "score": { "pages": 43, "cleanPages": 41, "percent": 95 },
  "issues": [
    { "key": "seo.block-missing|api::menu-category.menu-category|e3drp9z2|vi|seo", "dismissible": false,
      "code": "seo.block-missing", "severity": "error", "uid": "api::menu-category.menu-category",
      "documentId": "e3drp9z2", "locale": "vi", "label": "thit-nuong", "seoField": "seo", "field": "seo", "params": {} }
  ],
  "dismissed": [
    { "key": "...", "dismissal": { "id": 7, "reason": "Trang này chủ ý dùng title chung", "adminLabel": "Tên Họ", "dismissedAt": "2026-10-17T02:50:00.000Z" },
      "code": "seo.title-duplicate", "severity": "warn", "uid": "...", "documentId": "...", "locale": "vi", "label": null, "seoField": "seo", "field": "metaTitle", "params": { "count": 1, "others": [] } }
  ],
  "targets": [
    { "uid": "api::home-page.home-page", "kind": "singleType", "displayName": "Trang chủ", "localized": true, "seoFields": ["seo"] }
  ]
}
```

- `issues` là các vấn đề **đang hiện** (đã trừ mục bỏ qua hợp lệ), đã sắp xếp như báo cáo v0.1. `summary.error/warn/notice` đếm đúng `issues`; `summary.entries` như v0.1; `summary.dismissed` = độ dài `dismissed`.
- `key` = `code|uid|documentId|locale|seoField` (locale null và seoField null thành chuỗi rỗng). Một hàm duy nhất ở `shared/` tạo `key`, server và trình duyệt dùng chung.
- `dismissible` = `severity !== 'error'`. Một bản ghi bỏ qua chỉ có tác dụng nếu vấn đề tương ứng **hiện không** ở mức Lỗi; nếu cấu hình sau này nâng mức của quy tắc lên Lỗi thì bản ghi cũ bị bỏ qua (vấn đề trở lại danh sách đang hiện, `dismissible: false`).
- `targets`: mọi loại nội dung khai báo trong cấu hình (kể cả loại không có vấn đề), sắp theo `uid`; `kind` và `displayName` đọc từ schema (`info.displayName`), `localized` từ i18n, `seoFields` là mảng tên khối SEO đã chuẩn hóa từ cấu hình.
- `score` theo mục 8.

### 8. Cách tính điểm (theo mockup, công thức Ahrefs)

- Đơn vị **trang-ngôn-ngữ** = `(uid, documentId, locale)` (locale null với loại không i18n). `pages` = số trang-ngôn-ngữ khác nhau trong **entry đã kiểm** (nhiều khối SEO của cùng trang-ngôn-ngữ chỉ tính một).
- Trang-ngôn-ngữ **sạch** nếu không có vấn đề **đang hiện** mức `error` ở `(uid, documentId, locale)` đó. `cleanPages` = số trang sạch.
- `percent` = `floor(100 × cleanPages / pages)`; `null` khi `pages = 0`. Cảnh báo và lưu ý không ảnh hưởng điểm. `i18n.translation-missing` (báo ở ngôn ngữ chưa có entry) không có trang-ngôn-ngữ tương ứng nên không ảnh hưởng điểm; nó vẫn hiện như cảnh báo.
- Hiển thị luôn kèm "x/y trang sạch lỗi" vì site ít trang nên điểm dao động mạnh.

### 9. Liên kết **Sửa**

- Dựng ở `shared/links.ts`, hàm thuần: loại `collectionType` → `/content-manager/collection-types/<uid>/<documentId>`, `singleType` → `/content-manager/single-types/<uid>`; thêm `?plugins[i18n][locale]=<locale>` khi `locale` khác null. `documentId` và `locale` qua `encodeURIComponent`; `uid` giữ nguyên (`api::x.x`).
- Trong trang dùng `Link` của `react-router-dom` (đường dẫn tương đối admin, không gồm `/admin`). Mở trong cùng cửa sổ.
- Không mở được tới một khối cụ thể trong entry (Content Manager không có neo cho component); nút mở đúng entry và đúng ngôn ngữ.
- Vấn đề `i18n.translation-missing` có `locale` là ngôn ngữ **thiếu**: nút Sửa mở entry ở ngôn ngữ đó (Content Manager cho tạo bản dịch ngay trong màn đó).

## Non-goals

- Lịch sử chạy, so sánh "mới/đã sửa", sparkline, nhãn "Mới" (v0.11). Chạy lại riêng một quy tắc (v0.11+). Email hàng tuần (v0.12).
- Banner go-live trên mọi trang admin, công tắc index, checklist, nhật ký `audit-event` chỉ-thêm (v0.4).
- Nút "Mở trang ↗" (cần đường dẫn công khai, thuộc cấu hình `path` của v0.3).
- Canonical, sitemap, trang đã render (v0.3). Tab Sitemap (v0.6).
- Mức ưu tiên (priority) tách khỏi mức (chừa chỗ trong dữ liệu sau, không thêm trường ở v0.2).
- Lọc `locales` ở collector và sửa `i18n.translation-missing` khi lọc (CLI vẫn không có cờ `--locales`; lọc ngôn ngữ của trang là lọc phía trình duyệt).
- Tách log Strapi khỏi stdout của `--json` (v0.2 không đụng CLI).
- Bỏ qua trong CLI/`audit/run`: hai đường này vẫn thô.
- Sửa nội dung SEO tại chỗ (inline edit) và preview SERP (v0.5).
- Đổi schema, seed, nội dung Salanca. Thêm dependency.

## Acceptance

### Automated (hoặc có script)

- Hàm thuần có test: `issueKey`, `computeScore`, `buildView` (gộp bỏ qua, mức Lỗi không bỏ qua được, bản ghi mồ côi, đếm), `contentManagerPath`, `guidance` đủ 11 mã × vi/en, gom nhóm và lọc ở admin, bản dịch admin không thiếu khóa.
- Service/controller: tạo bỏ qua (kiểm tra đầu vào, idempotent, 404 khi xóa không có), `audit.view` (khớp `run` khi không có bỏ qua), route đủ 3 route mới đúng chính sách và action, `register` đăng ký cả `audit.run` và `manage`.
- Smoke HTTP trên DB test riêng (không chạm DB dev): xác thực 401/403/200 cho `view`, `POST /dismissals`, `DELETE /dismissals/:id`; vòng bỏ qua → thấy ở `dismissed` → khôi phục; lỗi mức Lỗi bị 400; `audit/run` vẫn thô.
- `typecheck`, `typecheck:seo-toolkit`, `typecheck:seo-toolkit-admin`, eslint phần mới, vitest, kiểm import admin không kéo mã server, `SEO_TOOLKIT_ENABLED=true` `strapi build` (gói admin biên dịch được).

### Manual (chủ dự án, không có UAT giao diện tự động)

- Bật `SEO_TOOLKIT_ENABLED=true`, mở admin bằng vai trò có `audit.run`: thấy mục SEO, trang tự chạy, điểm và ba thẻ đếm khớp `pnpm run seo:audit` (cùng `status`).
- Bấm **Sửa** ở một lỗi: mở đúng entry và đúng ngôn ngữ (thử một single type và một collection type).
- Vai trò chỉ có `audit.run` không thấy nút **Bỏ qua** và **Khôi phục**; vai trò có `manage` thấy. Lỗi mức Lỗi không có nút Bỏ qua.
- Bỏ qua một lưu ý kèm lý do, tải lại trang, nó vẫn ở khu Đã bỏ qua; Khôi phục thì quay lại.
- Plugin tắt (mặc định): không có mục SEO, không thêm route, không bảng mới.
- Bật plugin trên DB dev lần đầu sẽ **tạo một bảng rỗng** `plugins_seo_toolkit_dismissal` (Strapi đồng bộ schema khi khởi động; kể cả khi chỉ chạy `pnpm run seo:audit`). Đây là thay đổi DB duy nhất; chủ dự án chấp nhận khi duyệt spec và UAT trên DB dev.

### Evidence cần ghi (Completion record)

Lệnh gate và kết quả; kết quả `smoke:seo-toolkit` (số ca); `strapi build` đã bật plugin; ảnh chụp không bắt buộc (không UAT giao diện tự động).

## Quyết định và giả định

- **A1 (chốt):** "Bỏ qua" là trạng thái của trang admin và bảng của plugin, không phải thuộc tính của engine. Engine v0.1 giữ nguyên là hàm thuần; việc gộp bỏ qua là một hàm thuần riêng (`buildView`) ở `shared/`.
- **A2 (chốt):** Trang tự chạy khi mở và không lưu kết quả. Lý do: audit đọc 12 loại, 45 entry mất khoảng một giây trên máy dev; chưa cần job nền hay bảng lịch sử. Nếu site lớn làm chậm, lịch sử và chạy nền là v0.11, không phải v0.2.
- **A3 (quyết định mình nghiêng, chủ dự án có thể đổi):** vấn đề mức **Lỗi** không bỏ qua được. Lý do: v0.4 dùng "còn lỗi mức Lỗi" để khóa nút mở index, và mã thoát mặc định của CLI chỉ xét mức Lỗi; cho người không rành kỹ thuật bỏ qua lỗi mức Lỗi nghĩa là giấu điều chặn go-live. Muốn hạ một quy tắc thì đổi `severities` trong cấu hình host (có kiểm soát mã nguồn). Đổi quyết định này chỉ là bỏ điều kiện `severity !== 'error'` ở một hàm (`isDismissible`).
- **A4 (chốt theo mockup):** điểm = tỉ lệ trang-ngôn-ngữ không có lỗi mức Lỗi; lưu ý và cảnh báo không tính.
- **A5 (giả định, kiểm ở bước smoke):** `unique: true` trên `key` tạo ràng buộc duy nhất ở DB. Có thể sai: Strapi thường áp `unique` ở validator của Document Service, còn `strapi.db.query` bỏ qua nó. Service vì thế không dựa vào ràng buộc: kiểm tồn tại trước khi tạo (idempotent), bắt lỗi trùng nếu có rồi đọc lại, và `remove` xóa mọi dòng cùng `key`. Smoke ghi kết quả thật vào Completion record.
- **A6 (giả định, kiểm ở bước smoke):** `ctx.state.user` của route admin có `id`, `firstname`, `lastname`. Nếu thiếu tên thì dùng `admin#<id>`.
- **A7 (giả định, kiểm thủ công):** liên kết `/content-manager/...` ở trên đúng với Strapi 5.51.1. Mockup ghi "kiểm tra lại khi code"; kiểm bằng cách mở một liên kết thật trong admin dev.
- Không có câu hỏi nào cần chủ dự án trả lời để bắt đầu ngoài việc duyệt spec và dòng `AGENTS.md`.

## Rủi ro

- Quyền: người cấp quyền `manage` cho vai trò sai có thể ẩn cảnh báo. Giảm bằng A3 (không ẩn được Lỗi), có `adminLabel` và thời điểm, và Khôi phục.
- Bảng `plugins_seo_toolkit_dismissal` còn lại khi tắt plugin (Strapi có thể giữ hoặc không; điều này được kiểm ở bước 8 của kế hoạch và ghi vào README). Mất bản ghi chỉ làm các cảnh báo hiện lại, không mất dữ liệu nội dung.
- Bản ghi mồ côi (entry bị xóa) tích dần; chấp nhận ở v0.2 (rất ít). Dọn dẹp để sau nếu cần.
- Gói admin được dựng bởi `strapi build` của host; lỗi chỉ lộ khi build. Gate bắt buộc có một lần build bật plugin.
- Trang chạy audit đầy đủ mỗi lần mở: một yêu cầu đọc toàn bộ entry của các loại khai báo. Với host rất lớn nên chờ lịch sử/nền (v0.11); v0.2 chấp nhận.
- Mockup vẽ thêm "Chạy lại check này", "Mới", sparkline, "Mở trang": cố ý bỏ khỏi v0.2 (Non-goals), cần ghi để AI không thêm.
