# SEO toolkit v0.2: trang "Kiểm tra SEO" trong admin (kế hoạch thực hiện)

Status: Draft (chờ chủ dự án duyệt spec và kế hoạch này)
Owner: tan_ngo duyệt; AI khác thực hiện
Last updated: 2026-10-17
Related phase: [`phases/phase-seo-toolkit-2-admin-audit.md`](../phases/phase-seo-toolkit-2-admin-audit.md) (đọc trước, đặc biệt mục 7 hợp đồng `AuditView`, mục 8 cách tính điểm, mục 9 liên kết Sửa)
Roadmap: [`seo-toolkit-roadmap.html`](seo-toolkit-roadmap.html). Mockup: [`seo-admin-page-mockup.html`](seo-admin-page-mockup.html). Prompt giao việc: [`seo-toolkit-v0.2-handoff.md`](seo-toolkit-v0.2-handoff.md).
Phase trước (đã xong): [`seo-toolkit-v0.1-cms-audit.md`](seo-toolkit-v0.1-cms-audit.md).

Nhánh `feat/seo-toolkit`, worktree `D:\outsource\salanca\salanca-seo`. Gộp về `feat/ordering` khi gate xong, **không** vào `main`.

## Ghi chú cho AI thực hiện (đọc trước)

- Làm đúng từng bước theo thứ tự; xong mỗi bước chạy "Verification" của bước đó rồi mới sang bước sau. Hàm thuần: viết test trước.
- `git status --short` trước khi sửa. Chỉ có thư mục `.commandcode/` untracked (của công cụ khác, không đụng). Không sửa `docs/STATUS.md`.
- Plugin **không import** `src/domain`, `src/api`, `src/plugins/ordering`, mã Salanca. Không ghi cứng UID Salanca (UID Salanca chỉ ở `config/plugins.ts`; v0.2 **không** đổi khối cấu hình Salanca).
- Mã trình duyệt (`admin/src`) **không được import** `server/` hay `@strapi/utils`; chỉ được import `shared/` (thuần, không phụ thuộc Node/Strapi). Có script kiểm (bước 4).
- Mọi chuỗi hiển thị trên trang có bản `vi` và `en` ở `admin/src/translations/messages.ts` (dạng `key: [vi, en]` như ordering `translations/o3.ts`); chuỗi theo mã quy tắc nằm ở `shared/guidance.ts`. Không ghi tiếng Việt cứng trong component. Tên action quyền bằng tiếng Anh.
- Engine v0.1 (`shared/audit/engine.ts`) và `POST /audit/run` và CLI **không đổi hành vi**. Nếu phải sửa chúng để làm bước nào đó, dừng và ghi vào "Điều lệch kế hoạch".
- Chỉ đọc nội dung CMS; ghi duy nhất vào bảng `dismissal` của plugin, qua `strapi.db.query`. Không SQL thô. Không migration (xem bước 2).
- Lệnh viết cho PowerShell; trình quản lý gói `pnpm`. Gate gọn (xem Verification). Không chạy toàn bộ bộ test, `check:phase3`, `smoke:*` có sẵn của repo. **Không UAT giao diện bằng công cụ** (chủ dự án tự kiểm tay).
- **DB dev: chỉ đọc**. Mọi thao tác ghi (role, user, dismissal, document) chỉ trên DB test `salanca_seo_test` qua `scripts/seo-toolkit/_harness.mjs`. Không DB test thì dừng và báo, không chuyển sang DB dev.
- Chỉ lần này được sửa `AGENTS.md`, đúng một bullet như spec mục 6 (bước 8); không sửa gì khác trong file đó.
- Không commit, không push cho tới khi chủ dự án (tan_ngo) nói.
- Gặp chỗ plan mâu thuẫn với code hoặc spec: ghi vào "Điều lệch kế hoạch" cuối file; chỉ hỏi khi đổi phạm vi, bảo mật hoặc dữ liệu.

## Goal

Trang admin "Kiểm tra SEO" (điểm, lỗi theo loại hoặc theo trang, nút Sửa, bỏ qua có lý do và khôi phục) cho plugin tổng quát `seo-toolkit`, bật cùng `SEO_TOOLKIT_ENABLED`. Chi tiết hành vi: spec.

## Non-goals

Như spec: lịch sử/so sánh/nhãn Mới/chạy lại một check (v0.11), banner/go-live/`audit-event` (v0.4), nút "Mở trang" (v0.3), tab Sitemap, preview SERP, priority, sửa inline, lọc `locales` ở collector, tách log CLI, thay đổi `audit/run` và CLI, thay đổi khối Salanca, dependency mới, đổi `STATUS.md`.

## Current evidence (đã đọc ngày 2026-10-17)

### v0.1 trong worktree (không đổi trừ chỗ ghi ở bước)

- `shared/audit/{types,rules,engine}.ts`, `shared/{messages,cli}.ts`. `AuditIssue` có `code, severity, uid, documentId, locale, label, seoField, field, params`. `RULE_CODES` 11 mã, `DEFAULT_SEVERITY` ở `rules.ts`.
- `server/src/services/audit.ts` (`run`, `setConfigProblems`, `getConfigProblems`), `controllers/audit.ts` (`run`, `AuditHttpCtx`), `routes/index.ts` (một route `POST /audit/run`), `register.ts` (`registerMany`, một action), `collector/collect.ts` (`collectEntries`), `index.ts` (`contentTypes: {}`, `services`, `controllers`, `routes`).
- Service/controller viết dạng `({ strapi }) => ({...})`; test dùng `strapi` giả (`services/audit.test.ts`, mock `collectEntries` và `runAudit`).
- Harness DB test độc lập: `scripts/seo-toolkit/_harness.mjs` (`withApp`, `seedAdminHttpStaff(app, { actions })` trả `as(method, path, body)` gọi `/seo-toolkit${path}`, `cleanup`, `TEST_DATABASE`) và mẫu `admin-route-smoke.mjs`.
- `package.json` (host): `build:seo-toolkit`, `typecheck:seo-toolkit`, `check:seo-toolkit`, `seo:audit`, `smoke:seo-toolkit`. `tsconfig.seo-toolkit.json` kiểm server + shared.

### Mẫu cần nhân bản từ ordering (đọc, không import)

- Đóng gói admin: `src/plugins/ordering/package.json` (khóa `exports["./strapi-admin"]`), `tsconfig.ordering-admin.json`, `scripts/ordering/check-admin-imports.mjs`.
- `src/plugins/ordering/admin/src/index.ts` (`addMenuLink`, `registerPlugin`, `registerTrads`), `pluginId.ts`, `lib/permissions.ts` (mảng quyền ổn định cho `useRBAC`), `lib/api.ts` (`apiErrorOf`, `httpStatusOf`, `useErrorToast`), `lib/i18n.ts` (`useT`, `useLocale`, `pack`), `translations/o3.ts` + `o3.test.ts` (test khóa dịch bị thiếu), `pages/App.tsx` (`Page.Protect`, `useRBAC`), `pages/Alerts/index.tsx` (trang danh sách nhỏ dùng `useFetchClient`, `Table`, `Tabs`, trạng thái tải/lỗi/403).
- Content type ẩn của plugin: `server/src/content-types/internal.ts` (`collection()`: `collectionName` có tiền tố `plugins_ordering_`, `pluginOptions` ẩn khỏi Content Manager và Content-Type Builder, `i18n.localized: false`, `draftAndPublish: false`) và `content-types/admin-change-log/{schema,index}.ts`.
- Host admin không ẩn mục menu plugin (`src/admin/admin-navigation-visibility.helper.ts` chỉ lọc Marketplace và Documentation).
- Kiểm tra gói admin của host: `docs/STATUS.md` ghi gate ordering gồm `ORDERING_ENABLED=true strapi build`.

