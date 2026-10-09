# Salanca Backend Current Status

Last reviewed against repository documentation: 2026-09-29

2026-10-09: **Staff notification recipients in Admin.** Staff notification recipients are managed per kind in Admin (Email thông báo) — automated verification passed; ready for manual UAT. Plan: [`plans/notification-email-settings.md`](plans/notification-email-settings.md).

2026-10-08: **Reservation workflow, guest receipt, lead CSV export** ([`plans/lead-workflow-confirmation-export.md`](plans/lead-workflow-confirmation-export.md), Parts A–C). `reservation-request.leadStatus` gains `confirmed` / `cancelled` / `no_show`, plus a private `staffNote` (≤ 2000 chars). Statuses live in `src/shared/lead-status`. The inbox has 7 tabs, workflow row actions, and status buttons plus a note editor in the detail modal (`POST /reservation-inbox/:documentId/note`). Dashboard "today/upcoming" skip cancelled and no-show bookings. Soft overlap now also counts `confirmed`. Guest receipt email, always on when SMTP is configured and the guest left an email (owner decision, no flag): VI/EN by `sourceLocale`, says "not yet confirmed". New `Xuất dữ liệu khách` screen with `GET /admin/lead-export/:kind` (`reservations|contacts|newsletter`, Vietnam-day range, 10,000-row cap, new RBAC action `lead-export.export`). CSV writer shared in `src/shared/csv`. No component changed, so the seed `schemaHash` is unchanged. Gates passed: lint, `verify:schema`, typecheck, `test` (613, including the previously failing `content-manager-labels.vi`), `build`, `smoke:reservation-form`. **Manual UAT open**: inbox workflow and note, Mailpit VI/EN receipt, three CSVs in Excel, export permission gating. Part D (opening hours, drinks) waits for owner data; opening hours are already wired end to end and need data only.

2026-10-06: **Media derivatives for direct `srcset`.** Upload breakpoints `w640/w960/w1280/w1920` (non-default names so derivative keys never collide with cached ones); every S3 write sends `Cache-Control: public, max-age=31536000, immutable` via upload `actionOptions` (the aws-s3 provider ignores non-ACL `s3Options.params`). New `media:backfill` (dry-run default, `--apply`, `--limit`) generates missing formats with Strapi's own generator and copy-in-place fixes headers. Plan: [`plans/media-derivative-backfill.md`](plans/media-derivative-backfill.md); runbook: [`media-storage-operations.md`](media-storage-operations.md). **Open:** staging + production backfill run with recorded counts, CDN purge. Admin Replace media now stores a fresh hash on the same row (no temporary row, name kept), keeps old objects, and sends a signed `media.replace` webhook so the web revalidates every page (decision 2026-10-06). `media:reconcile` loads the S3 SDK through the provider and can delete orphans (`--delete-orphans --apply`, 7-day grace, `protected-keys.txt`). Experience heritage artwork resolves from the media library by row name.

2026-10-04: **Admin lead triage.** Reservation inbox screen now filters by status (Mới/Đã đọc/Lưu trữ/Tất cả, with counts), searches name/phone (debounced), paginates (20/page) and lets staff archive/restore/re-mark-new via `GET /reservation-inbox/list` and `POST /reservation-inbox/:documentId/status` (same `admin::reservation-inbox.read` scope; live SSE/summary contract unchanged). Sidebar gains `Tin nhắn liên hệ` and `Yêu cầu đặt bàn` shortcuts to the Content Manager lists. Content Manager list columns, default sort (`createdAt DESC`) and page size for `reservation-request` and `contact-message` are declared in each schema's `config.listView` and applied by the existing label sync at bootstrap. Gates: typecheck, lint, `test` (399). **Manual UAT open**: filter/search/archive in Admin, sidebar permission gating.

2026-10-04: **Reservation inbox (admin near-realtime notify) implemented** ([`plans/reservation-inbox-realtime.md`](plans/reservation-inbox-realtime.md)). When a visitor submits the public reservation form, admins holding `admin::reservation-inbox.read` see a toast + floating unread pill within ~1s via authenticated SSE (`GET /reservation-inbox/stream`), with `summary?since=` polling every 20s as fallback and a dedicated `Hộp thư đặt bàn` screen (mark-read writes `status=read`; opt-in OS notification + sound per browser). In-process `EventEmitter` emits after `scheduleFormLeadNotify`; the public 201 contract and email notify are unchanged (`smoke:reservation-form` passes). Gates passed: typecheck, lint, `test` (372 tests), `build`. **Manual UAT open** (owner): two-tab toast check, offline reconnect dedupe, permission gating; plus hosting proxy SSE buffering check. Multi-instance deployments would need a distributed bus — Redis pub/sub deferred.

