# Salanca Product Context

## Purpose

This repository provides the content backend for the Salanca Churrascaria website. It is intentionally separated from the design prototype so backend deployment and history remain clean.

## Source prototype

- Local sibling path: `../salanca-cms`.
- Absolute path on the bootstrap machine: `D:\outsource\salanca-cms`.
- Reference branch: `main`.
- Reference commit at backend bootstrap: `a5ce52bcf453d1743e55668fef166d4964ff1089`.
- The prototype had uncommitted UI work at bootstrap time; inspect the live sibling tree instead of assuming the reference commit contains every page.

The sibling path is a development convenience, not a runtime dependency. Production builds and seed scripts must not require the prototype repository to be mounted beside this backend.

## Prototype surfaces

- Home: `index.html`.
- Story: `cau-chuyen.html`.
- Menu: `thuc-don.html`.
- Churrascaria experience: `trai-nghiem.html`.
- Spaces/gallery: `khong-gian.html`.
- Promotions and events: `uu-dai.html`.
- Booking request UI: `dat-ban.html`.
- Contact UI: `lien-he.html`.

## CMS-first product boundary

The first milestone manages:

- Global restaurant information.
- Locations and opening hours.
- Menu categories, menu items, and menu packages.
- Promotions/events as campaigns.
- Galleries and space content.
- Fixed content for the existing public pages.
- Vietnamese and English editorial variants.

The first milestone does not implement:

- Frontend API consumption.
- Email, SMS, Zalo, CAPTCHA, or distributed rate limiting (Automation phase).
- Table availability, hard slot reservation, deposits, payments, or refunds.
- Custom Strapi Admin dashboards, calendars, or Kanban views.

**Forms MVP (opened):** public `contact-message` create intake + Admin triage. No email notify.

**Forms-2 (opened):** public `reservation-request` lead intake (optional menu packages/items or “chọn món sau”), soft same-slot overlap flags, in-process IP rate limit. Not a booking engine.

## Editorial decisions

- `vi` is the default and primary locale.
- `en` remains draft until a human-approved translation exists.
- Publishing Vietnamese must not automatically publish English.
- Public page schemas are fixed around the prototype; no generic page builder.
- Price is numeric data in VND, never a formatted text field.
- Media binaries may be reused across locales; alt text and captions are localized.
- Missing English content is explicit. The backend must not silently mix Vietnamese copy into English responses.

## Architecture boundary

- Strapi 5 with TypeScript.
- PostgreSQL in all environments.
- Generated Strapi Admin CRUD.
- REST API first; GraphQL is deferred until a real consumer needs it.
- Local uploads are development-only; staging/production will use S3/R2-compatible object storage.
- Public API access is deny-by-default until the API-contract phase.

## Source of truth

- Roadmap: `docs/strapi-backend-roadmap.md`.
- Phase specs: `docs/phases/`.
- Actual content model after Phase 2: `docs/cms-content-model.md`.
- Future frontend contract: `docs/cms-api-contract.md`.

If the prototype and roadmap disagree, stop and resolve the product decision before encoding it in a schema.
