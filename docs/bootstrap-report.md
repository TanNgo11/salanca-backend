# Bootstrap Report

Date: 2026-07-18

## Outcome

A standalone Strapi backend repository was created at `D:\outsource\salanca-backend` using the official Strapi CLI. The repository is a sibling of the prototype and has its own Git root on branch `main`.

## Installed baseline

- Strapi 5.50.2, exact pinned version.
- TypeScript.
- npm with committed lockfile from the official scaffold.
- Node 22.12.0 validated locally.
- PostgreSQL 16 Alpine through Docker Compose.
- Local database host port 5433 to avoid the machine's existing PostgreSQL service on port 5432.
- Cloud plugin removed because this self-hosted baseline does not use Strapi Cloud.
- PostgreSQL-only database config; missing password or a non-PostgreSQL client fails fast.

## Context transferred

- Master backend roadmap.
- Detailed Phase 1–3 specifications.
- Product context and prototype reference.
- Technical decisions.
- Repository-specific `AGENTS.md`.

The source prototype remains at `D:\outsource\salanca-cms`. Only the untracked backend documentation was moved; prototype HTML, CSS, assets, build files, and Git history were not moved or modified by the backend bootstrap.

## Verification evidence

| Check | Result |
| --- | --- |
| Official CLI scaffold | Pass |
| Separate Git root | Pass |
| Branch renamed to `main` | Pass |
| TypeScript typecheck | Pass |
| Strapi production build | Pass |
| PostgreSQL container health | Pass |
| Strapi development health endpoint | HTTP 204 |
| Strapi production-mode restart health | HTTP 204 |
| PostgreSQL persistence across restart | 41 tables before and after |
| Prototype docs removed after transfer | Pass |
| Frontend files untouched by transfer | Pass |

## Known issues and remaining work

- No local admin account was created because that requires an owner email/password through the Admin setup flow.
- Staging hosting, managed PostgreSQL, media object storage, domains, CORS, and backup retention remain open Phase 1 decisions.
- Node 24 is the current recommended Strapi runtime and should be validated before staging; this machine currently runs supported Node 22.12.0.
- `npm audit` reports one high transitive Vite advisory plus lower-severity findings. See `docs/security-baseline.md`; no unsafe forced fix was applied.
- Content types and locale configuration intentionally remain for Phases 2 and 3.
