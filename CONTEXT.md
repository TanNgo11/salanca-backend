# Salanca backend context

This repository is the standalone Strapi backend for the bilingual Salanca
Churrascaria website. The paired frontend is `../salanca-web`; it is a consumer
and design reference, not a runtime dependency.

## Product contract

- Vietnamese (`vi`) and English (`en`) are equal supported content surfaces.
  Vietnamese is the default locale, but English is not optional technical
  fallback content.
- All public CMS queries use an explicit locale. Missing English content must
  remain missing; the backend never returns Vietnamese copy labeled as English.
- Publishing and unpublishing are independent per locale. A Vietnamese publish
  must not publish the English localization automatically.
- `documentId` is stable cross-locale identity. Public slugs and editorial copy
  are localized and may differ between Vietnamese and English.
- Prices, technical states, booleans, order, and timestamps are locale-neutral
  domain values even where Strapi stores component fields per localization.
- Media binaries may be shared across locales; alternative text and captions
  are localized.

The backend owns content schemas, persistence, validation, permissions, public
lead storage, and API contracts. The frontend owns presentation, localized
routing, same-origin browser boundaries, metadata rendering, and user-facing
form composition.

PostgreSQL is required in every environment. Public permissions remain
deny-by-default and are opened only to the minimum approved read or create
actions. Generated Strapi Admin CRUD is preferred until a documented workflow
requires a project-owned Admin screen.

Production hosting, database backup, object storage, domains, CORS, content,
and operational ownership require recorded decisions. Implemented code is not
production-complete while database, Admin, provider, paired-frontend, or manual
UAT gates remain open.
