# SEO toolkit v0.1: audit dữ liệu SEO trong CMS (kế hoạch thực hiện)

Status: Draft (chờ chủ dự án duyệt spec và kế hoạch này)
Owner: tan_ngo duyệt; AI khác thực hiện
Last updated: 2026-10-16
Related phase: [`phases/phase-seo-toolkit-1-cms-audit.md`](../phases/phase-seo-toolkit-1-cms-audit.md) (đọc trước, đặc biệt mục 3b "Định nghĩa chính xác")
Roadmap: [`seo-toolkit-roadmap.html`](seo-toolkit-roadmap.html). Prompt giao việc: [`seo-toolkit-v0.1-handoff.md`](seo-toolkit-v0.1-handoff.md).

Nhánh `feat/seo-toolkit`, worktree `D:\outsource\salanca\salanca-seo`, tách từ `feat/ordering` tại `f74d655`. Gộp về `feat/ordering` khi gate xong, **không** vào `main`.

## Ghi chú cho AI thực hiện (đọc trước)

- Làm đúng từng bước theo thứ tự. Xong mỗi bước thì chạy phần "Verification" của bước đó rồi mới sang bước sau.
- Chạy `git status --short` trước khi sửa. Cây làm việc chỉ có các file docs SEO chưa commit (và thư mục `.commandcode/` của công cụ khác, không đụng). Không đụng file ngoài phạm vi từng bước. Không sửa `docs/STATUS.md`.
- Plugin `src/plugins/seo-toolkit` **không được import** `src/domain`, `src/api`, `src/plugins/ordering` hay bất cứ mã Salanca nào. Không ghi cứng UID content type của Salanca trong plugin (UID Salanca chỉ nằm ở `config/plugins.ts`).
- Chuỗi hiển thị (thông điệp lỗi, nhãn) có bản `vi` và `en`, đặt trong `shared/messages.ts`. Không ghi tiếng Việt cứng ở nơi khác trong server. Tên action quyền bằng tiếng Anh.
- Engine là **hàm thuần** (không gọi Strapi, không đọc giờ hay biến môi trường). Mọi thứ phụ thuộc Strapi nằm ở `collector` và `services`.
- Audit **chỉ đọc**: không ghi DB, không gọi dịch vụ ngoài.
- Không SQL thô. Không thêm content type, không thêm migration (v0.1 không lưu gì).
- Gặp chỗ plan mâu thuẫn với code hoặc với spec: dừng, ghi vào "Điều lệch kế hoạch" cuối file, và chỉ hỏi chủ dự án nếu nó đổi phạm vi, bảo mật hoặc dữ liệu. Không tự đoán.
- Lệnh viết cho PowerShell. Trình quản lý gói: `pnpm`.
- Phạm vi gate là gọn (lint, typecheck, unit, script của phase). **Không** chạy toàn bộ bộ test, không chạy `check:phase3` hay `smoke:*`.

## Goal

`pnpm run seo:audit` và `POST /seo-toolkit/audit/run` trả danh sách lỗi SEO nhìn thấy được trong dữ liệu CMS theo `uid + documentId + locale`, từ plugin local tổng quát, bật bằng `SEO_TOOLKIT_ENABLED` (mặc định tắt). Chi tiết hành vi: spec.

## Non-goals

- Canonical, sitemap, robots, trang đã render (v0.3). Màn admin, lưu kết quả, điểm tổng, bỏ qua lỗi có lý do (v0.2, v0.11).
- Gói Next.js, đổi `robots.ts` của Salanca (v0.4). Đổi schema, seed hay content type của Salanca.
- `docs/STATUS.md` (ghi khi gộp), `AGENTS.md` (dòng ngoại lệ chỉ cần từ v0.2 khi có màn admin custom).
- Content type, bảng, migration, cron, middleware Document Service.

## Current evidence (đã đọc code ngày 2026-10-16)

Số dòng gần đúng ở `f74d655`; tìm theo tên nếu lệch.

**Khung ordering để nhân bản** (đọc, không import)
- `src/plugins/ordering/package.json`: `strapi: { kind, name, displayName, description }`, `exports` có `./strapi-server` (`require` trỏ `./dist/server/src/index.js`), `./package.json`, `peerDependencies` `@strapi/strapi` và `@strapi/utils` `^5.51.1`, script `build: tsc -p server/tsconfig.json`.
- `server/tsconfig.json`: CommonJS, `rootDir ".."`, `outDir "../dist"`, `include ["src/**/*.ts", "../shared/**/*.ts"]`, `exclude` file test. Đầu ra là `dist/server/src/**` cạnh `dist/shared/**`.
- `scripts/ordering/build-server.mjs`: xóa `dist`, chạy `pnpm exec tsc -p <plugin>/server/tsconfig.json`.
- `server/src/index.ts`: export default `{ register, bootstrap, destroy, config, contentTypes, routes, controllers, services, policies, middlewares }`.
- `server/src/config/index.ts`: export default `{ default: {...}, validator(config) { ... throw new Error(...) } }`; schema bằng `import { z } from '@strapi/utils'`; map theo mã, không dùng mảng (Strapi gộp mảng theo chỉ số).
- `server/src/routes/index.ts`: export default `{ admin: { type: 'admin', routes: [{ method, path, handler: 'controller.method', config: { policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::<name>.<uid>'] } }] } }] } }`.
- `server/src/register.ts` (dòng ~108 và ~680): mảng `adminActions` rồi `strapi.admin.services.permission.actionProvider.registerMany(adminActions.map((a) => ({ section: 'plugins', pluginName: 'ordering', ...a })))`.
- Service: file export default `({ strapi }: { strapi: Core.Strapi }) => ({ ... })`, gom trong `services/index.ts` (`'audit-log': auditLog`); controller cùng kiểu, gọi `strapi.plugin('ordering').service('audit-log')`.
- Test mẫu `strapi` giả: `services/provider-status.test.ts` (`makeStrapi(...) as unknown as Core.Strapi`).

