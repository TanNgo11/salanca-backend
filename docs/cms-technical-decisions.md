# CMS Technical Decisions

## Bootstrap snapshot

| Decision | Value |
| --- | --- |
| Repository | Standalone `salanca-backend` Git repository |
| Framework | Strapi `5.50.2` |
| Language | TypeScript |
| Package manager | npm with committed lockfile |
| Validated local Node | `22.12.0` |
| Node policy | `>=22 <25`; evaluate Node 24 before staging |
| Database | PostgreSQL only |
| Local PostgreSQL | Docker Compose, PostgreSQL 16 |
| Local PostgreSQL port | `5433`, avoiding the machine's existing PostgreSQL on `5432` |
| Default locale | `vi` |
| Secondary locale | `en` |
| i18n implementation | Built-in `@strapi/i18n` bundled with Strapi `5.50.2` |
| API style | REST first |
| REST prefix | `/api/v1` via `API_REST_PREFIX` (validated) |
| CORS | `FRONTEND_URLS` bare-origin allowlist (default `http://localhost:3000`) |
| Media local default | Local disk when `S3_BUCKET` unset |
| Media staging/production | S3-compatible via `@strapi/provider-upload-aws-s3` when `S3_BUCKET` set |
| Unit tests | Vitest for config/domain helpers |
| Admin | Generated Strapi Admin CRUD |
| Source prototype | Read-only sibling `../salanca-cms` |

## Rationale

### Separate repository

The existing `salanca-cms` repository is a design/prototype workspace with active uncommitted frontend work. Keeping the production backend in a sibling repository avoids nested Git, mixed deployments, and noisy history.

### PostgreSQL everywhere

Using PostgreSQL locally removes a class of SQLite/PostgreSQL drift. The database config rejects any non-PostgreSQL `DATABASE_CLIENT` value.

### Exact Strapi version

The project was created from the official stable CLI and all generated Strapi packages are pinned. Upgrades must be separate reviewed changes using the official upgrade tooling, followed by database backup and verification.

### No custom admin initially

The content model should use generated CRUD until editors demonstrate a concrete workflow that the default Admin cannot support. A custom dashboard without that evidence is wasted maintenance.

### Locale bootstrap

`STRAPI_PLUGIN_I18N_INIT_LOCALE_CODE=vi` initializes a fresh database in Vietnamese. The project bootstrap idempotently guarantees `vi` and `en` exist and sets `vi` as default, including databases that were first booted with Strapi's English default. It does not silently delete unexpected locales; the Phase 3 verification gate must flag them for an explicit operator decision.

Slugs and user-facing copy are localized. Prices, technical state and timestamps are shared by the i18n service. Fields nested inside localized components are a Strapi limitation: technical nested values are stored per locale and must be kept equal by editor/seed policy.

## Open decisions before staging

These are hard Phase 4 entry gates. A role is accountable now; the project owner must
replace each role with a named person and record the decision before Phase 4 starts.

| Decision | Accountable owner | Deadline |
| --- | --- | --- |
| Hosting provider for the Strapi Node service | Project owner | Before Phase 4 starts |
| Managed PostgreSQL provider and backup retention | Project owner + backend lead | Before Phase 4 starts |
| S3/R2-compatible media provider and lifecycle policy | Project owner + backend lead | Before Phase 4 starts |
| Production domains and CORS allowlist | Project owner + frontend lead | Before Phase 4 starts |
| Node 24 staging/production validation | Backend lead | Before the first staging deploy |

Role ownership is not the same as an assigned human. Phase 1 remains open until the
actual names and provider decisions are recorded; this table prevents the blocker from
remaining an ownerless TODO.