2026-10-04: **Form intake rate limiting hardens client-IP identity.** Contact and reservation limits now key on the real visitor IP: `salanca-web` forwards `x-salanca-visitor-ip` authenticated by `x-salanca-intake-secret` against `FORM_INTAKE_SHARED_SECRET` (constant-time compare; mismatch falls back to socket IP); `TRUST_PROXY=true` honors `X-Forwarded-For` behind a reverse proxy. Production boot warns when the secret is missing. Contract: [`cms-api-contract.md`](cms-api-contract.md), [`security-baseline.md`](security-baseline.md).

2026-10-04: **Admin activity audit log implemented** (backend port of the BDS design, [`plans/admin-audit-log.md`](plans/admin-audit-log.md)). Append-only `audit_events` ledger; capture via EventHub (CMS docs/media), `admin-audit-http` middleware (login, role permissions, API/transfer tokens, webhooks) and upload extension wrappers (media delete, folder update — no `@strapi/*` dist patching). Read-only Vietnamese Admin screen `Nhật ký hoạt động` (list + detail drawer + CSV export, 3 RBAC actions, registered in every build mode). Reads the existing `ctx.state.requestId` — no new request-correlation middleware. **New required env var:** `AUDIT_IDENTIFIER_HASH_SECRET` (boot throws if missing; see `.env.example`). Automated verification: see the dated run below; **manual UAT open** (new checklist rows in [`admin-roles.md`](admin-roles.md)).

2026-10-03: Backend-only owner seed now ships all 166 localized published marketing records and 24 approved original images. One command: `node scripts/seed-production-content.mjs`; no SFTP, bind mount, sibling checkout or pg_dump requirement. Existing S3/database config is reused; checksum/schema/draft preflight and automatic marketing JSON recovery snapshot precede upsert/publish. Local preview passed; production apply remains unrun. Runbook: [content seed](content-bundle-deploy.md).

Historical developer transport (superseded operator workflow), 2026-10-03: Added `content:pack` / `content:deploy` for published VI/EN marketing snapshots plus media. Explicit apply requires matching target schema, media checksums, no unpublished target edits, target database name and a successful PostgreSQL backup. Production apply remains unrun; Git push does not deploy CMS data. Runbook: [content bundle deploy](content-bundle-deploy.md).

Owner refresh: [Phase 9](phases/phase-09-owner-data-refresh.md). Local CMS contains the revised DOCX story, 56-item menu in VI/EN and five PDF photos at 3,840 pixels wide. Frontend has nine actual menu tab panels. Editorial cards support optional localized detailBody. Local PostgreSQL was backed up before scoped seed; production has not changed. Older sections below describe prior milestones.

## Executive status

**Coding for Phases 4–6 is in tree (2026-08-03):** `/api/v1`, CORS, public read bootstrap, seed/verify/smoke:api, media helpers, invariants, Vitest, API contract.

**Pattern-lift follow-up (2026-08-03, post-seed real client data):** modular seed (`scripts/seed-salanca-demo/*`), Admin VI labels + field-hint hide, Content Manager label bootstrap (auto-discover schemas with `config.metadatas`; empty placeholder/description stripped), ESLint in `npm run check`, `data:export|import|transfer`, read-only `media:reconcile`. Review fixes: no ghost managedModels allowlist, warn on missing CM fields, dead shim/example/types removed. Automated: lint + unit tests + typecheck + verify:schema (seed/smoke need Postgres).

**Recent BDS lift Waves 0–4 (2026-08-04):** Plan at [`plans/be-recent-bds-lift-plan.md`](plans/be-recent-bds-lift-plan.md). Implemented:

- Wave 1: `env.helper`, normalization, production S3 assert, provider contract tests
- Wave 2: safe map URL normalize, social hostname policy, `shared.image` focal points + document middleware
- Wave 3: slim signed CMS webhooks (publish/unpublish, HMAC, no audit CT)
- Wave 4: opt-in editorial WebP pipeline (`MEDIA_PROCESSING_ENABLED`, sharp, no watermark/private-source)

Still not ported (by design): end-user auth/email, projects, property watermark.  
**Tooling align (2026-08-04):** Strapi **5.51.1**, pnpm **11.7.0**, full `plugins`/`middlewares` config test suite.

