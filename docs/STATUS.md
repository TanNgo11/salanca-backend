# Salanca Backend Current Status

Last reviewed against repository documentation: 2026-07-21

## Executive status

The Phase 1-3 implementation is present and the recorded automated Phase 2-3 verification passes. The milestone is **ready for manual Admin UAT**, not closed.

Do not begin Phase 4 implementation until its owner-controlled entry decisions are recorded and the user approves a detailed Phase 4 specification.

## Implemented baseline

- Standalone Strapi `5.50.2` TypeScript backend.
- PostgreSQL-only configuration with PostgreSQL 16 used locally.
- Vietnamese (`vi`) default locale and English (`en`) secondary locale.
- Fixed content types and shared components with generated Strapi Admin CRUD.
- Document Service enforcement for relation and locale invariants.
- Schema, CRUD, i18n, typecheck, and production Admin build gates.
- Public API permissions remain deny-by-default.

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

### Manual Admin UAT

- Confirm only VI and EN are available and VI is selected by default.
- Complete the VI -> EN localization workflow through Strapi Admin.
- Verify draft, publish, and unpublish independently per locale.
- Reuse one media asset with localized alt text and caption.
- Verify required-field, duplicate-slug, and protected-relation error UX.
- Confirm decimal prices survive browser save and reload.
- Confirm search, filter, sort, and labels are usable for editors.

Use [`cms-editor-guide.md`](cms-editor-guide.md) and the manual sections of the Phase 2 and Phase 3 verification reports.

### Owner and platform decisions

Named humans and accepted choices are still required for:

- Strapi hosting provider.
- Managed PostgreSQL provider and backup retention.
- S3/R2-compatible media provider and lifecycle policy.
- Production domains and CORS allowlist.
- Node 24 staging and production validation owner.

Role labels such as "project owner" are not named accountable humans. Record these decisions in [`cms-technical-decisions.md`](cms-technical-decisions.md) before Phase 4 starts.

### Security follow-up

- The latest recorded audit is dated 2026-07-19 and includes one high transitive Vite advisory plus lower-severity findings.
- Re-run the audit against the public npm registry before staging.
- Do not run `npm audit fix --force`; the recorded remedy is an unacceptable Strapi major-version downgrade.
- Upgrade Strapi only as a dedicated reviewed change with backup and full verification.

See [`security-baseline.md`](security-baseline.md).

## Known functional follow-up

- Cross-field campaign validation for `endsAt >= startsAt` is not implemented.
- Production API permissions, media storage, seed content, frontend integration, staging, backup, and handoff belong to later approved phases.

## Next authorized work

1. Complete and record Phase 2-3 manual Admin UAT.
2. Assign named owners and record Phase 4 platform decisions.
3. Draft and approve the detailed Phase 4 specification.
4. Only then implement Phase 4.

## Evidence

- [`bootstrap-report.md`](bootstrap-report.md)
- [`phase-02-verification.md`](phase-02-verification.md)
- [`phase-03-verification.md`](phase-03-verification.md)
- [`cms-technical-decisions.md`](cms-technical-decisions.md)
- [`security-baseline.md`](security-baseline.md)
