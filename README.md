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
npm run check
npm run smoke:crud
npm run check:phase3
```

`npm run check` verifies the schema, TypeScript and production Admin build. `smoke:crud`
checks persistence and relation integrity on PostgreSQL. `check:phase3` runs the complete
Phase 1-3 automated gate, including the disposable VI/EN API and media dataset.

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
- [Execution plan template](PLANS.md)
- [Phase 1](docs/phases/phase-01-foundation.md)
- [Phase 2](docs/phases/phase-02-content-model.md)
- [Phase 3](docs/phases/phase-03-internationalization.md)