**Host (Salanca)**
- `package.json`: `"build": "pnpm run build:ordering && strapi build"`, `"dev"` và `"develop"` cùng dạng, `"build:ordering"`, `"typecheck:admin": "tsc -p tsconfig.ordering-admin.json"`, `"check:ordering"`.
- `tsconfig.json` gốc **loại** `src/plugins/**` và file test, nên `pnpm run typecheck` không phủ plugin.
- `vitest.config.ts`: `include ['config/**/*.test.ts', 'src/**/*.test.ts', 'scripts/**/*.test.ts']`, `passWithNoTests: false` (đường dẫn lọc không khớp file test nào thì vitest báo lỗi).
- `config/plugins.ts`: `resolveOrderingPluginConfig(env, serverEntryExists = fs.existsSync(path.resolve(process.cwd(), p)))` (dòng ~98) ném lỗi khi `enabled` mà thiếu `dist/server/src/index.js`; kết quả gắn ở khóa `ordering: resolveOrderingPluginConfig(env)` (dòng ~362). Test: `config/plugins.test.ts` gọi `resolveOrderingPluginConfig(env, () => true)`.
- `scripts/lib/strapi-load.mjs` export `loadStrapiApp()`; mẫu dùng và tắt app: `scripts/create-preview-token.mjs` (`const app = await loadStrapiApp(); try {...} finally { await app.destroy(); process.exit(...) }`).
- i18n: `strapi.plugin('i18n').service('locales').find()` (trả `{ code }[]`) và `.getDefaultLocale()`; `strapi.plugin('i18n').service('content-types').isLocalizedContentType(model)`.
- Component `shared.seo` (`src/components/shared/seo.json`): `metaTitle` (≤60, bắt buộc, i18n), `metaDescription` (≤160, bắt buộc, i18n), `shareImage` (media, một ảnh), `canonicalPath`, `noIndex` (boolean, bắt buộc). 13 content type mang nó: `home-page, menu-page, story-page, space-page, experience-page, campaign-page, booking-page, contact-page, campaign, menu-category, menu-package, location, global-setting`. Tất cả có `draftAndPublish: true` và i18n. Khối `contentTypes` của Salanca cuối cùng chỉ khai 12 (bỏ `global-setting`; xem "Điều lệch" mục 16).

**Document Service (đọc `@strapi/core` 5.51.1, chưa chạy thật)**
- `strapi.documents(uid).findMany({ status, locale, populate, start, limit, sort })`. `locale: '*'` lấy mọi ngôn ngữ cho type i18n; type không i18n bỏ qua `locale`. Không có `limit` mặc định ở lớp này.
- `required` chỉ ép khi không phải bản nháp (`required: !options.isDraft && attr.required` trong `entity-validator`).

## Decisions and assumptions

- Đã chốt: D1 plugin local, D5 local trước (chủ dự án, 2026-10-16, giao mình xử lý). v0.1 không lưu gì.
- Quyết định thiết kế (đã ghi trong spec): cấu hình map theo UID; kiểm schema ở `bootstrap` là mềm (log lỗi, không sập CMS); `locale` của type không i18n là `null`; `fields.image` và `fields.noIndex` đặt `null` được.
- Giả định A1: single type đọc bằng `findMany` trả đúng một bản ghi mỗi ngôn ngữ. Kiểm ở bước 7. Nếu sai: dùng `findFirst` theo từng ngôn ngữ trong collector.
- Giả định A2: populate `{ [seoField]: { populate: { [image]: true } } }` trả `alternativeText`. Kiểm ở bước 7. Nếu sai: ghi lại, chuyển sang populate `fields: ['alternativeText', 'url']` hoặc truy vấn thêm bảng file, và ghi vào "Điều lệch kế hoạch".
- Không có câu hỏi nào cần chủ dự án trả lời để bắt đầu.

## Invariants

- Với `SEO_TOOLKIT_ENABLED` tắt (mặc định), cấu hình plugin, route, cron, menu hiện có không đổi.
- Plugin không import mã app; không ghi vào bảng của app; không đổi schema Salanca.
- Báo cáo chỉ chứa mã và tham số, không câu chữ. Cùng đầu vào cho cùng đầu ra (đã sắp xếp xác định).
- Lỗi cấu hình schema không làm Strapi dừng khởi động.

## Hợp đồng kiểu (viết đúng tên này, `shared/audit/types.ts`)

```ts
export type Severity = 'error' | 'warn' | 'notice';
export type ConfiguredSeverity = Severity | 'off';
export type AuditStatus = 'published' | 'draft';

export const RULE_CODES = [
  'seo.block-missing',
  'seo.title-missing',
  'seo.description-missing',
  'seo.title-too-long',
  'seo.description-too-long',
  'seo.title-duplicate',
  'seo.description-duplicate',
  'i18n.translation-missing',
  'media.share-image-missing',
  'media.share-image-alt-missing',
  'seo.noindex-set',
] as const;
export type RuleCode = (typeof RULE_CODES)[number];

/** Một đơn vị kiểm: (document, ngôn ngữ). `locale` là null với content type không i18n. */
export interface AuditEntry {
  uid: string;
  documentId: string;
  locale: string | null;
  localized: boolean;
  label: string | null;
  seoField: string; // tên field component, dùng cho `field` của lỗi block-missing
  seo: AuditSeo | null; // null = không có khối SEO
}
export interface AuditSeo {
  title: string | null;
  description: string | null;
  /** undefined = web không có field ảnh; null = có field nhưng chưa chọn ảnh. */
  image: { alternativeText: string | null } | null | undefined;
  /** undefined = web không có field noIndex. */
  noIndex: boolean | null | undefined;
}

export interface AuditFieldNames { title: string; description: string; image: string | null; noIndex: string | null }
export interface AuditOptions {
  status: AuditStatus;
  /** Ngôn ngữ cấu hình trong phạm vi lần chạy (đã lọc theo `locales` nếu có). */
  locales: string[];
  limits: { title: number; description: number };
  severities: Partial<Record<RuleCode, ConfiguredSeverity>>;
  fields: AuditFieldNames;
}

export interface AuditIssue {
  code: RuleCode;
  severity: Severity;
  uid: string;
  documentId: string;
  locale: string | null;
  label: string | null;
  field: string | null;
  params: Record<string, string | number | boolean | null | Array<Record<string, string | null>> | string[]>;
}
export interface AuditReport {
  generatedAt: string; // truyền vào từ ngoài (engine không đọc giờ)
  scope: { status: AuditStatus; locales: string[]; contentTypes: string[] };
  summary: { entries: number; error: number; warn: number; notice: number };
  issues: AuditIssue[];
}
export function runAudit(entries: AuditEntry[], options: AuditOptions, meta: { generatedAt: string; contentTypes: string[] }): AuditReport;
```

Mức mặc định (`DEFAULT_SEVERITY` trong `rules.ts`): `block-missing`, `title-missing`, `description-missing` = `error`; `title-too-long`, `description-too-long`, `title-duplicate`, `description-duplicate`, `translation-missing`, `noindex-set` = `warn`; `share-image-missing`, `share-image-alt-missing` = `notice`.

## Thuật toán engine (bắt buộc đúng thứ tự)