### Sự thật từ dữ liệu thật (DB dev, chỉ đọc, 2026-10-16)

12 loại nội dung, 45 entry, 6 lỗi / 15 cảnh báo / 39 lưu ý. `menu-page` có hai khối SEO (`seo`, `cateringSeo`). Mọi loại đều i18n (en, vi). Ước lượng điểm theo công thức spec mục 8: 43 trang-ngôn-ngữ (45 entry trừ 2 vì `menu-page` có 2 khối trong cùng trang-ngôn-ngữ), 6 trang-ngôn-ngữ có lỗi mức Lỗi (4 của `menu-category`, 2 của `menu-page`), tức 37/43 sạch, khoảng 86%. Đây chỉ là con số kiểm hợp lý cho chủ dự án khi UAT trên DB dev của họ. AI thực hiện **không** khởi động plugin với DB dev để lấy số này (khởi động tạo bảng `dismissal`, xem Invariants); logic điểm được chứng minh bằng test thuần và smoke trên DB test.

## Decisions and assumptions

Như spec (A1 đến A7). Thêm cho kế hoạch:

- **P1:** Bỏ qua và `buildView` nằm ở `shared/audit/view.ts` (hàm thuần), service chỉ thu thập đầu vào (entries, report, dismissals, targets) rồi gọi nó. Lý do: test không cần Strapi.
- **P2:** Service `dismissal` là service riêng (`strapi.plugin('seo-toolkit').service('dismissal')`); `audit.view` gọi nó qua `strapi.plugin(...)`, nên test `audit.view` dùng `strapi` giả có `plugin()`.
- **P3:** Không dùng Document Service cho `dismissal` (không Draft & Publish): dùng `strapi.db.query('plugin::seo-toolkit.dismissal')`.
- **P4:** Không có migration. `key` (`unique: true`) là ràng buộc DB duy nhất. Nếu bước 8 cho thấy Strapi không tạo ràng buộc `unique` cho collection của plugin, ghi vào "Điều lệch kế hoạch" và giữ phòng thủ ở service (kiểm tồn tại trước khi tạo), không thêm SQL.

## Invariants

- `SEO_TOOLKIT_ENABLED` tắt (mặc định): không route, không menu, không bảng, không đổi gì ở host.
- `SEO_TOOLKIT_ENABLED` bật: lần khởi động đầu Strapi tạo một bảng rỗng `plugins_seo_toolkit_dismissal` trong DB mà nó kết nối (kể cả khi chỉ chạy `seo:audit`). Từ v0.2 "audit chỉ đọc" chỉ còn đúng với nội dung CMS; mọi lời "chỉ đọc / không ghi gì" trong tài liệu phải được sửa (bước 8).
- `POST /seo-toolkit/audit/run`, `pnpm run seo:audit`, engine: cùng đầu vào cho cùng đầu ra như v0.1; không bao giờ áp dụng bỏ qua.
- Một vấn đề mức Lỗi không bao giờ nằm trong `dismissed` (kể cả khi có bản ghi cũ).
- Server không bao giờ ghi lý do (văn bản tự do) vào log.
- Mã trình duyệt không kéo mã server vào gói admin.

## Hợp đồng kiểu mới (`shared/audit/view.ts`, viết đúng tên này)

```ts
import type { AuditEntry, AuditIssue, AuditReport, AuditStatus, RuleCode } from './types';

/** Danh tính một vấn đề (đủ để bỏ qua). locale/seoField null khi không áp dụng. */
export interface IssueIdentity {
  code: RuleCode;
  uid: string;
  documentId: string;
  locale: string | null;
  seoField: string | null;
}

/** Một bản ghi bỏ qua như service trả về (không có văn bản tự do ngoài `reason`). */
export interface ViewDismissal {
  id: number;
  key: string;
  reason: string;
  adminLabel: string;
  dismissedAt: string; // ISO
}

export interface ViewIssue extends AuditIssue {
  key: string;
  dismissible: boolean;
}

export interface DismissedIssue extends AuditIssue {
  key: string;
  dismissal: Omit<ViewDismissal, 'key'>;
}

export interface AuditViewTarget {
  uid: string;
  kind: 'singleType' | 'collectionType';
  displayName: string;
  localized: boolean;
  seoFields: string[];
}

export interface AuditScore {
  pages: number;
  cleanPages: number;
  percent: number | null;
}

export interface AuditView {
  generatedAt: string;
  scope: AuditReport['scope'];
  summary: { entries: number; error: number; warn: number; notice: number; dismissed: number };
  score: AuditScore;
  issues: ViewIssue[];
  dismissed: DismissedIssue[];
  targets: AuditViewTarget[];
}

export const issueKey = (issue: IssueIdentity): string; // `${code}|${uid}|${documentId}|${locale ?? ''}|${seoField ?? ''}`
export const isDismissible = (issue: Pick<AuditIssue, 'severity'>): boolean; // severity !== 'error'  (A3: đổi quyết định chỉ cần sửa dòng này)
export const computeScore = (entries: AuditEntry[], activeIssues: AuditIssue[]): AuditScore;
export const buildView = (input: {
  report: AuditReport;
  entries: AuditEntry[];
  dismissals: ViewDismissal[];
  targets: AuditViewTarget[];
}) => AuditView;
export type { AuditStatus };
```

`AuditIssue` của v0.1 không đổi.

## Thuật toán `buildView` (bắt buộc đúng thứ tự)

1. `byKey` = map `key -> ViewDismissal` từ `input.dismissals`. Nếu hai bản ghi cùng `key` (không nên xảy ra), giữ bản có `id` nhỏ hơn.
2. Duyệt `report.issues` theo thứ tự có sẵn (đã sắp xếp xác định). Với mỗi vấn đề tính `key = issueKey(issue)` (dùng `issue.code, uid, documentId, locale, seoField`).
3. Nếu `isDismissible(issue)` **và** `byKey` có `key`: đưa vào `dismissed` với `dismissal = { id, reason, adminLabel, dismissedAt }`. Ngược lại: đưa vào `issues` với `dismissible = isDismissible(issue)`.
4. `summary` = `{ entries: report.summary.entries, error/warn/notice đếm trên mảng issues đang hiện, dismissed: dismissed.length }`.
5. `score = computeScore(entries, issues)`.
6. Trả `{ generatedAt, scope, summary, score, issues, dismissed, targets }` (`targets` giữ nguyên thứ tự đầu vào; service đã sắp theo `uid`). Không sửa mảng đầu vào.

## `computeScore(entries, activeIssues)`