**Forms MVP contact intake (2026-08-04):** `contact-message` lead CT + Public create-only + validation/honeypot + `smoke:contact-form`. Spec: [`phases/phase-forms-contact-message.md`](phases/phase-forms-contact-message.md). No email/CAPTCHA.

**Forms-2 reservation intake (2026-08-05):** `reservation-request` lead CT + menu later/now + soft same-slot overlap + in-process IP rate limit + `smoke:reservation-form`. Spec: [`phases/phase-forms-reservation-request.md`](phases/phase-forms-reservation-request.md). Not a booking engine; no email/CAPTCHA/Redis.

**Local self-test re-run (2026-08-03):** green on Windows PostgreSQL 17 (`localhost:5432`, DB `salanca_cms`, same host/user pattern as `batdongsan-cms`). Campaign date invariant already in code. Seed script fixes applied (location EN slug, campaign `shared.cta` shape).

Still open (ops/human): Phase 0 Admin UAT (manual), named host/DB/S3 providers, 4C multi-account UAT, Phase 7 staging. Wave 2+ (map URL, focal points, webhooks, WebP) per recent-lift plan.

**Approved-content seed + full FE image wiring (2026-08-26):** `npm run seed:content`
writes the client-approved copy and photography from `salanca-web` into every marketing
single type and collection, both locales. Payload is generated by the frontend
(`pnpm run export:cms-seed`) so the copy has one source. Pipeline: [`content-seed-pipeline.md`](content-seed-pipeline.md).
Also added `npm run token:preview` for the frontend's `STRAPI_PREVIEW_TOKEN`.

## Implemented baseline

- Standalone Strapi `5.51.1` TypeScript backend (pnpm 11.7.0; aligned with `backend-bds`).
- PostgreSQL-only configuration with PostgreSQL 16 used locally.
- Vietnamese (`vi`) default locale and English (`en`) secondary locale.
- Fixed content types and shared components with generated Strapi Admin CRUD.
- Document Service enforcement for relation and locale invariants (menu + campaign dates).
- Schema, CRUD, i18n, typecheck, unit tests (Vitest), and production Admin build gates.
- Public API: **read allowlist** provisioned at bootstrap; create/update/delete remain denied.
- **Phase 4A:** `API_REST_PREFIX=/api/v1`, CORS allowlist helper, modular locale bootstrap, architecture doc.
- **Phase 4B code:** media-storage helper + optional S3 when `S3_BUCKET` set, media delete reference guard, `@strapi/provider-upload-aws-s3`, `docs/media-storage-operations.md`.
- **Phase 4C docs:** `docs/admin-roles.md` (manual role UAT still open).
- **Phase 5 code:** `npm run seed:demo` + `npm run verify:seed`.
- **Phase 6 code:** public permission provisioner, `docs/cms-api-contract.md`, `npm run smoke:api`, `npm run check:phase6`.

## Planning baseline (drafted, not implemented)

| Document | Purpose |
| --- | --- |
| [`plans/be-pattern-lift-plan.md`](plans/be-pattern-lift-plan.md) | Overview: which Nhà Thật patterns to port; sequence; non-goals |
| [`phases/phase-00-close-uat-and-decisions.md`](phases/phase-00-close-uat-and-decisions.md) | Close Phase 1–3 UAT + platform decisions |
| [`phases/phase-04-hardening-media-roles.md`](phases/phase-04-hardening-media-roles.md) | 4A config/tests, 4B S3 media, 4C Admin roles |
| [`phases/phase-05-seed-content.md`](phases/phase-05-seed-content.md) | Idempotent seed from prototype |
| [`phases/phase-06-api-contract-and-qa.md`](phases/phase-06-api-contract-and-qa.md) | Public read allowlist + API contract + smokes |
| [`phases/phase-07-staging-and-handoff.md`](phases/phase-07-staging-and-handoff.md) | Staging, backup drill, FE handoff pack |
| [`phases/phase-08-vietnamese-admin-editor-ux.md`](phases/phase-08-vietnamese-admin-editor-ux.md) | Optional editor-facing Vietnamese Admin UX; planned only, not authorized implementation |

## Recorded automated verification

The committed Phase 2 and Phase 3 verification reports record successful runs of:

```powershell
npm run verify:schema
npm run smoke:crud
npm run smoke:i18n
npm run typecheck
npm run build
npm run check:phase3
```

**Re-run 2026-08-03 (local Postgres `salanca_cms` on 5432, Node 22.22.3):**