1. Với mỗi entry: nếu `seo === null` thêm `seo.block-missing` (`field = entry.seoField`) và **bỏ qua** các quy tắc 2 đến 6 cho entry đó.
2. Title: thiếu (`null` hoặc rỗng sau `trim`) thì `seo.title-missing` (`field = fields.title`); ngược lại nếu `Array.from(trim).length > limits.title` thì `seo.title-too-long` với `params { length, limit }`.
3. Description: tương tự với `seo.description-missing` và `seo.description-too-long`.
4. Ảnh (chỉ khi `seo.image !== undefined`): `null` thì `media.share-image-missing`; có ảnh mà `alternativeText` rỗng sau `trim` thì `media.share-image-alt-missing`. `field = fields.image`.
5. noIndex (chỉ khi `seo.noIndex !== undefined`): `=== true` thì `seo.noindex-set`, `field = fields.noIndex`.
6. Trùng: nhóm các entry có title không rỗng và `noIndex !== true` theo khóa `(locale ?? '') + '\u0000' + normalize(title)`, `normalize = trim → thay mọi chuỗi khoảng trắng bằng một dấu cách → toLowerCase`. Nhóm có từ hai entry trở lên thì **mỗi** entry nhận `seo.title-duplicate` với `params { count: sizeNhóm - 1, others: tối đa 5 {uid, documentId, locale, seoField} của các entry khác, đã sắp theo (uid, documentId, locale, seoField) }`. Làm tương tự cho description.
7. Thiếu bản dịch (chỉ entry `localized`): nhóm theo `(uid, documentId)`; tập `present` = các `locale` của nhóm. Với mỗi `options.locales` không nằm trong `present`, khi `present` không rỗng, thêm **một** lỗi `i18n.translation-missing` mang `uid, documentId, locale = locale thiếu, label = label của một entry bất kỳ trong nhóm (lấy theo ngôn ngữ đầu tiên theo thứ tự chữ)`, `params { locale, sourceLocales: present đã sắp }`, `field = null`.
   Lưu ý: lỗi này không gắn với một entry sẵn có, nên không cần `seo !== null`.
8. Áp mức: mức = `options.severities[code] ?? DEFAULT_SEVERITY[code]`; `off` thì bỏ lỗi.
9. Sắp xếp: `error` trước rồi `warn` rồi `notice`; sau đó theo `uid`, `documentId`, `locale ?? ''`, `code`, `field ?? ''` (so chuỗi bằng `<`/`>` thuần, không dùng `localeCompare` để kết quả không phụ thuộc môi trường).
10. `summary.entries` = số entry đầu vào; `error/warn/notice` = số lỗi theo mức sau bước 8. `scope` lấy từ `meta` và `options`.

## Thông điệp (`shared/messages.ts`)

`formatMessage(code, params, lang): string` thay `{tên}` bằng `String(params[tên])`, tên không có trong `params` thì giữ nguyên `{tên}`. `lang` là `'vi' | 'en'`. Phải có đủ 11 mã cho cả hai ngôn ngữ (test kiểm).

| Mã | vi | en |
| --- | --- | --- |
| `seo.block-missing` | Chưa có khối SEO | SEO block is missing |
| `seo.title-missing` | Thiếu tiêu đề SEO | SEO title is missing |
| `seo.description-missing` | Thiếu mô tả SEO | SEO description is missing |
| `seo.title-too-long` | Tiêu đề SEO dài {length} ký tự, vượt mức {limit} | SEO title is {length} characters, over the {limit} limit |
| `seo.description-too-long` | Mô tả SEO dài {length} ký tự, vượt mức {limit} | SEO description is {length} characters, over the {limit} limit |
| `seo.title-duplicate` | Tiêu đề SEO trùng với {count} mục khác | SEO title is shared with {count} other entries |
| `seo.description-duplicate` | Mô tả SEO trùng với {count} mục khác | SEO description is shared with {count} other entries |
| `i18n.translation-missing` | Thiếu bản dịch {locale} | Missing {locale} translation |
| `media.share-image-missing` | Chưa có ảnh chia sẻ | Share image is missing |
| `media.share-image-alt-missing` | Ảnh chia sẻ thiếu văn bản thay thế (alt) | Share image has no alt text |
| `seo.noindex-set` | Mục đang đặt không index (noIndex) | Entry is set to noIndex |

## Implementation steps

### Bước 0: môi trường và baseline

- Trong worktree: `git status --short` (chỉ file docs SEO chưa commit), `git log --oneline -1` (phải là `f74d655` hoặc con của nó).
- `pnpm install --frozen-lockfile`. **Không** sửa `.npmrc`, `pnpm-workspace.yaml`. Nếu bị chặn vì `@tanngo11/log` mới phát hành (`minimumReleaseAge`), dừng và báo chủ dự án; không tự hạ ngưỡng.
- Baseline trước khi sửa: `pnpm run build:ordering`, `pnpm run typecheck`, `pnpm exec vitest run config/plugins.test.ts`. Ghi kết quả (đạt hoặc lỗi sẵn có) vào Completion record để phân biệt lỗi mình gây ra.
- Verification: ba lệnh trên chạy xong; mọi lỗi sẵn có được ghi lại.

### Bước 1: khung plugin, build, cổng bật

- Files:
  - `src/plugins/seo-toolkit/package.json` (nhân bản ordering: `name: "strapi-plugin-seo-toolkit"`, `version 0.0.0`, `private: true`, `strapi: { kind: 'plugin', name: 'seo-toolkit', displayName: 'SEO toolkit', description }`, `exports` chỉ `./strapi-server` và `./package.json`, `peerDependencies` như ordering).
  - `src/plugins/seo-toolkit/server/tsconfig.json` (sao chép của ordering, giữ `rootDir ".."`).
  - `src/plugins/seo-toolkit/server/src/index.ts` (export default đủ các khóa như ordering; khóa chưa dùng để `{}`; `contentTypes: {}`).
  - `scripts/seo-toolkit/build-server.mjs` (sao chép `scripts/ordering/build-server.mjs`, đổi đường dẫn thành `src/plugins/seo-toolkit`).
  - `tsconfig.seo-toolkit.json` ở gốc: `extends ./src/plugins/seo-toolkit/server/tsconfig.json`, `compilerOptions: { noEmit: true, incremental: false, rootDir: "." }`, `include: ["src/plugins/seo-toolkit/server/src/**/*.ts", "src/plugins/seo-toolkit/shared/**/*.ts"]`, `exclude: []` (để typecheck cả file test; vitest cung cấp kiểu cho `describe/it/expect` qua import).
  - `package.json` gốc: sửa đúng ba dòng `build`, `dev`, `develop` thành `pnpm run build:ordering && pnpm run build:seo-toolkit && ...`; thêm `build:seo-toolkit`, `typecheck:seo-toolkit` (`tsc -p tsconfig.seo-toolkit.json`), `check:seo-toolkit` (`pnpm run build:seo-toolkit && pnpm run typecheck:seo-toolkit && vitest run src/plugins/seo-toolkit config/plugins.test.ts`), `seo:audit` (`pnpm run build:seo-toolkit && node scripts/seo-toolkit/audit.mjs`). Không đổi gì khác.
  - `config/plugins.ts`: thêm `seoToolkitPluginPath = './src/plugins/seo-toolkit'`, `resolveSeoToolkitPluginConfig(env, serverEntryExists = ...)` (cùng chữ ký và cách ném lỗi như ordering; biến `SEO_TOOLKIT_ENABLED`, thông báo lỗi nhắc `pnpm run build:seo-toolkit`), gắn khóa `'seo-toolkit': resolveSeoToolkitPluginConfig(env)` cạnh khóa `ordering:` trong kết quả `config()`. Khối cấu hình Salanca để bước 8.
  - `config/plugins.test.ts`: thêm ca kiểm (xem bảng test cấu hình bên dưới).