1. `pageKey(uid, documentId, locale) = uid + '\u0000' + documentId + '\u0000' + (locale ?? '')`.
2. `pages` = số `pageKey` khác nhau trong `entries`.
3. Tập `bad` = `pageKey` của các vấn đề trong `activeIssues` có `severity === 'error'` **và** `pageKey` thuộc tập trang của `entries` (vấn đề có `pageKey` không có entry, như `translation-missing`, không tính).
4. `cleanPages = pages - bad.size`.
5. `percent = pages === 0 ? null : Math.floor((100 * cleanPages) / pages)`.

## `contentManagerPath` (`shared/links.ts`)

```ts
export const contentManagerPath = (input: {
  kind: 'singleType' | 'collectionType';
  uid: string;
  documentId: string;
  locale: string | null;
}): string;
```

- `collectionType`: `/content-manager/collection-types/${uid}/${encodeURIComponent(documentId)}`; `singleType`: `/content-manager/single-types/${uid}`.
- Thêm `?plugins[i18n][locale]=${encodeURIComponent(locale)}` khi `locale !== null`. Không mã hóa `uid`. Không có `/admin` ở đầu.

## Nội dung hướng dẫn (`shared/guidance.ts`)

Hàm `guidance(code, lang)` trả `{ title, why, fix }` (chuỗi). Dữ liệu cố định, viết đúng văn bản dưới đây (đã trung lập về host, không nêu tên field cụ thể của Salanca). Test kiểm đủ 11 mã × 2 ngôn ngữ × 3 chuỗi không rỗng.

| Mã | vi: title / why / fix | en: title / why / fix |
| --- | --- | --- |
| `seo.block-missing` | Chưa có khối SEO / Không có khối SEO thì trang không có tiêu đề và mô tả riêng, Google tự lấy một đoạn bất kỳ trong trang. / Mở trang, điền khối SEO (tiêu đề và mô tả), rồi lưu và xuất bản. | SEO block is missing / Without an SEO block the page has no title or description of its own, so search engines pick text from the page on their own. / Open the entry, fill in the SEO block (title and description), then save and publish. |
| `seo.title-missing` | Thiếu tiêu đề SEO / Tiêu đề là dòng chữ chính hiện trên Google và trên tab trình duyệt. / Điền tiêu đề SEO nói đúng nội dung trang, trong giới hạn ký tự đã nêu. | SEO title is missing / The title is the main line shown on Google and on the browser tab. / Fill in an SEO title that describes the page, within the stated character limit. |
| `seo.description-missing` | Thiếu mô tả SEO / Mô tả là đoạn chữ dưới tiêu đề trên Google; thiếu thì Google tự chọn đoạn bất kỳ. / Điền mô tả SEO nói rõ trang này có gì, trong giới hạn ký tự đã nêu. | SEO description is missing / The description is the text under the title on Google; without it the search engine picks a snippet on its own. / Fill in an SEO description that says what is on this page, within the stated character limit. |
| `seo.title-too-long` | Tiêu đề SEO quá dài / Tiêu đề quá dài bị Google cắt bớt trong kết quả tìm kiếm. / Rút gọn dưới giới hạn, đặt ý chính ở đầu. | SEO title is too long / A long title is cut off in search results. / Shorten it below the limit and put the key words first. |
| `seo.description-too-long` | Mô tả SEO quá dài / Mô tả quá dài bị Google cắt bớt trong kết quả tìm kiếm. / Rút gọn dưới giới hạn, đặt ý chính ở đầu. | SEO description is too long / A long description is cut off in search results. / Shorten it below the limit and put the key words first. |
| `seo.title-duplicate` | Tiêu đề SEO bị trùng / Nhiều trang cùng một tiêu đề khiến Google và khách khó phân biệt các trang. / Viết tiêu đề riêng cho từng trang. Nếu trùng là chủ ý, chọn Bỏ qua và ghi lý do. | SEO title is duplicated / Several pages with the same title are hard to tell apart in search results. / Write a distinct title for each page. If the duplicate is intentional, choose Dismiss and give a reason. |
| `seo.description-duplicate` | Mô tả SEO bị trùng / Nhiều trang cùng một mô tả làm kết quả tìm kiếm trông giống nhau. / Viết mô tả riêng cho từng trang. Nếu trùng là chủ ý, chọn Bỏ qua và ghi lý do. | SEO description is duplicated / Several pages with the same description look alike in search results. / Write a distinct description for each page. If the duplicate is intentional, choose Dismiss and give a reason. |
| `i18n.translation-missing` | Thiếu bản dịch / Khách dùng ngôn ngữ đó không thấy trang này, và các ngôn ngữ không liên kết được với nhau. / Bấm Sửa để tạo bản dịch ở ngôn ngữ còn thiếu rồi xuất bản. Nếu trang chỉ có một ngôn ngữ là chủ ý, chọn Bỏ qua. | Translation is missing / Visitors using that language do not see this page, and the language versions cannot be linked together. / Use Edit to create the translation in the missing language, then publish. If a single language is intentional, choose Dismiss. |
| `media.share-image-missing` | Thiếu ảnh chia sẻ / Ảnh chia sẻ là ảnh hiện khi dán đường dẫn lên mạng xã hội hay ứng dụng nhắn tin; thiếu thì thẻ chia sẻ trống hoặc lấy ảnh ngẫu nhiên. / Chọn một ảnh chia sẻ trong khối SEO (khoảng 1200×630). | Share image is missing / The share image is what appears when the link is pasted into social or chat apps; without it the preview is empty or random. / Pick a share image in the SEO block (about 1200×630). |
| `media.share-image-alt-missing` | Ảnh chia sẻ thiếu văn bản thay thế / Văn bản thay thế giúp người dùng đọc màn hình và công cụ tìm kiếm hiểu ảnh. / Mở ảnh trong thư viện phương tiện và điền văn bản thay thế (alt). | Share image has no alt text / Alt text helps screen-reader users and search engines understand the image. / Open the image in the media library and fill in the alternative text. |
| `seo.noindex-set` | Trang đang đặt không index / Trang đặt noIndex sẽ không xuất hiện trên Google. / Nếu không chủ ý, bỏ chọn noIndex rồi xuất bản. Nếu chủ ý, chọn Bỏ qua và ghi lý do. | Page is set to noIndex / A noIndex page will not appear on Google. / If this is not intended, clear noIndex and publish. If intended, choose Dismiss and give a reason. |

## Khóa dịch của trang (`admin/src/translations/messages.ts`)

Tiền tố `seo-toolkit.` thêm trong `lib/i18n.ts`. Cần ít nhất các khóa sau (thêm khóa phụ được; mỗi khóa dùng trong mã phải có ở đây, test bắt):

