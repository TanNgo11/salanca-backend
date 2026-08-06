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
- Distributed rate limit (Redis) — still Automation residual.
- Frontend form (shipped later in salanca-web).

## Residual risk (accepted for MVP)

- No rate limiting beyond field limits + honeypot — production spam risk until Redis.
- Cloudflare Turnstile is **opt-in** (`TURNSTILE_SECRET_KEY`); leave unset for smoke; set in staging/production.
- Staff email notify is **opt-in** (`EMAIL_SMTP_HOST` + `FORM_NOTIFY_TO`); see `docs/resend-email-operations.md`.
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