- Verification: `pnpm run build:seo-toolkit` tạo `src/plugins/seo-toolkit/dist/server/src/index.js`; `pnpm exec vitest run config/plugins.test.ts` đạt.

### Bước 2: kiểu, thông điệp và engine (viết test trước)

- Files: `shared/audit/{types.ts,rules.ts,engine.ts,engine.test.ts}`, `shared/messages.ts`, `shared/messages.test.ts` (đường dẫn dưới `src/plugins/seo-toolkit/`).
- Làm theo "Hợp đồng kiểu", "Thuật toán engine" và "Thông điệp" ở trên. Viết `engine.test.ts` trước theo bảng test engine, chạy thấy đỏ, rồi viết engine.
- Verification: `pnpm exec vitest run src/plugins/seo-toolkit/shared` đạt hết.

### Bước 3: cấu hình, validator, mặc định

- Files: `server/src/config/{index.ts,index.test.ts}`.
- Hình dạng (dùng `z` của `@strapi/utils`), mặc định:
  ```ts
  default: {
    contentTypes: {},                       // Record<uid, { seoField?: string; labelField?: string }>
    fields: { title: 'metaTitle', description: 'metaDescription', image: 'shareImage', noIndex: 'noIndex' },
    status: 'published',
    limits: { title: 60, description: 160 },
    severities: {},                         // Partial<Record<RuleCode, 'error'|'warn'|'notice'|'off'>>
  }
  ```
  `fields.image` và `fields.noIndex` cho phép `null`. `contentTypes` phải là object (mảng bị từ chối với đường dẫn khóa). `severities` chỉ nhận mã trong `RULE_CODES` (khóa lạ bị từ chối). `limits` là số nguyên dương. `validator` ném `Error` với dạng thông báo `đường.dẫn: lý do` như ordering.
- Export kiểu `SeoToolkitConfig`.
- Verification: `pnpm exec vitest run src/plugins/seo-toolkit/server/src/config` đạt (bảng test cấu hình).

### Bước 4: collector (Strapi → AuditEntry)

- Files: `server/src/collector/{collect.ts,collect.test.ts,inspect.ts,inspect.test.ts}`.
- `inspect.ts`: `inspectConfig(strapi, config) → { problems: string[] }` kiểm theo schema: với mỗi UID, `strapi.contentType(uid)` tồn tại; `attributes[seoField]` là `type: 'component'` và `repeatable !== true`; `strapi.components[attr.component].attributes` có `fields.title` và `fields.description`, và có `fields.image` (loại `media`) cùng `fields.noIndex` (loại `boolean`) khi chúng khác `null`; `labelField` (nếu có) là thuộc tính chuỗi. Mỗi vấn đề là một chuỗi mô tả (tiếng Anh, có UID).
- `collect.ts`: `collectEntries(strapi, config, run) → Promise<{ entries: AuditEntry[]; locales: string[] }>`.
  - Ngôn ngữ cấu hình: `strapi.plugin('i18n').service('locales').find()` lấy `code`, lọc theo `run.locales` nếu có; sắp xếp.
  - Với mỗi UID (đã lọc theo `run.contentTypes`): `localized = strapi.plugin('i18n').service('content-types').isLocalizedContentType(strapi.contentType(uid))`.
  - Đọc phân trang tường minh: `pageSize = 100`; vòng lặp `start += pageSize` đến khi trang trả ít hơn `pageSize`; tham số `{ status: run.status, populate: { [seoField]: { populate: image ? { [image]: true } : undefined } }, start, limit: pageSize, sort: ['id:asc'], ...(localized ? { locale: '*' } : {}) }`. Khi `fields.image` là `null` thì populate chỉ `{ [seoField]: true }`.
  - Chuẩn hóa mỗi hàng thành `AuditEntry` (`locale = localized ? row.locale : null`; `label` = giá trị chuỗi của `labelField` hoặc `null`; `seo` theo mục 3b của spec). Hàng của ngôn ngữ ngoài phạm vi `locales` bị bỏ.
  - Không để lỗi của một UID giấu lỗi của UID khác: lỗi đọc ném ra kèm UID.
- Test (`strapi` giả): phân trang qua nhiều trang (250 hàng, `pageSize` 100); type i18n gọi với `locale: '*'`, type không i18n thì không truyền `locale` và trả `locale: null`; `status` truyền xuống đúng; chuẩn hóa `seo` (null, thiếu title, ảnh `null`, ảnh có alt rỗng, `noIndex` thiếu field); lọc theo `locales` và `contentTypes`; `inspectConfig` bắt UID không tồn tại, `seoField` không phải component, component thiếu field.
- Verification: `pnpm exec vitest run src/plugins/seo-toolkit/server/src/collector` đạt.

### Bước 5: service, controller, route, quyền, bootstrap

- Files: `server/src/services/{index.ts,audit.ts,audit.test.ts}`, `server/src/controllers/{index.ts,audit.ts}`, `server/src/routes/{index.ts,index.test.ts}`, `server/src/register.ts`, `server/src/bootstrap.ts`, cập nhật `server/src/index.ts`.
- `bootstrap.ts`: đọc `strapi.config.get('plugin::seo-toolkit')`, chạy `inspectConfig`; có vấn đề thì `strapi.log.error('[seo-toolkit] invalid config: ...')` cho từng vấn đề và lưu danh sách vào `strapi.plugin('seo-toolkit').service('audit').setConfigProblems(problems)`; **không ném**. Không vấn đề thì `strapi.log.info('[seo-toolkit] ready: N content types')`.
- `services/audit.ts`: `run({ status?, contentTypes?, locales? })`: nếu còn `configProblems` thì ném `errors.ValidationError` (từ `@strapi/utils`) gộp các vấn đề; `contentTypes` chứa UID không khai báo thì `ValidationError`; gọi `collectEntries` rồi `runAudit` với `generatedAt: new Date().toISOString()` (chỗ duy nhất đọc giờ); trả `AuditReport`. Mặc định `status` lấy từ cấu hình.
- `controllers/audit.ts`: `run(ctx)` parse `ctx.request.body` (có thể rỗng) bằng `z.object({ status: z.enum(['published','draft']).optional(), contentTypes: z.array(z.string()).optional(), locales: z.array(z.string()).optional() })`; sai thì `ValidationError`; `ctx.body = await service.run(...)`.
- `routes/index.ts`: một route admin `POST /audit/run` → `audit.run`, policies `admin::isAuthenticatedAdmin` và `admin::hasPermissions` với `plugin::seo-toolkit.audit.run`.
- `register.ts`: `registerMany([{ section: 'plugins', pluginName: 'seo-toolkit', uid: 'audit.run', displayName: 'Run SEO audit' }])`.
- Test: route test kiểm đúng một route, method POST, đủ hai policy, đúng tên action; service test với collector/engine giả (gọi đúng thứ tự, mặc định `status`, lỗi khi còn `configProblems`, lỗi khi `contentTypes` lạ).
- Verification: `pnpm run build:seo-toolkit` và `pnpm exec vitest run src/plugins/seo-toolkit/server` đạt.