| Khóa | vi | en |
| --- | --- | --- |
| `nav.title` | SEO | SEO |
| `page.title` | Kiểm tra SEO | SEO audit |
| `page.updatedAt` | Cập nhật lúc {time} | Updated at {time} |
| `scope.label` | Phạm vi | Scope |
| `scope.published` | Bản đã xuất bản | Published |
| `scope.draft` | Bản nháp | Draft |
| `action.rerun` | Chạy lại | Run again |
| `score.title` | Điểm sức khỏe SEO | SEO health score |
| `score.clean` | {clean}/{pages} trang sạch lỗi | {clean}/{pages} pages without errors |
| `count.error.title` / `.hint` | Lỗi / Phải sửa trước go-live | Errors / Fix before go-live |
| `count.warn.title` / `.hint` | Cảnh báo / Nên sửa | Warnings / Should fix |
| `count.notice.title` / `.hint` | Lưu ý / Không tính vào điểm | Notices / Not counted in the score |
| `dismissed.summary` | {count} vấn đề đã bỏ qua có chủ ý | {count} issues dismissed on purpose |
| `view.byCode` / `view.byPage` | Theo loại lỗi / Theo trang | By issue type / By page |
| `filter.all` | Tất cả | All |
| `filter.contentType` / `filter.locale` | Loại nội dung / Ngôn ngữ | Content type / Language |
| `list.items` | {count} mục | {count} items |
| `list.why` / `list.fix` | Vì sao quan trọng / Cách sửa | Why it matters / How to fix |
| `table.page` / `.contentType` / `.locale` / `.block` / `.detail` | Trang / Loại nội dung / Ngôn ngữ / Khối SEO / Chi tiết | Page / Content type / Language / SEO block / Detail |
| `page.issueCount` | {count} vấn đề trên trang này | {count} issues on this page |
| `action.edit` | Sửa → | Edit → |
| `action.editIn` | Sửa ({locale}) → | Edit ({locale}) → |
| `action.dismiss` / `action.restore` | Bỏ qua… / Khôi phục | Dismiss… / Restore |
| `dialog.title` | Bỏ qua vấn đề này? | Dismiss this issue? |
| `dialog.reason` | Lý do | Reason |
| `dialog.reason.hint` | 3 đến 500 ký tự. Ghi để người sau hiểu vì sao đây là chủ ý. | 3 to 500 characters. Explain why this is intentional. |
| `dialog.reason.tooShort` | Lý do cần ít nhất 3 ký tự | The reason needs at least 3 characters |
| `dialog.confirm` / `dialog.cancel` | Bỏ qua / Hủy | Dismiss / Cancel |
| `dismissed.title` | Đã bỏ qua | Dismissed |
| `dismissed.reason` / `.by` / `.at` | Lý do / Người bỏ qua / Lúc | Reason / Dismissed by / At |
| `toast.dismissed` / `toast.restored` | Đã bỏ qua / Đã khôi phục | Dismissed / Restored |
| `state.loading` | Đang kiểm tra… | Checking… |
| `state.error.title` | Không chạy được kiểm tra | The audit could not run |
| `state.retry` | Thử lại | Retry |
| `state.forbidden` | Tài khoản của bạn chưa có quyền xem mục này. | Your account does not have permission to view this. |
| `state.empty.clean` | Dữ liệu SEO không có vấn đề. | No SEO issues found. |
| `state.empty.filtered` | Không có vấn đề nào ở bộ lọc này. | No issues match this filter. |
| `error.generic` | Thao tác thất bại, thử lại sau | The action failed, please try again |

## Cấu trúc file

```text
src/plugins/seo-toolkit/
  package.json                       (thêm exports["./strapi-admin"])
  shared/audit/view.ts (+ view.test.ts)     issueKey, isDismissible, computeScore, buildView + kiểu
  shared/links.ts (+ links.test.ts)
  shared/guidance.ts (+ guidance.test.ts)
  server/src/content-types/{index.ts, dismissal/{schema.ts,index.ts}}
  server/src/services/dismissal.ts (+ test); services/audit.ts (thêm view); services/index.ts
  server/src/controllers/{audit.ts (thêm view), dismissal.ts, index.ts}
  server/src/routes/index.ts (+ test), register.ts (+ test), index.ts (contentTypes)
  admin/src/{index.ts, pluginId.ts}
  admin/src/lib/{api.ts, i18n.ts, permissions.ts, view-model.ts (+ view-model.test.ts)}
  admin/src/translations/{messages.ts, messages.test.ts}
  admin/src/pages/App.tsx
  admin/src/pages/Audit/{index.tsx, SummaryCards.tsx, Toolbar.tsx, ByCodeList.tsx, ByPageList.tsx, DismissDialog.tsx, DismissedList.tsx}
tsconfig.seo-toolkit-admin.json
scripts/seo-toolkit/{check-admin-imports.mjs, dismissal-smoke.mjs}
```

## Implementation steps

### Bước 0: môi trường và baseline

```powershell
Set-Location D:\outsource\salanca\salanca-seo
git status --short
git log --oneline -3
pnpm install --frozen-lockfile
pnpm run build:seo-toolkit
pnpm run typecheck
pnpm exec vitest run src/plugins/seo-toolkit config/plugins.test.ts
pnpm run smoke:seo-toolkit
```

Ghi kết quả baseline (kỳ vọng: 94 test, smoke 8/8). Lỗi sẵn có thì ghi vào Completion record, không sửa trong phạm vi này.

### Bước 1: hàm thuần `shared/` (viết test trước)

- `shared/audit/view.ts`: kiểu và hàm theo "Hợp đồng kiểu mới", "Thuật toán buildView", "computeScore". `view.test.ts` theo bảng test bên dưới.
- `shared/links.ts` + `links.test.ts`.
- `shared/guidance.ts` (dữ liệu trong bảng trên, hàm `guidance(code, lang)`, `GUIDANCE_CODES = RULE_CODES`) + `guidance.test.ts`.
- Các file này **không import** Node, Strapi, React. Server tsconfig phải build được (`build:seo-toolkit`).
- Verification: `pnpm exec vitest run src/plugins/seo-toolkit/shared`, `pnpm run typecheck:seo-toolkit`.

### Bước 2: content type `dismissal`

- `server/src/content-types/dismissal/schema.ts`: đối tượng thuần theo mẫu `ordering/server/src/content-types/internal.ts` nhưng **không** import ordering: `kind: 'collectionType'`, `collectionName: 'plugins_seo_toolkit_dismissal'`, `info: { singularName: 'dismissal', pluralName: 'dismissals', displayName: 'SEO dismissal' }`, `options: { draftAndPublish: false }`, `pluginOptions` ẩn khỏi `content-manager` và `content-type-builder`, `i18n: { localized: false }`, thuộc tính: `key` (string, required, unique), `code` (string, required), `uid` (string, required), `documentId` (string, required), `locale` (string), `seoField` (string), `reason` (text, required), `adminUserId` (integer, required), `adminLabel` (string, required), `dismissedAt` (datetime, required).
- `content-types/dismissal/index.ts` = `{ schema }`; `content-types/index.ts` = `{ dismissal }`; `server/src/index.ts`: `contentTypes` lấy từ đó (thay `{}`).
- Verification: `pnpm run build:seo-toolkit`, `pnpm run typecheck:seo-toolkit`. Bảng được kiểm thật ở bước 8 (smoke).

### Bước 3: service, controller, route, quyền

