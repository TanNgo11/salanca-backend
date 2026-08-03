# Salanca Backend Current Status

Last reviewed against repository documentation: 2026-08-03

## Executive status

**Coding for Phases 4–6 is in tree (2026-08-03):** `/api/v1`, CORS, public read bootstrap, seed/verify/smoke:api, media helpers, invariants, Vitest, API contract.

Still open (ops/human): Phase 0 Admin UAT, named host/DB/S3 providers, 4C multi-account UAT, Phase 7 staging.

## Implemented baseline

- Standalone Strapi `5.50.2` TypeScript backend.
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

This status summarizes committed evidence; it does not claim every command was rerun on the date above. Re-run proportional gates for every behavior change.

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

- Cross-field campaign validation for `endsAt >= startsAt` is not implemented (triage in Phase 0; implement in 4A or defer with owner).
- Production API permissions, media storage, seed content, frontend integration, staging, backup, and handoff belong to Phase 4–7 specs above.

## Next authorized work

1. With Postgres up: `npm run check:phase6` (or at least `seed:demo` + `verify:seed` + `smoke:api`).
2. Phase 0 manual Admin UAT + named platform decisions (host/DB/S3).
3. Wire real `S3_*` on a bucket and smoke Admin upload.
4. Phase 4C multi-account Admin UAT per `docs/admin-roles.md`.
5. Phase 7 staging + FE handoff pack — then FE integration.

## Evidence

- [`bootstrap-report.md`](bootstrap-report.md)
- [`phase-02-verification.md`](phase-02-verification.md)
- [`phase-03-verification.md`](phase-03-verification.md)
- [`cms-technical-decisions.md`](cms-technical-decisions.md)
- [`security-baseline.md`](security-baseline.md)
- [`plans/be-pattern-lift-plan.md`](plans/be-pattern-lift-plan.md)