### Bước 6: định dạng CLI và lệnh `seo:audit`

- Files: `shared/cli.ts`, `shared/cli.test.ts`, `scripts/seo-toolkit/audit.mjs`.
- `shared/cli.ts`: `parseFailOn(value)`, `exitCodeFor(report, failOn): 0 | 1`, `formatTable(report, lang): string`.
  - `exitCodeFor`: `never` luôn 0; `error` → 1 khi `summary.error > 0`; `warn` → 1 khi `error + warn > 0`; `notice` → 1 khi có bất kỳ lỗi nào.
  - `formatTable`: dòng đầu `SEO audit (status=published, locales=vi,en, entries=42)`; mỗi lỗi một dòng `[ERROR] <uid>  <documentId>  <locale|->  <thông điệp>  (<mã>)` (thông điệp dịch theo `lang`, thêm `label` trong ngoặc nếu có); dòng cuối `error: X  warn: Y  notice: Z`; không có lỗi thì dòng `No issues.` (en) hoặc `Không có lỗi.` (vi).
- `scripts/seo-toolkit/audit.mjs`: dùng `node:util parseArgs` với `--json`, `--fail-on` (`error|warn|notice|never`, mặc định `error`), `--status` (`published|draft`), `--lang` (`vi|en`, mặc định `en`). Tải `shared/cli.js` và `shared/messages.js` từ `src/plugins/seo-toolkit/dist/shared/` bằng `createRequire`. Luồng: `loadStrapiApp()` → nếu `app.plugin('seo-toolkit')` không có thì in lý do (`SEO_TOOLKIT_ENABLED` chưa bật) ra stderr, mã 2 → `service('audit').run({ status })` → `--json` in `JSON.stringify(report, null, 2)` ra stdout, nếu không thì in `formatTable` → `process.exitCode = exitCodeFor(...)`. Mọi lỗi (cấu hình sai, không đọc được DB, tham số sai) in một dòng ra stderr, mã 2. Luôn `app.destroy()` rồi `process.exit(process.exitCode ?? 0)` như `create-preview-token.mjs`. Thông tin ra stdout chỉ là báo cáo; log khởi động của Strapi ở stderr hoặc bị nuốt như các script hiện có.
- Verification: `pnpm exec vitest run src/plugins/seo-toolkit/shared/cli.test.ts` đạt; `node scripts/seo-toolkit/audit.mjs --bogus` thoát mã 2 mà không khởi động Strapi (kiểm tham số trước khi tải app).

### Bước 7: chạy thật trên DB local (A1, A2) và dry-run Salanca

- Cần Postgres local và `.env` thường dùng của dev. **Không** đặt `ORDERING_ENABLED`. Audit chỉ đọc; khởi động Strapi làm các việc bootstrap thường lệ của app.
- Nếu không có DB: ghi chính xác lý do chặn vào Completion record, đánh dấu A1, A2 là "chưa chạy thật", không coi bước này qua.
- `$env:SEO_TOOLKIT_ENABLED='true'; pnpm run seo:audit -- --lang=vi` và thêm `--status=draft`, `--json`. Ghi: tổng entry, số lỗi mỗi mức, từng mã xuất hiện, các lỗi `error`.
- Kiểm A1 (single type trả một bản ghi mỗi ngôn ngữ: so số entry của 8 single type với 8 × số ngôn ngữ) và A2 (`share-image-alt-missing` xuất hiện đúng với ảnh có và không có alt trong Admin). Sai thì xử lý như ghi ở "Decisions and assumptions".
- Mở trong Admin vài lỗi `error` và vài lỗi `warn` để xác nhận là thật. Ghi dương tính giả và loại nội dung nào có vẻ không phải trang thật (đặc biệt `global-setting`, `menu-package`). **Không tự bỏ UID nào**; chủ dự án quyết.
- Kiểm mã thoát: sạch hoặc `--fail-on=never` ra 0; còn lỗi `error` ra 1; để `SEO_TOOLKIT_ENABLED` tắt ra 2.

### Bước 8: khối Salanca, README, tài liệu

- `config/plugins.ts`: trong `resolveSeoToolkitPluginConfig` thêm `config.contentTypes` có 12 UID ở mục Current evidence (dạng `{}` hoặc `{ labelField: '...' }`; đọc `schema.json` của từng type và chỉ đặt `labelField` khi có thuộc tính chuỗi phù hợp như `slug`, ưu tiên `slug`; bỏ `global-setting` — xem "Điều lệch" mục 16). Giữ `fields` mặc định (khớp `shared.seo`) và `status: 'published'`.
- `src/plugins/seo-toolkit/README.md`: bật plugin, bảng cấu hình (khóa, mặc định, ý nghĩa), bảng 11 mã lỗi và mức mặc định, cách chạy lệnh và API, mã thoát, ranh giới (không import mã app, chỉ đọc, không lưu gì), cách thêm một web mới (khai báo `contentTypes`, bật env, chạy `seo:audit`).
- `docs/README.md`: thêm liên kết tới README plugin, spec và plan. `docs/cms-technical-decisions.md`: thêm một mục ngắn "Plugin SEO toolkit (local, tổng quát, v0.1 chỉ đọc, không lưu)".
- Verification: các lệnh ở mục Verification đạt; `git diff --check` sạch.

### Bước 9: cổng cuối và bản ghi

- Chạy lần lượt các lệnh ở mục Verification, ghi kết quả vào Completion record. `git status --short` để xác nhận chỉ có file trong phạm vi. **Không commit** trừ khi chủ dự án nói. Không đánh dấu hoàn thành khi UAT thủ công còn mở.

## Bảng test engine (`engine.test.ts`; mỗi dòng là một ca)

