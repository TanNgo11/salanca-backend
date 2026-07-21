# Phase 2 verification

Date: 2026-07-19

## Automated evidence

| Gate | Result |
| --- | --- |
| Schema inventory | Pass: 12 shared components, 15 content types |
| Core CRUD layers | Pass: controller, router and service for every content type |
| Generated Strapi TypeScript registry | Pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass, including Admin panel production build |
| PostgreSQL schema load | Pass; content, component and relation tables created |
| Runtime health | HTTP 204 on `/_health` |
| Admin initialization route | HTTP 200 on `/admin/init` |
| New REST routes | HTTP 403 while unauthenticated, proving routes exist and public access remains deny-by-default |
| CRUD persistence smoke | Pass: create/update/required relation/publish/unpublish/delete cleanup on PostgreSQL |
| Category integrity | Pass: create/update without category and deletion of a referenced category are blocked by document middleware |
| Fixture cleanup | Pass: zero smoke records remain |
| `git diff --check` | Pass |

Commands:

```powershell
npm run verify:schema
npm run smoke:crud
npm run check
```

## Scope decisions confirmed

- Added fixed `menu-page` and `campaign-page` single types. Without them, public hero/headings/CTA from the prototype would remain hardcoded.
- Did not create reservation, contact submission, availability, table, payment or generic page-builder models.
- Did not enable public API permissions; that belongs to a later permissions/API phase.
- Did not enable i18n; localization is Phase 3.

## Editor UAT still required

Automated service CRUD is not a substitute for a human checking the generated Content Manager UI. Before closing Phase 2, an admin user must verify:

- All 15 content types appear with understandable labels.
- Required-field errors appear clearly in Admin, especially `menu-item.category` (backend enforcement is automated; message UX still needs human review).
- Create/edit/save draft/publish/unpublish works from the UI.
- Search/filter/sort surfaces are usable for menu, campaign, location and gallery.
- Category deletion with existing items shows the backend rejection clearly enough for an editor to reassign or delete items first.
- Decimal prices survive save/reload in the browser.

Cross-field campaign validation (`endsAt >= startsAt`) is not enforced by schema and remains an explicit follow-up. Do not claim that rule is implemented.
