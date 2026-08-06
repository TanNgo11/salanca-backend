# Salanca Backend Current Status

Last reviewed against repository documentation: 2026-08-05

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
12. Automation: CAPTCHA, Redis/distributed rate limit, email notify.
13. ~~Optional FE: global-setting → header/footer/contact~~ — done 2026-08-06 in `salanca-web`.
14. ~~Optional FE: full menu collection content~~ — done 2026-08-06 (`menu-packages` + `menu-items` replace buffet/rodizio/cuts/a-la-carte when published).
15. ~~Optional FE: full campaign + draft preview + logo + Restaurant hours JSON-LD~~ — done 2026-08-06 in `salanca-web`.
16. Optional: priceRange on Restaurant schema after client confirm; Phase 0 Admin UAT; Phase 7 staging.

## Evidence

- [`bootstrap-report.md`](bootstrap-report.md)
- [`phase-02-verification.md`](phase-02-verification.md)
- [`phase-03-verification.md`](phase-03-verification.md)
- [`cms-technical-decisions.md`](cms-technical-decisions.md)
- [`security-baseline.md`](security-baseline.md)
- [`plans/be-pattern-lift-plan.md`](plans/be-pattern-lift-plan.md)
- [`plans/be-recent-bds-lift-plan.md`](plans/be-recent-bds-lift-plan.md)