| Ca | Đầu vào chính | Kỳ vọng |
| --- | --- | --- |
| block null | `seo: null` | đúng một lỗi `seo.block-missing` (`field = seoField`), không lỗi title/description/ảnh/noIndex |
| title thiếu | `title: null`; `'   '`; `''` | `seo.title-missing` cho cả ba |
| title đúng ngưỡng | độ dài bằng `limits.title` | không `title-too-long` |
| title vượt 1 ký tự | độ dài `limit + 1` | `title-too-long`, `params { length: limit+1, limit }` |
| title có ký tự ngoài BMP | 30 emoji | độ dài 30 (code point), không 60 |
| description thiếu / quá dài | tương tự title | mã `description-*` |
| ảnh `undefined` | host không có field ảnh | không lỗi media |
| ảnh `null` | field có, chưa chọn | `media.share-image-missing` (`notice`) |
| ảnh có alt rỗng | `alternativeText: '  '` | `media.share-image-alt-missing` |
| ảnh có alt | `alternativeText: 'x'` | không lỗi |
| noIndex `undefined` | host không có field | không `noindex-set` |
| noIndex `true` / `false` / `null` | | chỉ `true` sinh `seo.noindex-set` (`warn`) |
| trùng title | hai entry cùng `vi`, title khác hoa thường và khoảng trắng | mỗi entry một `title-duplicate`, `count: 1`, `others` chứa entry kia |
| trùng khác ngôn ngữ | cùng title ở `vi` và `en` | không trùng |
| trùng với entry noIndex | một trong hai noIndex | không trùng |
| trùng title rỗng | hai entry title rỗng | chỉ `title-missing`, không `title-duplicate` |
| nhóm trùng 7 entry | | `count: 6`, `others` đúng 5 phần tử đã sắp |
| thiếu bản dịch | document i18n chỉ có `vi`, `options.locales = ['vi','en']` | một `translation-missing` ở `en`, `sourceLocales: ['vi']` |
| không thiếu | có cả hai ngôn ngữ | không lỗi |
| type không i18n | `localized: false` | không `translation-missing` |
| phạm vi ngôn ngữ | `options.locales = ['vi']` | không báo thiếu `en` |
| severities đổi mức | `{ 'seo.noindex-set': 'notice' }` | lỗi ra mức `notice`, `summary` khớp |
| severities off | `{ 'seo.title-too-long': 'off' }` | lỗi biến mất khỏi `issues` và `summary` |
| sắp xếp | trộn nhiều mức/uid/locale | đúng thứ tự mục 9 của thuật toán; chạy hai lần cho kết quả bằng nhau, và xáo trộn đầu vào cho cùng đầu ra |
| cấu hình giả | `uid: 'api::widget.widget'`, `locales: ['fr','de']`, `fields` tên khác | engine chạy đúng, không phụ thuộc tên Salanca (G1, G4) |
| `summary.entries` | 5 entry đầu vào | `entries: 5` |

## Bảng test cấu hình

| Ca | Kỳ vọng |
| --- | --- |
| mặc định | `validator(default)` không ném |
| `contentTypes` là mảng | ném, thông báo chứa `contentTypes` |
| `limits.title` bằng 0 hoặc âm hoặc không nguyên | ném, chứa `limits.title` |
| `severities` có mã lạ | ném, chứa mã đó |
| `severities` giá trị lạ | ném |
| `fields.image: null` và `fields.noIndex: null` | không ném |
| `fields.title` rỗng | ném |
| `resolveSeoToolkitPluginConfig` tắt (mặc định) | `enabled: false`, không ném dù thiếu `dist` |
| bật mà thiếu `dist` | ném, thông báo chứa `build:seo-toolkit` |
| bật và có `dist` | `enabled: true`, `resolve: './src/plugins/seo-toolkit'`, `config.contentTypes` có 12 khóa |

## Data and rollback

- Migration/backfill: không. Không content type, không bảng mới.
- Compatibility: không đổi API công khai, schema, seed hay quyền hiện có. Action `plugin::seo-toolkit.audit.run` chỉ xuất hiện khi plugin bật.
- Rollback: `SEO_TOOLKIT_ENABLED` tắt (mặc định) là đủ. Gỡ hẳn: xóa `src/plugins/seo-toolkit`, `scripts/seo-toolkit`, `tsconfig.seo-toolkit.json`, khối `config/plugins.ts`, các script và đoạn `pnpm run build:seo-toolkit &&` trong `package.json`. Không có dữ liệu để dọn.

## Verification (gọn, đúng phạm vi)

- `pnpm run build:seo-toolkit`
- `pnpm run typecheck` và `pnpm run typecheck:seo-toolkit`
- `pnpm exec eslint src/plugins/seo-toolkit scripts/seo-toolkit config/plugins.ts config/plugins.test.ts`
- `pnpm exec vitest run src/plugins/seo-toolkit config/plugins.test.ts`
- `pnpm run check:seo-toolkit`
- Bước 7 (chạy thật trên DB local) và `git diff --check`.
- Manual UAT (chủ dự án): xem báo cáo thật ở Completion record, xác nhận dương tính giả, quyết định giữ hay bỏ UID nào trong 13.

## Documentation impact

- Mới: README plugin. Sửa: `docs/README.md`, `docs/cms-technical-decisions.md`, roadmap (đã cập nhật D1, D5, v0.1, v0.3).
- Không sửa: `docs/cms-content-model.md` (không đổi schema), `docs/cms-api-contract.md` (route admin, không phải content API), `docs/STATUS.md`, `AGENTS.md`.

## Risks and blockers

- Mới một client nên dễ trừu tượng hóa sai: giữ cấu hình tối thiểu, engine thuần, test cấu hình giả.
- `package.json` là file dùng chung, dễ xung đột khi gộp: chỉ sửa ba dòng có sẵn và thêm bốn script.
- `pnpm install` có thể bị `minimumReleaseAge` chặn bản mới của `@tanngo11/log`: dừng và báo, không tự đổi cấu hình pnpm.
- Không có Postgres local: bước 7 không chạy được; ghi rõ, không coi là qua.
- Dương tính giả làm mất lòng tin vào audit: dry-run và báo cáo cho chủ dự án trước khi chia sẻ với chủ quán.

## Điều lệch kế hoạch

AI thực hiện ghi vào đây mọi chỗ làm khác plan và lý do.

1. **Khối `contentTypes` của Salanca thêm ở bước 8 nhưng đặt trước bước 7.** Bước 7 kiểm A1/A2 cần
   đúng 13 content type đã cấu hình (nếu để trống thì audit ra 0 entry). Kế hoạch để bước 8 mới thêm
   nên thứ tự có mâu thuẫn; đã thêm khối cấu hình trước rồi mới chạy bước 7.
2. **`global-setting` phải đặt `seoField: 'defaultSeo'`.** `schema.json` của type này (và chỉ type
   này) đặt component SEO ở thuộc tính `defaultSeo`, không phải `seo`. Bước 8 của plan dặn chỉ thêm
   `labelField` và giữ mặc định `seo`, nhưng như vậy `inspectConfig` báo lỗi và lệnh thoát mã 2.
   Không bỏ type nào (theo quyết định của chủ dự án); chỉ đổi tên field.
3. **Validator `severities` dùng `z.partialRecord(z.enum(RULE_CODES), ...)` thay vì
   `z.record(z.enum(...), ...)`.** Bản zod trong `@strapi/utils` coi `z.record` với khóa enum là
   exhaustive (đòi đủ 11 mã), nên `severities: {}` bị từ chối. `z.partialRecord` cho đúng ngữ nghĩa
   một phần, và khóa lạ vẫn bị từ chối ở đúng đường dẫn khóa.
