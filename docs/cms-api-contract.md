# CMS API contract draft

Phase 3 does not open anonymous API permissions. This document fixes the locale contract before frontend integration.

## Locale rules

- Consumers must send an explicit `locale=vi` or `locale=en` query parameter.
- Backend does not silently fall back from EN to VI.
- Missing EN returns no matching document for that locale; it must not return Vietnamese copy labeled as English.
- Draft and published lookups are separate. Anonymous/read-only production consumers will only receive published records once permissions are opened in a later phase.
- `documentId` is the stable identity joining VI and EN localizations. Database numeric `id` and localized slug are not relation or seed identities.
- Public route lookup uses localized `slug` plus explicit locale. VI and EN slugs may differ.

Conceptual REST queries for the frontend phase:

```text
GET /api/menu-items?locale=vi&filters[slug][$eq]=mon-thu-nghiem
GET /api/menu-items?locale=en&filters[slug][$eq]=test-item
```

Populate must be explicit. A localized menu item must resolve its category in the requested locale; mixed VI/EN copy is a contract failure.

## Response expectations

- Response exposes `documentId`, `locale`, localized fields and requested relations.
- Prices, booleans, order and timestamps must be consistent across localizations.
- Same media asset may be referenced by both locales while `shared.image.alt` and `caption` differ.
- Frontend fallback, route structure and caching are deliberately deferred until frontend integration.
