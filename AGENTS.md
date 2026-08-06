# Salanca Backend Agent Guide

## Project contract

- This repository is the standalone Strapi backend for Salanca.
- The sibling `../salanca-cms` is a read-only design prototype unless the user explicitly requests frontend work.
- The current milestone is CMS-first. Frontend integration requires an approved later phase.
- Vietnamese (`vi`) is the default locale; English (`en`) is secondary.
- PostgreSQL is required everywhere. Never add SQLite as a fallback.
- Use Strapi Admin's generated CRUD. Build custom Admin UI only after a documented workflow gap is accepted.
- Availability, table inventory, payment, and booking-engine models remain deferred.
- Form leads in scope: `contact-message` (Forms MVP) and `reservation-request` (Forms-2, Public create-only, soft-overlap + in-memory IP rate limit). Optional Cloudflare Turnstile via `TURNSTILE_SECRET_KEY` (skip when unset). Optional Resend SMTP staff notify via `EMAIL_SMTP_HOST` + `FORM_NOTIFY_TO` (skip when unset; mail failure never fails create). Redis rate limit stays deferred.

## Read before changing code

1. Read `docs/STATUS.md` for the verified current state and open gates.
2. Use `docs/README.md` to locate the relevant source-of-truth document.
3. Read the active phase specification under `docs/phases/`.
4. For multi-module, persistence, schema, migration, security, or permission work, write an execution plan following `PLANS.md` before implementation.

Do not infer completion from the roadmap. A phase closes only after its automated checks, required manual UAT, and owner decision gates are recorded as complete.

## Source-of-truth order

When sources disagree, stop and reconcile the conflict. Use this order:

1. Accepted product or owner decisions.
2. Version-controlled runtime code, schemas, migrations, and configuration.
3. Current automated verification.
4. Content model and API contract documentation.
5. Current status and active phase specification.
6. Roadmap and historical verification reports.
7. The sibling prototype as design reference only.

Update stale documentation in the same change when behavior or a decision changes.

## Working-tree safety

- Run `git status --short` before editing and before committing.
- Preserve unrelated modifications and untracked files. Never discard, overwrite, stage, or commit work outside the requested scope.
- Never commit `.env`, credentials, generated uploads, database dumps, local logs, or secret-bearing production URLs.
- Keep schema, configuration, migrations, scripts, and documentation needed to reproduce behavior version-controlled.

## Engineering constraints

- Keep all `@strapi/*` packages aligned to the same exact version.
- Upgrade Strapi only in a dedicated reviewed change using the official upgrade tooling.
- Never run `npm audit fix --force`; its current proposed remediation can downgrade Strapi across a major version.
- Keep anonymous and public API permissions deny-by-default until an approved phase opens the minimum read permissions.
- Preserve locale behavior, Draft & Publish independence, relation invariants, and shared-field synchronization.
- Do not weaken middleware-enforced invariants because a Strapi schema declares a field `required`.
- Prefer fixed product schemas over unrestricted Dynamic Zones or generic page builders.

## Commands and verification

Install from the committed lockfile:

```powershell
npm ci
```

Common gates:

```powershell
npm run lint
npm run verify:schema
npm run typecheck
npm run test
npm run build
npm run smoke:crud
npm run smoke:i18n
npm run check:phase3
```

Seed / ops (BDS-style):

```powershell
npm run seed:demo          # modular scripts/seed-salanca-demo/*
npm run verify:seed
npm run media:reconcile    # read-only S3 vs DB (requires S3 env); not part of check:phase6
npm run data:export
npm run data:import
```

Admin Content Manager labels (v1): only schemas that declare `config.metadatas` are synced at bootstrap (auto-discovered — no UID allowlist). Today: `global-setting`, `location`, `campaign`, plus selected `shared.*` components. `info.displayName` is Vietnamese for all content types.

Apply gates proportionally:

- Documentation-only: verify links and run `git diff --check`.
- Schema or component changes: run schema verification, typecheck, and affected CRUD/i18n smoke tests.
- Middleware, lifecycle, locale, or relation changes: run `npm run check:phase3`.
- Dependency, configuration, or build changes: run `npm run check` (includes lint) plus affected smoke tests.
- Before staging: follow `docs/security-baseline.md` and audit against the public npm registry explicitly.

If a required gate cannot run, report the exact blocker. Missing verification is not a pass.

## Documentation update matrix

- Product boundary: update `docs/product-context.md` and the roadmap.
- Architecture or platform decision: update `docs/cms-technical-decisions.md`.
- Content type, component, relation, or localized field: update `docs/cms-content-model.md`.
- REST response, query, permission, or locale contract: update `docs/cms-api-contract.md`.
- Phase scope or acceptance: update the active phase specification.
- Result, blocker, or authorized next phase: update `docs/STATUS.md` and the relevant verification report.
- Editor-visible workflow: update `docs/cms-editor-guide.md`.

## Completion standard

Use precise states:

- `implemented`: the requested change exists.
- `automated verification passed`: the named current gates passed.
- `ready for manual UAT`: automation passed but human checks remain.
- `phase closed`: automated, manual, ownership, and handoff gates all passed and are recorded.

Before claiming completion, recheck the diff and working tree, list exact commands and outcomes, identify remaining manual or external gates, and confirm unrelated work was excluded.

## Agent behavior

- Stay inside the requested phase and repository boundary.
- Ask for a decision when it changes product scope, data shape, security, hosting, or another owner-controlled outcome.
- Use subagents only for independent work that can be verified separately; never let multiple agents edit the same files concurrently.
- Prefer small, reviewable changes. Do not mix framework upgrades, schema redesign, and feature work.