4. **Lệnh eslint trong plan gồm `scripts/seo-toolkit` nhưng repo bỏ qua `scripts/**/*.mjs`.**
   ESLint 9 thoát mã 2 khi mọi file khớp một tham số đều bị ignore. Đã lint phần TS
   (`src/plugins/seo-toolkit`, `config/plugins.ts`, `config/plugins.test.ts`) — đạt exit 0; file
   `.mjs` không được lint là đúng theo `eslint.config.mjs` hiện có.
5. **Collector: giá trị `image`/`noIndex` đã cấu hình nhưng thiếu trong dữ liệu được chuẩn hóa
   thành `null`, không phải `undefined`.** `undefined` chỉ dành cho "web không có field ảnh/noIndex"
   (spec 3b); nếu value thiếu mà field có cấu hình thì là "có field nhưng chưa đặt" → `null`.
6. **Bước 7 chưa chạy được trên DB local** (chi tiết ở Completion record).
7. **`server/src/index.ts` xuất `destroy: () => {}`.** Plan chỉ liệt kê các khóa cần có; `destroy`
   để no-op cho đủ hợp đồng plugin, không có gì cần dọn.

### Vòng sửa sau review (2026-10-16, cùng ngày)

8. **`seoField` nhận cả mảng (chọn phương án b).** `menu-page` có hai khối SEO (`seo` + `cateringSeo`),
   và đây là client đầu tiên chứ không phải giả định — nên mỗi khối thành một đơn vị kiểm riêng.
   Thay đổi hợp đồng báo cáo: `AuditIssue` thêm `seoField` (khối sinh ra lỗi; `null` cho lỗi cấp
   document như `translation-missing`), định danh lỗi thành `uid + documentId + locale + seoField`,
   và thứ tự sắp xếp thêm `seoField`. Spec mục 2, 3b, 4, 5, 6 đã cập nhật; README plugin có mục
   "nhiều khối SEO".
9. **`scripts/seo-toolkit/audit.mjs` không còn gán mặc định `--status`.** Trước đây mặc định
   `published` nên ghi đè `config.status` của host; nay bỏ trống `--status` thì truyền `{}` để
   service dùng `config.status`.
10. **Ghi lại giới hạn `i18n.translation-missing` khi lọc `locales`** (đã ghi ở spec 3b): collector
    lọc hàng ngoài phạm vi trước engine nên chạy có lọc có thể sót lỗi thiếu bản dịch. Chưa đường
    chạy nào lọc `locales` (CLI không có cờ này) nên không sửa ở v0.1; ghi để v0.2 hoặc khi mở cờ
    `--locales`. Không đổi hành vi engine lần này.
11. **`--json` chưa tách khỏi log của Strapi.** `@tanngo11/log` ghi log ra **stdout**, không phải
    stderr như plan giả định, nên stdout của `seo:audit` là một loạt dòng log JSON rồi mới tới báo cáo
    (báo cáo là object JSON cuối cùng, giải nén được bằng cách lấy object cuối). Muốn pipe sạch
    (`| jq`) thì phải tách log — ghi để v0.2 vì đụng định tuyến logger của app; v0.1 không sửa.
12. **Bước 7 phải đặt `NODE_ENV=development`.** Shell của công cụ có sẵn `NODE_ENV=production`, làm
    `assertProductionMediaStorage` đòi `S3_BUCKET` và Strapi không khởi động. Đây là môi trường chạy,
    không phải lỗi plugin.

### Vòng sửa sau review lần 2 (2026-10-16)

13. **`others[]` của lỗi trùng thêm `seoField`.** Hai khối SEO của cùng một document (ví dụ `seo` và
    `cateringSeo` của `menu-page`) trùng title/description thì `others` cũ chỉ có `uid + documentId +
    locale`, nên mục này trông như tự trỏ về chính nó. Thêm `seoField` (và `seoField` làm tiebreaker khi
    sắp xếp nhóm) để phân biệt; đây cũng là định danh lỗi đã dùng ở mục 4. Sửa ở `shared/audit/engine.ts`,
    có ca test mới trong `engine.test.ts`. Spec 3b, mục 6 của plan và README plugin đã cập nhật.
14. **CLI bỏ dấu `--` đứng đầu.** pnpm 11.7 chuyển dấu phân cách tham số vào script, nên
    `pnpm run seo:audit -- --json` đến `parseArgs` dưới dạng `['--', '--json']` và bị báo
    `Unexpected argument '--json'`. `audit.mjs` bỏ một `--` đứng đầu trước khi phân tích, đúng như lệnh
    đã ghi trong spec và README.
15. **Thêm `--out=<file>` để lấy báo cáo sạch.** `--json` vẫn lẫn log khởi động/tắt của Strapi trên
    stdout (mục 11); `--out` ghi báo cáo dạng JSON ra file, còn stdout chỉ còn log. Không định tuyến lại
    logger của app (việc của v0.2) nên mục 11 chỉ được giải quyết một phần: đường `| jq` phải dùng file.
16. **Bỏ `global-setting` khỏi `contentTypes` của Salanca (còn 12).** `global-setting.defaultSeo` là SEO
    dự phòng dùng khi trang không có SEO riêng, trùng nội dung với trang chủ là đúng thiết kế, nên nó chỉ
    sinh 4 cảnh báo trùng (`title`/`description` × `vi`/`en`) không thật. Quyết định của chủ dự án
    (2026-10-16). `menu-package` giữ lại vì web có trang `/menu/[section]` và cảnh báo trùng mô tả
    rodizio/buffet là thật. Test cấu hình và `docs/cms-technical-decisions.md` cập nhật theo.

## Completion record

Trạng thái: **implemented** + **automated verification passed** trên nhánh `feat/seo-toolkit`
(worktree `salanca-seo`), **chưa commit**. Bước 7 đã chạy trên DB local, và vòng review lần 2 đã sửa
3 lỗi CLI cùng với việc bỏ `global-setting` (còn 12 content type); **ready for manual UAT** (mở Admin
đối chiếu, gọi route admin, chốt dương tính giả, UAT mã thoát).

### Baseline (bước 0, trước khi sửa)

- `pnpm install --frozen-lockfile`: exit 0 (không vướng `minimumReleaseAge`).
- `pnpm run build:ordering`: exit 0. `pnpm run typecheck`: exit 0.
- `pnpm exec vitest run config/plugins.test.ts`: 17 passed.

### Đã làm (bước 1–9)

- Plugin local `src/plugins/seo-toolkit` (server-only, generic): engine thuần + test (27 ca + 3 ca
  thông điệp), config schema + validator (7 ca), collector + inspect (9 + 6 ca), service/controller/
  route/quyền/bootstrap (1 + 5 ca), CLI thuần + lệnh `seo:audit` (8 ca).
- Cổng build/typecheck/script trong `package.json`; gate bật plugin trong `config/plugins.ts`
  (nhân bản `resolveOrderingPluginConfig`), khối Salanca 13 UID.
- Vòng review: `seoField` nhận mảng (mỗi khối SEO một entry; `menu-page` = `['seo','cateringSeo']`),
  `AuditIssue` thêm `seoField`; CLI không ghi đè `config.status`.