- `services/dismissal.ts` (`({ strapi }) => ({ list, create, remove })`), kiểu `DismissalRow` (id, key, code, uid, documentId, locale, seoField, reason, adminUserId, adminLabel, dismissedAt ISO string):
  - `list()`: `strapi.db.query('plugin::seo-toolkit.dismissal').findMany({ orderBy: { id: 'asc' } })`, trả `DismissalRow[]` (datetime chuẩn hóa ISO string).
  - `create({ issue, reason }, actor)`: `reason = reason.trim()`; 3 ≤ độ dài (đếm code point) ≤ 500 nếu không `ValidationError`; `issue.code` thuộc `RULE_CODES`; `issue.uid` thuộc `Object.keys(config.contentTypes)`; mức hiện tại = `config.severities[code] ?? DEFAULT_SEVERITY[code]`; nếu `'off'` hoặc không `isDismissible({ severity })` thì `ValidationError` (thông điệp tiếng Anh nêu lý do). `key = issueKey(issue)`. Nếu đã có bản ghi cùng `key` trả bản đó. Ngược lại tạo `{ key, code, uid, documentId, locale, seoField, reason, adminUserId: actor.id, adminLabel: actor.label, dismissedAt: new Date().toISOString() }`; nếu tạo lỗi do trùng khóa (đua nhau) thì đọc lại theo `key` và trả. `strapi.log.info('[seo-toolkit] dismissal created', { key, adminUserId })`. Không log `reason`.
  - `remove(id, actor)`: tìm theo `id`; không có thì `errors.NotFoundError`; lấy `key` của dòng đó rồi **xóa mọi dòng có cùng `key`** (`deleteMany({ where: { key } })`), để một vụ tạo đua nhau (nếu DB không có ràng buộc `unique`, xem A5) không để lại dòng thứ hai làm vấn đề vẫn bị bỏ qua sau khi Khôi phục; `strapi.log.info('[seo-toolkit] dismissal restored', { key, adminUserId: actor.id })`.
  - `config` đọc bằng `strapi.config.get('plugin::seo-toolkit')`.
- `services/audit.ts`: tách phần thu thập của `run` thành hàm nội bộ `execute(options)` trả `{ entries, report, config, status }` (hành vi của `run` **không đổi**). Thêm `view(options: { status? })`: gọi `execute`, `dismissals = await strapi.plugin('seo-toolkit').service('dismissal').list()`, `targets` dựng từ `config.contentTypes` (mỗi uid: `kind = strapi.contentType(uid).kind`, `displayName = strapi.contentType(uid).info.displayName ?? uid`, `localized` = `strapi.plugin('i18n').service('content-types').isLocalizedContentType(model)`, `seoFields` = mảng chuẩn hóa từ `seoField` hoặc `['seo']`; sắp theo `uid`; uid không đăng ký thì bỏ qua), rồi `buildView({ report, entries, dismissals, targets })`. `view` vẫn ném `ValidationError` khi còn `configProblems` (như `run`).
- `controllers/audit.ts`: thêm `view(ctx)` với body schema `{ status?: 'published' | 'draft' }` (zod `z.object(...).strict()`; lỗi → `ValidationError`). `controllers/dismissal.ts`: `create(ctx)` (body zod strict: `issue` object strict gồm `code` (string), `uid` (string min 1), `documentId` (string min 1), `locale` (string min 1 hoặc null), `seoField` (string min 1 hoặc null); `reason` string), `remove(ctx)` (`ctx.params.id` → số nguyên dương, ngược lại `ValidationError`). Actor lấy từ `ctx.state.user`: `id` (số), `label = [firstname, lastname].filter(Boolean).join(' ').trim() || 'admin#' + id`; thiếu `user.id` thì `errors.UnauthorizedError`. Ghi `ctx.body` (create trả `DismissalRow` không có `adminUserId`; remove trả `{ id }`).
- `routes/index.ts`: thêm ba route admin: `POST /audit/view` (policies `admin::isAuthenticatedAdmin` + `admin::hasPermissions` action `plugin::seo-toolkit.audit.run`), `POST /dismissals` và `DELETE /dismissals/:id` (action `plugin::seo-toolkit.manage`). Giữ route cũ.
- `register.ts`: thêm `{ section: 'plugins', pluginName: 'seo-toolkit', uid: 'manage', displayName: 'Manage SEO dismissals' }`.
- `services/index.ts`, `controllers/index.ts`: thêm `dismissal`.
- Test (bảng bên dưới): `services/dismissal.test.ts` (fake `strapi.db.query` trong bộ nhớ), cập nhật `services/audit.test.ts` (`view`), `controllers/*.test.ts`, `routes/index.test.ts`, `register.test.ts`.
- Verification: `pnpm exec vitest run src/plugins/seo-toolkit/server`, `build:seo-toolkit`, `typecheck:seo-toolkit`.

### Bước 4: đóng gói admin, kiểm import, tsconfig, script

- `src/plugins/seo-toolkit/package.json`: thêm `"./strapi-admin": { "import": "./admin/src/index.ts" }` như ordering. Không đổi khóa khác.
- `tsconfig.seo-toolkit-admin.json`: nhân bản `tsconfig.ordering-admin.json`, đổi `include`/`exclude` sang `src/plugins/seo-toolkit/admin/src/**` và thêm `src/plugins/seo-toolkit/shared/**/*.ts` (loại `*.test.ts`).
- `scripts/seo-toolkit/check-admin-imports.mjs`: nhân bản `scripts/ordering/check-admin-imports.mjs`, quét `src/plugins/seo-toolkit/admin/src`, cấm import đường dẫn chứa `server/` hoặc `@strapi/utils`, in `[seo-toolkit-admin-imports] PASS N admin source file(s) scanned`.
- `package.json` (host): thêm `typecheck:seo-toolkit-admin` (`tsc -p tsconfig.seo-toolkit-admin.json`); sửa `check:seo-toolkit` thành `... && pnpm run typecheck:seo-toolkit && pnpm run typecheck:seo-toolkit-admin && node scripts/seo-toolkit/check-admin-imports.mjs && vitest run src/plugins/seo-toolkit config/plugins.test.ts`; sửa `smoke:seo-toolkit` thành `pnpm run build:seo-toolkit && node scripts/seo-toolkit/admin-route-smoke.mjs && node scripts/seo-toolkit/dismissal-smoke.mjs`. Không thêm dependency.
- Tạo trước `admin/src/pluginId.ts` (một dòng `export const PLUGIN_ID = 'seo-toolkit';`) để `tsc` và script kiểm có đầu vào.
- Verification: `node scripts/seo-toolkit/check-admin-imports.mjs` (in `PASS 1 admin source file(s) scanned`), `pnpm run typecheck:seo-toolkit-admin`.

### Bước 5: lớp thuần của admin và bản dịch (test trước)

- `admin/src/pluginId.ts` (`'seo-toolkit'`), `lib/permissions.ts` (`PERMISSIONS = { read: [{ action: 'plugin::seo-toolkit.audit.run', subject: null }], manage: [{ action: 'plugin::seo-toolkit.manage', subject: null }] }` và mảng ổn định), `lib/i18n.ts` (`useT`, `useLocale`, `translations(locale)` cho `registerTrads`; khóa có tiền tố `seo-toolkit.`), `lib/api.ts` (lấy mẫu `apiErrorOf`, `httpStatusOf`, `useErrorToast` của ordering; không import ordering).
- `translations/messages.ts` theo bảng khóa; `messages.test.ts` (nhân bản cách `o3.test.ts` quét mã nguồn trong `pages`, `lib`: mọi `t('khóa')` literal phải có khóa; mọi khóa có đủ vi và en không rỗng).
- `lib/view-model.ts` (hàm thuần cho trang, có `view-model.test.ts`): `filterIssues(issues, { severity: 'all'|Severity, uid: string|'all', locale: string|'all' })`; `severityCounts(issues)`; `groupByCode(issues)` (mỗi nhóm `{ code, severity, issues }`; sắp mức nặng trước, rồi số mục giảm dần, rồi mã tăng dần); `groupByPage(issues, targets)` (nhóm theo `(uid, documentId)`; `{ uid, documentId, label, displayName, worst, issues, locales }`; label theo spec mục 3; sắp theo spec); `editTarget(issue, targets)` → `{ kind, uid, documentId, locale } | null` (null khi không có target cho uid); `hasMultipleSeoFields(issues)`; `localeOptions(view)`, `contentTypeOptions(view)` (từ `scope.locales` và `targets`).
- Verification: `pnpm exec vitest run src/plugins/seo-toolkit/admin src/plugins/seo-toolkit/shared`.

