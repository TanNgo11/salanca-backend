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
| API style | REST first |
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

## Open decisions before staging

- Hosting provider for the Strapi Node service.
- Managed PostgreSQL provider and backup retention.
- S3/R2-compatible media provider and lifecycle policy.
- Production domain names and CORS allowlist.
- Node 24 validation for staging/production.
