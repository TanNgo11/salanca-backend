# Phase Forms-2 — Reservation request intake

## Goal

Public website can submit a **table reservation lead** (optionally with menu selection); Strapi Admin can triage it. Soft-overlap flags concurrent same-slot requests. In-process IP rate limit reduces spam. No FE UI in this phase.

## Scope

- Collection `reservation-request` (no i18n, no Draft & Publish).
- Fields: contact + preferred date/time + guests + occasion/note + `menuSelectionMode` (`later`|`now`) + optional M2M `menuPackages` / `menuItems` + `overlapCount` (soft-overlap only).
- Validation helper + custom create controller; shared form primitives under `src/domain/form-intake/`.
- Soft detect: same `preferredDate` + `preferredTime`, status `new`|`read` → DB `count` into `overlapCount` (still accept create); API derives `hasOverlap`.
- In-memory rate limit per IP **after** successful parse (env `RESERVATION_RATE_LIMIT_MAX`, `RESERVATION_RATE_LIMIT_WINDOW_MS`).
- Public create-only permission bootstrap.
- Smoke: `pnpm run smoke:reservation-form`.
- Docs: content model, API contract, editor guide, architecture, STATUS, AGENTS.

## Non-goals

- Booking engine: table inventory, hard capacity, deposits, payments.
- Email/Zalo/SMS notify, CAPTCHA vendor, Redis distributed rate limit.
- Frontend booking form UI.
- Hard reject on overlap.

## Residual risk (accepted)

- Soft-overlap race under concurrent creates may leave both rows with `overlapCount = 0`.
- In-memory rate limit resets on process restart and does not share across instances.
- No CAPTCHA / email notify until Automation phase.
- Security gate remains Users-Permissions **create only**; do not grant Public find/update/delete.

## Acceptance

### Automated

```powershell
pnpm run test
pnpm run verify:schema
pnpm run typecheck
pnpm run smoke:reservation-form
pnpm run smoke:contact-form
pnpm run check:forms
```

### Manual Admin UAT

- [ ] POST valid `later` → Admin row `status: new`, no menu relations.
- [ ] POST valid `now` with published package/item → relations visible.
- [ ] Two POSTs same date+time → second has `overlapCount >= 1` / response `hasOverlap: true`; Admin filter `overlapCount > 0`.
- [ ] Change status to `read` / `archived`.
- [ ] Public GET `/api/v1/reservation-requests` denied.
- [ ] Client-sent `status` does not stick (always `new` on create).
- [ ] Invalid/honeypot requests do not burn rate limit; rapid **valid** spam → `429` + `RESERVATION_RATE_LIMITED`.

## Rollback

Remove API module + form permission enum entry + smoke; restore docs; drop `reservation_requests` tables if needed.