### Bước 6: trang admin

- `admin/src/index.ts`: `register(app)` gọi `app.addMenuLink({ to: '/plugins/seo-toolkit', icon: <icon từ @strapi/icons, ví dụ Search>, intlLabel: { id: 'seo-toolkit.nav.title', defaultMessage: 'SEO' }, Component: () => import('./pages/App'), permissions: PERMISSIONS.read })` và `app.registerPlugin({ id: PLUGIN_ID, name: 'SEO toolkit' })`; `registerTrads({ locales })` trả `{ data: translations(locale), locale }`. Không `bootstrap` (không Settings).
- `pages/App.tsx`: `Page.Protect` với `PERMISSIONS.read`, render `Audit`.
- `pages/Audit/index.tsx`: giữ state `status`, `view`, `loading/error`, bộ lọc; gọi `post('/seo-toolkit/audit/view', { status })` khi mở, khi `status` đổi và khi Chạy lại; `status` khởi tạo bằng `view.scope.status` của lần tải đầu (lần đầu gọi với body `{}` để server dùng `config.status`). Quyền `canManage` từ `useRBAC` (mẫu `pages/App.tsx` ordering). Chia nhỏ thành các component trong cùng thư mục theo "Cấu trúc file"; không file nào quá ~250 dòng.
- `SummaryCards`: điểm (`percent`, `score.clean`), ba thẻ đếm (mô tả nhỏ), dòng đã bỏ qua. `Toolbar`: nút gạt xem, chip mức có số, hai ô chọn, phạm vi, Chạy lại, thời điểm cập nhật.
- `ByCodeList` / `ByPageList`: theo spec mục 2 và 3. Chi tiết mỗi dòng dùng `formatMessage(issue.code, issue.params, lang)` từ `shared/messages.ts`; tiêu đề/vì sao/cách sửa từ `guidance(code, lang)`; nhãn loại nội dung từ `targets[].displayName`; **Sửa →** là `Link` tới `contentManagerPath(editTarget(...))`.
- `DismissDialog`: ô lý do (kiểm 3 đến 500 ký tự sau khi cắt, thông báo `dialog.reason.tooShort`), gọi `post('/seo-toolkit/dismissals', { issue: { code, uid, documentId, locale, seoField }, reason })`, thành công thì toast `toast.dismissed` và tải lại. `DismissedList`: theo spec mục 4, **Khôi phục** gọi `del('/seo-toolkit/dismissals/' + id)`, toast `toast.restored`, tải lại.
- Lỗi: `useErrorToast` cho thao tác; lỗi tải hiện `state.error.title`, thông điệp server (nếu có) và nút Thử lại; HTTP 403 hiện `state.forbidden`.
- Truy cập: nút có nhãn chữ; huy hiệu mức có chữ (không chỉ màu); các nhóm gập dùng nút có `aria-expanded`; hộp thoại có tiêu đề và trả focus. Không phát minh giao diện ngoài `@strapi/design-system`.
- Verification: `pnpm run typecheck:seo-toolkit-admin`, `node scripts/seo-toolkit/check-admin-imports.mjs`, `pnpm exec eslint src/plugins/seo-toolkit` (sửa mọi lỗi lint thật; không sửa `eslint.config.mjs`), `pnpm exec vitest run src/plugins/seo-toolkit`.

### Bước 7: smoke HTTP cho bỏ qua (DB test)

- `scripts/seo-toolkit/dismissal-smoke.mjs` dựa trên `_harness.mjs` (chỉ thêm hàm vào `_harness.mjs` nếu thật cần; không import ordering). Dùng ba role: `none`, `runOnly` (`audit.run`), `manage` (`audit.run` + `manage`). Fixture trên DB test: tạo bản nháp `api::menu-category.menu-category` **A** có khối `seo` hợp lệ không có ảnh (sinh `media.share-image-missing`, mức lưu ý) và bản nháp **B** không có khối `seo` (sinh `seo.block-missing`, mức Lỗi); tên/slug có tiền tố `seo-smoke-` để dọn. Dọn mọi fixture và bản ghi bỏ qua trong `finally` và ở đầu chạy (chạy dở lần trước).
- Ca (mỗi ca là một `assert`, in `[seo-toolkit-test] caN ...`, không kèm email/token):
  1. `POST /audit/view` không token 401; role `none` 403; role `runOnly` 200, body đúng `AuditView` (có `score`, `targets` chứa `api::menu-category.menu-category` với `kind: 'collectionType'`).
  2. `view` (draft, `{ status: 'draft' }`): thấy vấn đề của A (`media.share-image-missing`, `dismissible: true`) và của B (`seo.block-missing`, `dismissible: false`, mức error); `score.percent` là số.
  3. `POST /dismissals` role `runOnly` 403; không token 401.
  4. Role `manage`: bỏ qua vấn đề của A, lý do hợp lệ: 200, trả bản ghi có `id`, `reason`, `adminLabel` (không rỗng, không chứa `@`).
  5. `view` lại: vấn đề A nằm ở `dismissed` với `dismissal.reason`; không còn ở `issues`; `summary.dismissed === 1` (hoặc lớn hơn nếu DB test có dữ liệu khác; so sánh tương đối với ca 2); `summary.notice` giảm đúng 1.
  6. Idempotent: gọi lại cùng định danh: 200, cùng `id`; trong bảng chỉ có một dòng với `key` đó.
  7. Kiểm tra đầu vào → 400: lý do `'a'`, lý do toàn khoảng trắng, lý do 501 ký tự, `code` lạ, `uid` chưa khai báo, thiếu `documentId`, thân có khóa thừa.
  8. Vấn đề B (mức Lỗi) → 400, bảng không có bản ghi cho `key` của B.
  9. `POST /audit/run` (role `runOnly`) vẫn trả vấn đề của A khi A đang bị bỏ qua (đường thô không áp dụng bỏ qua).
  10. `DELETE /dismissals/:id`: role `runOnly` 403; role `manage` 200; `view` lại thấy A ở `issues` và `dismissed` rỗng với A; xóa lại 404; `:id` = `abc` 400.
  11. Bản ghi cũ không có tác dụng với mức Lỗi: ghi trực tiếp một bản ghi bỏ qua cho vấn đề B qua `app.db.query` (qua mặt kiểm tra của service), rồi gọi `view`: B vẫn ở `issues`, không ở `dismissed`. Dọn bản ghi sau ca.
