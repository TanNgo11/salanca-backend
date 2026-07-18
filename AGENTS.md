# Salanca Backend

## Project scope

- This repository is the standalone Strapi backend for Salanca.
- The source prototype is the sibling repository at `../salanca-cms`.
- Treat the prototype as read-only reference unless the user explicitly requests frontend work.
- Frontend integration is outside the current CMS-first milestone.
- Vietnamese (`vi`) is the default locale; English (`en`) is the second locale.
- PostgreSQL is required in development, staging, and production. Do not introduce SQLite.
- Use Strapi Admin's generated CRUD. Do not build a custom admin without a validated workflow gap.
- Do not add reservation, contact submission, availability, payment, or booking-engine models during the first three phases.

## Working rules

- Read `docs/strapi-backend-roadmap.md` and the active phase spec before implementation.
- Keep schema and configuration changes version-controlled.
- Keep anonymous/public API permissions denied unless a phase explicitly opens them.
- Never commit `.env`, credentials, generated uploads, database dumps, or production URLs containing secrets.
- Keep all `@strapi/*` packages aligned to the same exact version.
- Run `npm run typecheck` and `npm run build` before claiming a phase is complete.
- Preserve unrelated work in the sibling prototype repository.

## Current phase boundary

- Phase 1: foundation and PostgreSQL bootstrap.
- Phase 2: content model and generated Admin CRUD.
- Phase 3: internationalization and editorial workflow.
- Later phases remain deferred until Phase 1–3 pass their exit gates.
