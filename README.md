# Salanca Backend

Standalone Strapi backend for the Salanca Churrascaria website.

## Stack

- Strapi 5.50.2.
- TypeScript.
- PostgreSQL 16 for local development.
- Vietnamese (`vi`) as the default locale and English (`en`) as the secondary locale.

Start with the [current status](docs/STATUS.md), then use the [documentation map](docs/README.md) to find the relevant contract, phase specification, or verification evidence. The design prototype is a read-only sibling repository at `../salanca-cms`.

## Prerequisites

- Node.js 22 or 24; this bootstrap was validated with Node 22.12.0.
- npm 10 or newer.
- Docker Desktop for the local PostgreSQL service.

## Local setup

1. Copy `.env.example` to `.env`.
2. Replace every `replace-*` value with a local secret. Keep `.env` untracked.
3. Start PostgreSQL:

   ```powershell
   docker compose up -d postgres
   ```

4. Install the exact locked dependencies:

   ```powershell
   npm ci
   ```

5. Start Strapi in development mode:

   ```powershell
   npm run develop
   ```

6. Create the first local admin through Strapi's setup screen. Do not seed or commit an admin credential.

The scaffold-created local `.env` is already ignored. Replace it from `.env.example` when onboarding a new machine rather than sharing another developer's secrets.

## Quality gates

```powershell
npm run test
npm run check
npm run smoke:crud
npm run check:phase3
```

`npm run test` runs Vitest unit tests for config and domain helpers. `npm run check`
verifies the schema, TypeScript, unit tests, and production Admin build. `smoke:crud`
checks persistence and relation integrity on PostgreSQL. `check:phase3` runs the complete
Phase 1-3 automated gate (plus unit tests), including the disposable VI/EN API and media
dataset.

Demo content and public API:

```powershell
npm run seed:demo
npm run verify:seed
npm run smoke:api
# or
npm run check:phase6
```

REST Content API paths use **`/api/v1`** (`API_REST_PREFIX`). Public role gets
read-only published content via bootstrap allowlist. See
[API contract](docs/cms-api-contract.md) and [architecture](docs/architecture.md).

## Repository boundaries

- Do not move frontend prototype files into this repository during the CMS-first milestone.
- Do not initialize another Git repository inside this repository.
- Do not add SQLite as a fallback.
- Do not open anonymous API permissions until the relevant roadmap phase.
- Do not add reservation/booking models during Phases 1–3.

## Documentation

- [Current status](docs/STATUS.md)
- [Documentation map](docs/README.md)
- [Product context](docs/product-context.md)
- [Technical decisions](docs/cms-technical-decisions.md)
- [Backend roadmap](docs/strapi-backend-roadmap.md)
- [BE pattern-lift plan (Phases 0, 4–7)](docs/plans/be-pattern-lift-plan.md)
- [Execution plan template](PLANS.md)
- [Phase 1](docs/phases/phase-01-foundation.md)
- [Phase 2](docs/phases/phase-02-content-model.md)
- [Phase 3](docs/phases/phase-03-internationalization.md)
- [Phase 0](docs/phases/phase-00-close-uat-and-decisions.md) · [Phase 4](docs/phases/phase-04-hardening-media-roles.md) · [Phase 5](docs/phases/phase-05-seed-content.md) · [Phase 6](docs/phases/phase-06-api-contract-and-qa.md) · [Phase 7](docs/phases/phase-07-staging-and-handoff.md)