- In dòng tổng kết `[seo-toolkit-test] dismissal smoke passed on <DB>: N cases`.
- Verification: `pnpm run smoke:seo-toolkit` (cả hai smoke), xác nhận log `app booted on salanca_seo_test`.

### Bước 8: kiểm tra bảng, gói admin, tài liệu

- Trong cùng lần chạy smoke ghi rõ bằng chứng A5/A6: bảng tồn tại, ràng buộc `unique` hoạt động (thử tạo trực tiếp hai dòng cùng `key` qua `app.db.query` phải ném lỗi; nếu không ném, ghi vào "Điều lệch kế hoạch" mục P4), `adminLabel` lấy từ `firstname/lastname` (smoke tạo user với tên `seo` `HTTP` nên kỳ vọng "seo HTTP").
- Kiểm hành vi khi tắt plugin (chỉ trên DB test): thêm tham số `enabled` (mặc định `true`) cho `bootSeoToolkitTestApp`/`withApp` trong `_harness.mjs` (đặt `SEO_TOOLKIT_ENABLED` theo tham số). Sau khi bảng đã có dòng, khởi động Strapi với `enabled: false` rồi kiểm bảng `plugins_seo_toolkit_dismissal` còn hay không và còn dòng không (`app.db.connection.raw` trên `information_schema.tables`). Ghi kết quả vào README plugin mục "Dữ liệu" và Completion record. Nếu bảng bị xóa khi plugin tắt, ghi cảnh báo "tắt plugin làm mất bản ghi bỏ qua" (không phải mất nội dung). Đặt kiểm này làm ca cuối của `dismissal-smoke.mjs` (khởi động lại app trong cùng script); không để lại script tạm.
- Gói admin: `SEO_TOOLKIT_ENABLED=true pnpm exec strapi build` (như ordering với `ORDERING_ENABLED=true`). Nếu build chỉ lỗi vì `assertProductionMediaStorage` (`NODE_ENV=production` đòi `S3_BUCKET`), đặt các biến S3/CDN giả **chỉ trong lệnh** theo `.env.example` (không ghi `.env`, không sửa guard) và ghi cách chạy vào Completion record. Lỗi biên dịch của plugin thì sửa. Không commit thư mục build (kiểm `git status`).
- Tài liệu (theo spec mục 6):
  - `AGENTS.md`: đúng một bullet ngoại lệ sau bullet ordering.
  - `docs/cms-editor-guide.md`: mục "Kiểm tra SEO" ngắn (đọc file trước để theo giọng và cấu trúc hiện có).
  - README plugin: mục "Trang admin", "Quyền", "Dữ liệu" (bảng dismissal, hành vi khi tắt plugin), "Bỏ qua và CLI" (CLI/`audit/run` thô).
  - `docs/cms-technical-decisions.md`: bổ sung mục seo-toolkit (màn admin, bảng, A3) **và sửa** câu "read-only … writes nothing" của mục v0.1 cho đúng với v0.2 (ghi vào bảng `dismissal` của plugin, tạo bảng khi khởi động với plugin bật).
  - Rà mọi lời "chỉ đọc / read-only / không ghi gì / writes nothing" trong README plugin, `docs/README.md` (mục SEO toolkit), `docs/cms-technical-decisions.md`, comment đầu `scripts/seo-toolkit/audit.mjs` và `shared/cli.ts`, rồi sửa thành "chỉ đọc nội dung CMS; chỉ ghi vào bảng bỏ qua của plugin". `rg -n -i "read-only|chỉ đọc|writes nothing" src/plugins/seo-toolkit docs/README.md docs/cms-technical-decisions.md scripts/seo-toolkit` rồi xử lý từng kết quả.
  - `docs/README.md`: thêm liên kết spec, kế hoạch, handoff v0.2 vào mục SEO toolkit.
  - Roadmap card v0.2 (`who`, `done`, tham chiếu spec) nếu còn lệch so với spec: bản sửa nhỏ, không thêm release.
- Verification: `git diff --check`, đọc lại các diff tài liệu.

### Bước 9: cổng cuối và bản ghi

Chạy toàn bộ mục Verification, điền "Điều lệch kế hoạch" và "Completion record" (trạng thái đúng: `implemented`, `automated verification passed`, `ready for manual UAT`), liệt kê file đã đổi, xác nhận không ghi DB dev, không sửa file ngoài phạm vi, chưa commit.

## Bảng test (mỗi dòng là một ca)

### `shared/audit/view.test.ts`

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 1 | `issueKey` với locale/seoField null | `code|uid|doc||` (hai phần cuối rỗng) |
| 2 | `issueKey` với đủ trường | `code|uid|doc|vi|seo` |
| 3 | `isDismissible` | error → false; warn, notice → true |
| 4 | Không có bỏ qua | `issues` có `key` và `dismissible` đúng; `dismissed` rỗng; `summary` khớp `report.summary`, `dismissed: 0` |
| 5 | Bỏ qua khớp một cảnh báo | vào `dismissed` với `dismissal`; `summary.warn` giảm 1; `summary.dismissed` 1 |
| 6 | Bỏ qua khớp vấn đề mức Lỗi | bị bỏ qua tác dụng: vẫn ở `issues`, `dismissible: false`, `dismissed` rỗng |
| 7 | Bản ghi mồ côi (không vấn đề nào khớp) | không xuất hiện ở đâu, không đổi đếm |
| 8 | Hai bản ghi cùng `key` | dùng bản `id` nhỏ hơn |
| 9 | Không sửa mảng đầu vào | `report.issues` giữ nguyên độ dài/thứ tự |
| 10 | `targets` giữ nguyên | trả đúng như đầu vào |
| 11 | `computeScore` toàn sạch | `percent` 100, `cleanPages = pages` |
| 12 | Một trang-ngôn-ngữ có lỗi mức Lỗi | `cleanPages = pages - 1`, `percent` làm tròn xuống |
| 13 | Cảnh báo/lưu ý không đổi điểm | cùng `percent` như không có chúng |
| 14 | Hai khối SEO cùng trang-ngôn-ngữ | `pages` đếm một lần; lỗi ở một khối làm cả trang không sạch |
| 15 | Hai ngôn ngữ của cùng document | đếm thành hai trang-ngôn-ngữ |
| 16 | `translation-missing` (không có entry ở ngôn ngữ đó) | không đổi `pages`, `cleanPages` |
| 17 | `entries` rỗng | `pages 0`, `percent null` |
| 18 | `floor` | 2 sạch / 3 → 66 |

### `shared/links.test.ts`

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 1 | Collection, i18n | `/content-manager/collection-types/api::x.x/doc?plugins[i18n][locale]=vi` |
| 2 | Single, i18n | `/content-manager/single-types/api::x.x?plugins[i18n][locale]=en` |
| 3 | Collection, không i18n | không có chuỗi truy vấn |
| 4 | Single, không i18n | không có chuỗi truy vấn |
| 5 | `locale` có ký tự đặc biệt (`pt-BR`, hoặc chuỗi cần mã hóa) | đã `encodeURIComponent` |
| 6 | `documentId` có ký tự cần mã hóa | đã mã hóa; `uid` giữ nguyên |

### `shared/guidance.test.ts`