| Gate | Result |
| --- | --- |
| `npm run verify:schema` | Pass |
| `npm run typecheck` | Pass |
| `npm run test` (40 tests) | Pass |
| `npm run smoke:crud` | Pass |
| `npm run smoke:i18n` | Pass |
| `npm run build` | Pass |
| `npm run seed:demo` | Pass (after seed script fixes) |
| `npm run verify:seed` | Pass |
| `npm run smoke:api` | Pass (public read 200; public write 403) |

Local env notes: `.env` aligned with batdongsan local Postgres (port `5432`, user `postgres`); Docker Compose on `5433` remains optional. Do not commit `.env`.

### Structured logging (2026-10-04)

Backend logs are JSON lines per log contract v1 (`@tanngo11/log@0.4.6`).

- Each request has one `http.request` line and a server-issued `X-Request-ID`.
- Unhandled errors are logged once.
- Node process warnings carry their stack.

Gates passed: lint, `verify:schema`, typecheck, build, and the logging tests.

Known failing test, which predates this change and also fails on `main`:
`content-manager-labels.vi.test.ts` ("covers every field in Salanca API schemas").

Plan: [`plans/structured-logging.md`](plans/structured-logging.md).

## Open acceptance gates

### Manual Admin UAT (Phase 0)

- Confirm only VI and EN are available and VI is selected by default.
- Complete the VI → EN localization workflow through Strapi Admin.
- Verify draft, publish, and unpublish independently per locale.
- Reuse one media asset with localized alt text and caption.
- Verify required-field, duplicate-slug, and protected-relation error UX.
- Confirm decimal prices survive browser save and reload.
- Confirm search, filter, sort, and labels are usable for editors.

Use [`cms-editor-guide.md`](cms-editor-guide.md) and the manual sections of the Phase 2 and Phase 3 verification reports.

### Owner and platform decisions (Phase 0 → blocks 4B/7)

Named humans and accepted choices are still required for:

- Strapi hosting provider.
- Managed PostgreSQL provider and backup retention.
- S3/R2-compatible media provider and lifecycle policy.
- Production domains and CORS allowlist.
- Node 24 staging and production validation owner.

Also confirm or reject pattern decisions in the lift plan (S3 every env, `/api/v1`, bootstrap public permissions).

Role labels such as "project owner" are not named accountable humans. Record these decisions in [`cms-technical-decisions.md`](cms-technical-decisions.md) before Phase 4B/7 implementation.

### Security follow-up

- The latest recorded audit is dated 2026-07-19 and includes one high transitive Vite advisory plus lower-severity findings.
- Re-run the audit against the public npm registry before staging.
- Do not run `npm audit fix --force`; the recorded remedy is an unacceptable Strapi major-version downgrade.
- Upgrade Strapi only as a dedicated reviewed change with backup and full verification.

See [`security-baseline.md`](security-baseline.md).

## Known functional follow-up

- Cross-field campaign validation for `endsAt >= startsAt` **is implemented** (`campaign-invariants.helper` + Document Service middleware + unit tests).
- Production media storage (S3 every env like batdongsan), staging, backup, and FE integration remain ops / later phases.
- Manual Admin UAT checklist still open (human click-through).

## Frontend integration note (2026-08-06)

`salanca-web` Phase 20 wires all 8 marketing pages to Strapi single types via
field-level adapters + static fallback. Home seed copy in
`scripts/seed-salanca-demo/pages.mjs` is aligned with FE `homePageCopy` for
mapped fields. Forms POSTs (contact/reservation) were already in tree.

FE follow-up: ~~CMS SEO → `generateMetadata`~~ (done 2026-08-06).
~~Collection media URLs~~ (menu/gallery/campaign overlay by slug/index).
~~Campaign detail indexability + sitemap~~. ~~Restaurant JSON-LD~~ (confirmed
contact fields only; hours/price still open).
~~global-setting → header/footer/contact~~ (done 2026-08-06).

## Next authorized work

