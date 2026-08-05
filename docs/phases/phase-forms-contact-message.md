# Phase Forms MVP — Contact message intake

## Goal

Public website can submit a contact lead; Strapi Admin can triage it. No FE UI in this phase.

## Scope

- Collection `contact-message` (no i18n, no Draft & Publish).
- Validation helper + custom create controller.
- Public create-only permission bootstrap.
- Smoke: `pnpm run smoke:contact-form`.
- Docs: content model, API contract, editor guide, architecture, STATUS.

## Non-goals

- Reservation / booking leads.
- Email notify, CAPTCHA vendor, distributed rate limit (Automation phase).
- Frontend form.

## Residual risk (accepted for MVP)

- No rate limiting beyond field limits + honeypot — production spam risk until Automation phase.
- No CAPTCHA / email notify.
- Security gate remains Users-Permissions **create only**; do not grant Public find/update/delete.

## Acceptance

### Automated

```powershell
pnpm run test
pnpm run verify:schema
pnpm run typecheck
pnpm run smoke:contact-form
pnpm run smoke:api
```

### Manual Admin UAT

- [ ] POST valid payload → row appears in Admin with `status: new`.
- [ ] Change status to `read` / `archived`.
- [ ] Public GET `/api/v1/contact-messages` denied.
- [ ] Client-sent `status` does not stick (always `new` on create).

## Rollback

Remove API module + form permission bootstrap; reverse docs; drop table if needed.