Đủ 11 mã × vi/en: `title`, `why`, `fix` không rỗng; không mã nào thiếu; `guidance` ném hoặc trả mã khi gọi mã lạ (theo chọn của bạn; ghi trong test).

### `admin/src/lib/view-model.test.ts`

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 1 | `filterIssues` theo mức/loại/ngôn ngữ, kết hợp | đúng giao của ba điều kiện; `'all'` không lọc |
| 2 | `severityCounts` | đếm đúng error/warn/notice |
| 3 | `groupByCode` sắp xếp | mức nặng trước, số mục giảm dần, mã tăng dần |
| 4 | `groupByPage` gom theo `(uid, documentId)` | một nhóm cho nhiều ngôn ngữ và nhiều khối |
| 5 | `groupByPage` nhãn | `label` đầu tiên khác null; không có thì `displayName`; không có target thì `uid` |
| 6 | `groupByPage` mức nặng nhất và sắp xếp | theo spec mục 3 |
| 7 | `editTarget` | có target → đủ `kind/uid/documentId/locale`; không target → null |
| 8 | `hasMultipleSeoFields` | true khi có hai `seoField` khác nhau, false khi một |
| 9 | Tùy chọn lọc | `localeOptions` từ `scope.locales`, `contentTypeOptions` từ `targets` đã có vấn đề hoặc mọi target (chọn một và ghi lại) |

### `admin/src/translations/messages.test.ts`

Mọi khóa có vi và en không rỗng; mọi `t('...')` literal trong `pages/` và `lib/` có khóa; tham số `{x}` giống nhau giữa vi và en.

### `server/src/services/dismissal.test.ts`

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 1 | Tạo mới hợp lệ | gọi `create` của DB một lần với `key` đúng, `reason` đã cắt, `adminUserId`, `adminLabel`, `dismissedAt` ISO |
| 2 | Cùng `key` lần hai | không tạo thêm, trả bản cũ |
| 3 | Lý do quá ngắn / toàn khoảng trắng / quá dài | `ValidationError` |
| 4 | `code` lạ | `ValidationError` |
| 5 | `uid` chưa khai báo | `ValidationError` |
| 6 | Vấn đề mức Lỗi (mặc định) | `ValidationError` |
| 7 | Mức nâng lên Lỗi qua `severities` | `ValidationError` |
| 8 | Quy tắc `off` | `ValidationError` |
| 9 | Mức hạ xuống warn qua `severities` cho quy tắc mặc định Lỗi | tạo được |
| 10 | Lỗi trùng khóa khi tạo | đọc lại theo `key` và trả |
| 11 | `remove` không có | `NotFoundError` |
| 12 | `remove` có | xóa mọi dòng cùng `key` với dòng có `id` đó (kể cả khi có hai dòng cùng `key`); log không chứa `reason` |
| 13 | `list` | sắp theo `id` tăng, datetime là ISO string |

### `server/src/services/audit.test.ts` (thêm cho `view`)

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 1 | `view` gọi collector và engine như `run` | cùng tham số |
| 2 | `view` gọi `buildView` với `dismissals` từ service `dismissal` | đúng đầu vào |
| 3 | `targets` | `kind`, `displayName`, `localized`, `seoFields` chuẩn hóa (chuỗi → mảng một phần tử), sắp theo `uid`; uid không đăng ký bị bỏ qua |
| 4 | Còn `configProblems` | `ValidationError` |
| 5 | `run` không đổi | các ca v0.1 vẫn đạt |

### Controller, route, register

- Controller `view`: body `{}` ok; `{ status: 'bogus' }` và khóa thừa → `ValidationError`. Controller `dismissal.create`: body hợp lệ gọi service với `actor` đúng (có tên → "Tên Họ", không tên → `admin#id`); thiếu `ctx.state.user.id` → `UnauthorizedError`; body sai → `ValidationError`. `remove`: `id` không phải số nguyên dương → `ValidationError`.
- Route: có đúng 4 route (1 cũ + 3 mới), mỗi route có đủ hai chính sách và đúng action: `POST /audit/run` và `POST /audit/view` dùng `audit.run`; `POST /dismissals` và `DELETE /dismissals/:id` dùng `manage`.
- `register`: `registerMany` được gọi với cả `audit.run` và `manage`.

## Data and rollback

- Bảng mới `plugins_seo_toolkit_dismissal` (do Strapi tạo khi plugin bật). Dữ liệu chỉ là trạng thái bỏ qua; mất bảng chỉ làm các cảnh báo hiện lại. Không migration, không backfill.
- Rollback: đặt `SEO_TOOLKIT_ENABLED` tắt (mặc định) để ẩn trang và route; hoàn lại bằng `git revert` các commit v0.2. Việc bảng còn hay mất khi tắt plugin được kiểm ở bước 8 và ghi lại.

## Verification (gọn, đúng phạm vi)

```powershell
Set-Location D:\outsource\salanca\salanca-seo
pnpm run build:seo-toolkit
pnpm run typecheck
pnpm run typecheck:seo-toolkit
pnpm run typecheck:seo-toolkit-admin
node scripts/seo-toolkit/check-admin-imports.mjs
pnpm exec eslint src/plugins/seo-toolkit config/plugins.ts config/plugins.test.ts
pnpm exec vitest run src/plugins/seo-toolkit config/plugins.test.ts
pnpm run smoke:seo-toolkit
$env:SEO_TOOLKIT_ENABLED='true'; pnpm exec strapi build
git diff --check
```

Không chạy toàn bộ bộ test. Script `.mjs` không nằm trong phạm vi eslint của repo (đã ghi ở v0.1 mục 4 của "Điều lệch"). `strapi build` phải chạy sau khi `build:seo-toolkit` (cần `dist/`). Sau build, `git status` không được hiện thư mục build mới ngoài `.gitignore`.

## Documentation impact

`AGENTS.md` (một bullet), `docs/cms-editor-guide.md`, README plugin, `docs/cms-technical-decisions.md`, `docs/README.md`, card v0.2 trong roadmap. Không đổi `docs/STATUS.md`, `docs/cms-content-model.md`, `docs/cms-api-contract.md` (route admin của plugin không nằm trong hợp đồng REST công khai).

## Risks and blockers

- `strapi build` có thể lộ lỗi mà `tsc` không thấy (esbuild bỏ qua kiểu); gate build là bắt buộc.
- Hành vi của Strapi với bảng plugin khi plugin tắt chưa biết: kiểm ở bước 8.
- `useRBAC`, `Page.Protect`, `Table`, `Tabs` của design-system đổi giữa các bản Strapi: bám đúng cách ordering dùng ở bản 5.51.1 đang cài; khác thì ghi vào "Điều lệch".
- Liên kết Content Manager (A7) cần kiểm tay một lần; sai thì chỉ `shared/links.ts` đổi.
- Điểm dao động mạnh vì site ít trang: giao diện luôn kèm "x/y".
- Không có UAT giao diện tự động: báo đúng trạng thái `ready for manual UAT`.

## Điều lệch kế hoạch

AI thực hiện ghi vào đây mọi chỗ làm khác plan và lý do.

## Completion record

AI thực hiện điền sau khi xong (trạng thái, lệnh đã chạy và kết quả, số ca smoke, kết quả bước 8 về bảng và gói admin, danh sách file, cổng thủ công còn mở).