1. ~~With Postgres up: seed + smoke:api~~ — done 2026-08-03 local.
2. ~~Recent BDS lift Waves 0–4~~ — 2026-08-04 (see plan; Wave 5 Strapi patch optional/separate).
3. ~~Forms MVP contact-message BE~~ — code in tree 2026-08-04; run `pnpm run smoke:contact-form` with Postgres; manual Admin triage UAT open.
4. ~~Forms-2 reservation-request BE~~ — code in tree 2026-08-05; run `pnpm run smoke:reservation-form` with Postgres; manual Admin triage UAT open.
5. ~~FE Phase 20 CMS page wiring~~ — done 2026-08-06 in `salanca-web` (fallback when CMS off).
6. ~~FE CMS SEO metadata~~ — done 2026-08-06 (`buildRouteMetadata` / `loadPageSeo` on 8 marketing routes).
7. ~~FE collection media + campaign detail SEO + Restaurant JSON-LD~~ — done 2026-08-06.
8. Phase 0 manual Admin UAT (`docs/cms-editor-guide.md`) + create first Admin user via `/admin`.
9. Named platform decisions (host/DB/S3) when client ready; optional local S3 mirror of batdongsan CloudFly vars.
10. Phase 4C multi-account Admin UAT per `docs/admin-roles.md`.
11. Phase 7 staging + ops handoff pack.
12. Automation: ~~CAPTCHA~~ Cloudflare Turnstile (opt-in, 2026-08-06); ~~email notify~~ Resend SMTP + `FORM_NOTIFY_TO` (opt-in BDS pattern, 2026-08-06); Redis/distributed rate limit still open.
13. ~~Optional FE: global-setting → header/footer/contact~~ — done 2026-08-06 in `salanca-web`.
14. ~~Optional FE: full menu collection content~~ — done 2026-08-06 (`menu-packages` + `menu-items` replace buffet/rodizio/cuts/a-la-carte when published).
15. ~~Optional FE: full campaign + draft preview + logo + Restaurant hours JSON-LD~~ — done 2026-08-06 in `salanca-web`.
16. Optional: priceRange on Restaurant schema after client confirm; Phase 0 Admin UAT; Phase 7 staging.

## Evidence

- 2026-10-03 follow-up release: homepage gallery/process/booking/hero restoration, CMS-editable hero decoration and 43 approved originals are ready for release. Local schema/typecheck, release tests and browser VI/EN checks passed. Production content apply is not performed by a Git push; use the shipped restore command after backend deployment. Frontend now handles a missing optional artwork field during rolling deployments. Dependency audit: 37 high, 56 moderate, 5 low, zero critical; no dependency changes in this release. Production Experience HTTP 500 root cause awaits server logs.

- 2026-10-03: Homepage space gallery restored locally in VI/EN with three approved CMS/S3 photos; see `plans/restore-home-space.md` for scope, recovery and verification. Production apply and push not run for this follow-up.

- [`bootstrap-report.md`](bootstrap-report.md)
- [`phase-02-verification.md`](phase-02-verification.md)
- [`phase-03-verification.md`](phase-03-verification.md)
- [`cms-technical-decisions.md`](cms-technical-decisions.md)
- [`security-baseline.md`](security-baseline.md)
- [`plans/be-pattern-lift-plan.md`](plans/be-pattern-lift-plan.md)
- [`plans/be-recent-bds-lift-plan.md`](plans/be-recent-bds-lift-plan.md)

2026-10-03 restoration in progress: Experience/Space native blocks and approved original images are restored against frontend f3b9865 (working assumption: no remote branch named mockup). Additive flavorCards allows CMS-editable Experience photos without menu changes. The shipped release now contains 38 images and six gallery entries; scoped seed command is documented in the content runbook. Production apply remains unrun.

Local restoration verified 2026-10-03: scoped seed created 17 S3 media and updated 16 VI/EN page/gallery documents. FE adapter tests (23), BE seed tests (8), schema/typecheck/lint and desktop/mobile (375px) browser checks passed. Other release pages/menu/global settings were verified unchanged. Build/production E2E and production apply not run. Servers: FE 3001, BE 1338; no Git push for this restoration.

Homepage dish image restoration verified 2026-10-03: restored the approved f3b9865 image mapping for Picanha, Costela, Cupim, Panceta, Cordeiro and Camarão in 12 published VI/EN menu-item documents. Homepage continues to read their CMS media relations. The release now contains 40 approved originals. Run `node scripts/restore-home-dish-images.mjs` on the backend for this image-only restore; it blocks unpublished edits and writes a recovery snapshot before updates. A second local run exited successfully and reused all six S3 files (created=0, skipped=6). FE typecheck/scoped lint, two release tests and VI/EN homepage browser inspection passed; screenshot: `salanca-web/.tmp/restored-pages/home-dishes-vi.png`. Production apply and Git push remain unrun.


## Script cleanup — 2026-10-03

Removed 19 obsolete demo/deploy/one-off scripts and duplicate seed package aliases. Use `node scripts/seed-production-content.mjs` once for the complete approved release; separate page commands are unnecessary. Production internals, validation and backup tools are retained. Earlier commands in historical reports are superseded by content-bundle-deploy.md. No CMS writes or production apply during cleanup.