- README plugin; liên kết ở `docs/README.md`; mục quyết định ở `docs/cms-technical-decisions.md`.

### Lệnh đã chạy và kết quả

| Lệnh | Kết quả |
| --- | --- |
| `pnpm run build:seo-toolkit` | exit 0; `dist/server/src/index.js` tồn tại |
| `pnpm run typecheck` | exit 0 |
| `pnpm run typecheck:seo-toolkit` | exit 0 |
| `pnpm exec eslint src/plugins/seo-toolkit config/plugins.ts config/plugins.test.ts` | exit 0 |
| `pnpm exec vitest run src/plugins/seo-toolkit config/plugins.test.ts` | 9 file / 92 passed |
| `pnpm run check:seo-toolkit` | exit 0 |
| `node scripts/seo-toolkit/audit.mjs --bogus` | exit 2, không khởi động Strapi |
| `git diff --check` | sạch (exit 0) |

### Bước 7 — ĐÃ CHẠY trên DB local (2026-10-16)

- Chuẩn bị: copy `.env` dev từ `..\salanca-backend\.env` sang worktree (file gitignore, chưa commit).
  Đặt `NODE_ENV=development` cho lần chạy vì shell của công cụ có sẵn `NODE_ENV=production`, khiến
  `assertProductionMediaStorage` đòi `S3_BUCKET`; audit chỉ đọc nên chế độ dev là đúng.
  `SEO_TOOLKIT_ENABLED=true`, `ORDERING_ENABLED` để mặc định (tắt).
- Lệnh: `pnpm run seo:audit -- --lang=vi --json`.
- Mã thoát kiểm được: lỗi `error` còn → **1**; `--fail-on=never` → **0**; plugin tắt
  (`SEO_TOOLKIT_ENABLED` bỏ trống) → **2** (báo đúng "plugin not loaded"); tham số sai (`--bogus`) → **2**.
- Phạm vi đọc: `status=published`, `locales=[en, vi]`, 13 content type.
- `summary`: **entries 47, error 6, warn 23, notice 41**. Mã xuất hiện: `seo.block-missing` 6,
  `i18n.translation-missing` 3, `seo.description-duplicate` 12, `seo.title-duplicate` 8,
  `media.share-image-missing` 41.
- Lỗi `error` (6):
  - `api::menu-category.menu-category` × 4 — hai document (`thit-nuong`/`grilled-meats`,
    `mon-kem`/`sides`) không có khối `seo`, ở cả vi và en.
  - `api::menu-page.menu-page` × 2 — khối `cateringSeo` trống ở cả vi và en. Đây đúng là loại lỗi mà
    phương án một `seoField` bỏ sót; sau khi nhận mảng, audit đã bắt được.

**A1 — xác nhận.** `findMany({ locale: '*' })` trả đúng một bản ghi mỗi ngôn ngữ cho single type:
8 single type = 2 entry (en, vi); `menu-page` = 4 (2 khối × 2 ngôn ngữ); `global-setting` = 2.
Không cần `findFirst`.

**A2 — xác nhận (qua cơ chế populate tương đương).** DB này chưa đặt ảnh share nào
(41/41 entry có field ảnh = null; `components_shared_seos` không có link ảnh), nên không kiểm trực
tiếp trên `shareImage`. Đã kiểm cùng độ sâu populate `{ <component>: { populate: { <media>: true } } }`
trên `menu-package.image`, `location.heroImage`, `menu-category.image`, `campaign.coverImage`: mọi
media populate trả `alternativeText` thật (ví dụ `client-grill.jpg` → alt `client-grill.jpg`). Vậy
populate ảnh trả `alternativeText`.

Nghi không phải trang thật (chủ dự án quyết, **không tự bỏ UID nào**): `global-setting` (cấu hình
chung, 2 entry) và `menu-package` (5 entry). `media.share-image-missing` × 41 nhiều khả năng là dương
tính giả theo thiết kế (Salanca chưa đặt ảnh share) — mức `notice`. `title-duplicate` /
`description-duplicate` cần mở Admin đối chiếu.

### Vòng sửa sau review lần 2 (2026-10-16)

Sửa 3 lỗi CLI và chốt `global-setting` (xem "Điều lệch" mục 13–16).

| Lệnh | Kết quả |
| --- | --- |
| `pnpm run build:seo-toolkit` | exit 0 |
| `pnpm run typecheck` | exit 0 |
| `pnpm run typecheck:seo-toolkit` | exit 0 |
| `pnpm exec eslint src/plugins/seo-toolkit config/plugins.ts config/plugins.test.ts` | exit 0 |
| `pnpm exec vitest run src/plugins/seo-toolkit config/plugins.test.ts` | 9 file / **93 passed** (thêm 1 ca `others` mang `seoField`) |
| `node scripts/seo-toolkit/audit.mjs -- --bogus` | exit 2, "Unknown option '--bogus'" (xác nhận `--` đã bị bỏ), không khởi động Strapi |
| `pnpm run seo:audit -- --out=…` (đọc-only, DB dev) | exit 1; stdout chỉ có log, không có báo cáo; file JSON sạch |
| `git diff --check` | sạch (exit 0) |

- Chạy thật `--out` trên DB dev: `ready: 12 content types`; báo cáo ghi ra file sạch (bug 1 + bug 2 đạt).
- Báo cáo thật sau khi bỏ `global-setting`: `entries 45, error 6, warn 15, notice 39`
  (trước là 47/6/23/41). Mã: `seo.block-missing` 6, `seo.title-duplicate` 4,
  `seo.description-duplicate` 8, `i18n.translation-missing` 3, `media.share-image-missing` 39.
  Lỗi `error` (6) không đổi: `menu-category` × 4 (thiếu khối `seo`) và `menu-page.cateringSeo` × 2.
- `others[]` trong báo cáo thật đã mang `seoField` (nhóm trùng `contact-page`/`location` trỏ đúng
  `seoField: "seo"`), xác nhận bug 3 trên dữ liệu thật.

### Cổng còn mở (thủ công / ngoài phạm vi)

- Quyết định UID: **đã chốt** — bỏ `global-setting` (còn 12 type; "Điều lệch" mục 16), giữ `menu-package`.
- Gọi thử route admin `POST /seo-toolkit/audit/run` một lần bằng JWT admin và kiểm action "Run SEO audit"
  hiện trong Role. **Chưa làm** (mới test qua CLI).
- A2 trên `shareImage` thật: DB chưa có ảnh share nào nên quy tắc `share-image-alt-missing` chưa chạy
  trên dữ liệu thật (mới kiểm gián tiếp qua media của component khác). Muốn bằng chứng trực tiếp thì gắn
  một ảnh vào SEO một trang trên DB dev rồi chạy lại. **Chưa làm.**
- Mở Admin đối chiếu vài lỗi `error`/`warn` còn lại và chốt danh sách dương tính giả.
- UAT tay mã thoát 0/1/2 và việc plugin tắt mặc định không đổi menu/API/cron hiện có.

