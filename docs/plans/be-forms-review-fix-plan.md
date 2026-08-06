# Review fixes — Forms MVP intake (contact-message + reservation-request)

Status: Implemented 2026-08-06 (N1–N9); manual UAT rows still open
Owner: Tan Ngo (dev) — N3 and N4 taken at their documented defaults
Last updated: 2026-08-06
Related phase: [`phase-forms-contact-message.md`](../phases/phase-forms-contact-message.md),
[`phase-forms-reservation-request.md`](../phases/phase-forms-reservation-request.md)

## Goal

Close the defects found while reviewing the two public form intake endpoints so the reservation
rate limit actually protects per visitor instead of locking out the whole site, an English-page
guest can select the menu they were shown, and `overlapCount` means what the Admin triage flow
claims it means.

## Non-goals

- CAPTCHA vendor, email/Zalo/SMS notify, Redis distributed rate limit — Automation phase.
- Turning the reservation lead into a booking engine (inventory, hard capacity, deposits).
- Frontend form UI for either endpoint.
- The 11 findings of the Phase 11–15 lift — tracked separately in
  [`be-phase-11-15-review-fix-plan.md`](be-phase-11-15-review-fix-plan.md), still unimplemented.

## Current evidence

Reviewed on commit `38724b8` (branch `fix/flaky-media-processing-test`), clean tree.
`pnpm run test`: 25 files / 167 tests pass. Code read:
[`src/domain/form-intake/*`](../../src/domain/form-intake/),
[`src/domain/rate-limit/in-memory-rate-limit.ts`](../../src/domain/rate-limit/in-memory-rate-limit.ts),
[`src/domain/reservation-request/*`](../../src/domain/reservation-request/),
[`src/domain/contact-message/contact-message.validation.ts`](../../src/domain/contact-message/contact-message.validation.ts),
[`src/api/reservation-request/controllers/reservation-request.ts`](../../src/api/reservation-request/controllers/reservation-request.ts),
[`src/api/contact-message/controllers/contact-message.ts`](../../src/api/contact-message/controllers/contact-message.ts),
[`src/bootstrap/public-form-permissions/*`](../../src/bootstrap/public-form-permissions/),
[`src/bootstrap/public-permissions/provision-public-role-actions.ts`](../../src/bootstrap/public-permissions/provision-public-role-actions.ts),
[`config/server.ts`](../../config/server.ts), plus `@strapi/core@5.51.1` runtime sources
(`dist/services/server/index.js`, `dist/configuration/index.js`).

What is genuinely good (do not "fix"): both validators are pure and Strapi-free; the
`form-intake/` primitives were extracted on the *second* form rather than speculatively; honeypot
rejections do not leak why they failed; `status` is forced server-side so a client-sent `status`
cannot stick; permissions are a create-only enum behind `only: ['create']` routers; error codes
are enums the FE can branch on; `parseBoundedInt` rejects non-canonical `"08"` / `"4.0"`;
`isValidCalendarDate` + `todayInHoChiMinh` reject `2026-02-31` and yesterday without trusting
the server clock's timezone.

### Findings

| ID | Severity | Finding |
| --- | --- | --- |
| N1 | P1 | Reservation rate limit keys on the reverse proxy's IP — one shared bucket for the whole internet |
| N2 | P2 | Menu documentId validation ignores the submitter's locale; EN selections can be rejected |
| N3 | P2 | `contact-message` still has no rate limit although the limiter now exists |
| N4 | P2 | `overlapCount` is unreliable because `preferredTime` has no pinned format |
| N5 | P3 | Rate-limit quota is burned by requests that then fail menu validation |
| N6 | P3 | `RESERVATION_RATE_LIMIT_*` are undocumented in `.env.example` |
| N7 | P3 | `parsePositiveIntEnv` is a third private `process.env` reader |
| N8 | P3 | Public permission provisioning is check-then-create under `Promise.all` |
| N9 | P3 | Neither form controller has a test; only the validators are covered |

#### N1 — Rate limit keys on the proxy IP (P1)

[`client-ip.ts:8`](../../src/domain/form-intake/client-ip.ts#L8) reads `ctx.request.ip`. Koa's
trust-proxy flag is fed from `server.proxy.koa`
(`@strapi/core/dist/services/server/index.js:23` → `createKoaApp({ proxy })`), and Strapi defaults
the whole `proxy` key to `false` (`@strapi/core/dist/configuration/index.js:28`).
[`config/server.ts`](../../config/server.ts) never sets it.

Behind any reverse proxy or load balancer — i.e. staging and production — `ctx.request.ip` is the
proxy's own address for every request. All visitors therefore share a single 5-per-10-minute
bucket: the 6th reservation submitted from anywhere in 10 minutes returns `429` to everyone. This
is an availability defect, not only a security one, and it appears the moment the app moves off
`localhost`.

The fix must be env-gated. Enabling Koa proxy trust without a proxy that overwrites
`X-Forwarded-For` makes the header client-controlled, which turns the limiter into a no-op by
header rotation. Correct only where a trusted proxy terminates.

#### N2 — Menu validation is locale-blind (P2)

[`resolve-menu-selection.ts:25-33`](../../src/domain/reservation-request/resolve-menu-selection.ts#L25-L33)
calls `documents(uid).findMany({ status: 'published' })` with no `locale`. `menu-item` and
`menu-package` are `i18n.localized: true`, so the lookup resolves only the default (`vi`) entry.

- A guest on the EN page selecting an item whose `vi` entry is draft or `isActive: false` gets
  `RESERVATION_MENU_IDS_INVALID` for something the EN page showed as published.
- On success, `connect` attaches by `documentId` without a locale, so the stored relation is not
  necessarily the row the guest saw.

`parsed.sourceLocale` is already validated and sits unused two lines away in the controller.

#### N3 — contact-message has no rate limit (P2)

[`phase-forms-contact-message.md:23`](../phases/phase-forms-contact-message.md#L23) records "no rate
limiting beyond field limits + honeypot" as accepted residual risk. That was reasonable when
written — no limiter existed. Forms-2 then shipped `InMemoryRateLimit` and `resolveClientIp` as
reusable primitives, so the accepted risk is now roughly six lines from being closed on a public
endpoint that writes a 4000-character row per POST with only a honeypot in front of it.
Either wire it or restate the acceptance against the new cost.

#### N4 — `overlapCount` depends on an unconstrained time string (P2)

[`count-slot-peers.ts:54-60`](../../src/domain/reservation-request/count-slot-peers.ts#L54-L60)
matches on exact string equality, but `preferredTime` is a free `string` (max 40) in both
[the schema](../../src/api/reservation-request/content-types/reservation-request/schema.json#L31-L35)
and [the validator](../../src/domain/reservation-request/reservation-request.validation.ts#L256-L263).
`"19:00"`, `"7:00 PM"` and `"19h"` are three different slots, so `hasOverlap` silently
under-reports. The phase spec's Admin UAT step "filter `overlapCount > 0`" only carries meaning
with a canonical format. No FE form exists yet (explicit phase non-goal), so tightening now costs
no client migration.

#### N5 — Quota burned by later failures (P3)

[`reservation-request.ts:64`](../../src/api/reservation-request/controllers/reservation-request.ts#L64)
says the limiter runs after parse "so invalid/honeypot traffic does not burn quota", but menu
resolution happens *after* consumption: a `RESERVATION_MENU_IDS_INVALID` 400 still costs a slot.
Consuming before the DB work is the right call for a limiter — the defect is the comment and the
API contract, which promise a guarantee the code does not give.

#### N6 — Undocumented env knobs (P3)

`RESERVATION_RATE_LIMIT_MAX` and `RESERVATION_RATE_LIMIT_WINDOW_MS` are the only tuning knobs for
the spam control and appear in [`cms-api-contract.md:205`](../cms-api-contract.md#L205), but not in
`.env.example`. An operator reading the env template cannot discover them.

#### N7 — Third private env reader (P3)

[`in-memory-rate-limit.ts:153`](../../src/domain/rate-limit/in-memory-rate-limit.ts#L153) parses
`process.env` directly. `config/env.helper.ts` takes Strapi's injected `env` reader and
`media-processing/config.ts` takes its own `EnvReader` shape, so this is a third convention. Note
`config/env.helper.ts` is *not* a drop-in here: it requires the `ConfigParams['env']` callable,
which a lazily constructed runtime singleton does not have. Scope the fix to deduplicating the
positive-int parser, not to unifying all three readers.

#### N8 — Permission provisioning races (P3)

[`provision-public-role-actions.ts:66`](../../src/bootstrap/public-permissions/provision-public-role-actions.ts#L66)
runs `ensurePublicPermission` under `Promise.all`; each is a `findFirst`-then-`create` with no
unique constraint behind it. Two instances booting at once, or a restart storm, can insert
duplicate permission rows. Low likelihood while single-instance; a sequential loop costs nothing.

#### N9 — Untested controllers (P3)

`parseReservationRequestInput` and `parseContactMessageInput` are well covered (224 + 163 lines of
tests). The controllers have none: the `429` envelope and `Retry-After` header, `status` forced to
`new`, the `overlapCount` / `hasOverlap` echo, and `FormValidationError` → `ApplicationError`
mapping are only exercised by `smoke:*-form`, which need a live server plus Postgres and therefore
never run in `pnpm run test`. Same gap class as F7 in the Phase 11–15 plan, different surface.

## Decisions and assumptions

- Decision: keep the in-process limiter (no Redis) — Automation-phase scope, unchanged here.
- Decision: consumption stays before menu resolution (N5 is fixed in docs, not in code); a limiter
  that runs after DB work does not protect the DB.
- Assumption: `documents(uid).findMany({ locale })` on a localized target returns that locale's
  published row, and `connect: [{ documentId }]` from a non-localized source resolves to it.
  Verified by the N2 manual UAT step, not assumed silently.
- Assumption: no production rows exist yet, so tightening `preferredTime` (N4) needs no backfill.
  Verified against [`STATUS.md`](../STATUS.md) — Phase 7 staging is still open.
- Owner decision required: **N3** — wire the contact form to the limiter now, or keep the
  documented acceptance until the Automation phase. Blocks step 4 only; default is wire it.
- Owner decision required: **N4** — pin `preferredTime` to 24-hour `HH:mm`, or keep free text and
  drop the overlap claim from the Admin triage flow. Blocks step 3 only; default is pin it.

## Invariants

- Public role keeps **create-only** on both lead content types; no `find`/`update`/`delete`.
- Client-supplied `status` is never persisted; create always forces `new`.
- The honeypot response never reveals that a honeypot exists.
- Rate limiting degrades to per-process, per-instance — never to a single global bucket.
- Menu relations only ever connect published, `isActive` documents.
- No email, CAPTCHA, or third-party call is added by any step here.

## Implementation steps

1. **N1 — key the limiter on the real client IP**
   - Files: `config/server.ts`, `config/server.test.ts` (new), `.env.example`,
     `docs/architecture.md`, `docs/cms-api-contract.md`
   - Add `proxy: { koa: env.bool('KOA_TRUST_PROXY', false) }` to the server config. Document that
     it must be `true` only when a trusted proxy rewrites `X-Forwarded-For`, and `false` when
     Strapi is internet-facing directly.
   - Verification: `config/server.test.ts` asserts the flag maps from `KOA_TRUST_PROXY` and
     defaults to `false`. Manually: with `KOA_TRUST_PROXY=true` behind a local proxy sending
     `X-Forwarded-For`, two different forwarded IPs get independent quotas; with it unset they
     share one.
2. **N2 — resolve the menu in the submitter's locale**
   - Files: `src/domain/reservation-request/resolve-menu-selection.ts`,
     `src/api/reservation-request/controllers/reservation-request.ts`
   - Thread `parsed.sourceLocale` into `resolveMenuSelection` and pass it as `locale` to both
     `findMany` calls.
   - Verification: seed an item published in `en` only, POST with `sourceLocale: "en"` → `201`;
     the same POST with `sourceLocale: "vi"` → `RESERVATION_MENU_IDS_INVALID`. Confirm in Admin
     which locale row the relation points at, and record the answer against the assumption above.
3. **N4 — pin `preferredTime`** *(after owner confirms)*
   - Files: `src/domain/reservation-request/reservation-request.validation.ts`,
     `src/domain/reservation-request/reservation-request.validation.test.ts`,
     `docs/cms-api-contract.md`, `docs/cms-content-model.md`
   - Add `PreferredTimeInvalid = 'RESERVATION_PREFERRED_TIME_INVALID'` and enforce
     `^([01]\d|2[0-3]):[0-5]\d$` after the bounded-string check. Leave the column at 40 chars so
     no schema migration is needed.
   - Verification: unit tests for `"19:00"` accepted, `"7:00 PM"` / `"19h"` / `"24:00"` rejected;
     `pnpm run verify:schema`.
4. **N3 — rate limit the contact form** *(after owner confirms)*
   - Files: `src/domain/form-intake/write-application-error.ts` (new, extracted from the
     reservation controller), `src/domain/contact-message/contact-rate-limit.ts` (new),
     `src/api/contact-message/controllers/contact-message.ts`,
     `src/api/reservation-request/controllers/reservation-request.ts`, `.env.example`
   - Extract `writeApplicationError` so both controllers share one 429 envelope. Mirror the
     reservation limiter with `CONTACT_RATE_LIMIT_MAX` / `CONTACT_RATE_LIMIT_WINDOW_MS` and a
     `CONTACT_RATE_LIMITED` code, consumed after parse.
   - Verification: unit test over the extracted writer; `pnpm run smoke:contact-form` still green;
     manual rapid-fire valid POSTs → `429` with `CONTACT_RATE_LIMITED`.
5. **N9 — cover the controller behavior**
   - Files: `src/domain/reservation-request/handle-reservation-create.ts` (new),
     `src/domain/contact-message/handle-contact-create.ts` (new), matching `.test.ts` files, both
     controllers reduced to thin `factories.createCoreController` wrappers
   - Move the handler bodies into functions taking `(strapi, ctx)` so they are testable with stubs
     instead of a booted Strapi.
   - Cases: validation error → `ApplicationError` carrying the original `code`; `429` envelope +
     `Retry-After`; client `status: "archived"` ignored; `hasOverlap` derived from the stored
     count; menu resolve failure surfaces as `RESERVATION_MENU_IDS_INVALID`.
   - Verification: `pnpm run test`.
6. **N5–N8 — cleanups**
   - N5: correct the comment at `reservation-request.ts:64` and the `cms-api-contract.md` row to
     state that menu-validation failures do consume quota.
   - N6: add `RESERVATION_RATE_LIMIT_MAX` / `_WINDOW_MS` (and `CONTACT_RATE_LIMIT_*` if step 4
     lands) to `.env.example`, commented with their defaults.
   - N7: move `parsePositiveIntEnv` to `src/shared/env/parse-positive-int.ts` and import it from
     both limiter factories; leave `config/env.helper.ts` and `media-processing/config.ts` alone.
   - N8: replace the `Promise.all` in `provisionPublicRoleActions` with a sequential `for…of`.
   - Verification: `pnpm run check`.

## Data and rollback

- Migration/backfill: none. Step 3 tightens validation only; the `preferredTime` column keeps
  `maxLength: 40`. No column is added, widened, or dropped.
- Compatibility: no public response shape changes. Step 3 narrows accepted input for an endpoint
  with no FE client yet. Step 1 changes only how the request IP is derived. Step 4 adds a new
  `429` failure mode to `POST /contact-messages` that the FE must handle like the reservation one.
- Rollback: every step is forward-only code; reverting the commit restores prior behavior. Step 1
  is additionally reversible at runtime by unsetting `KOA_TRUST_PROXY`.

## Verification

- Automated: `pnpm run check` (lint → verify:schema → typecheck → test → build).
- With Postgres up: `pnpm run check:forms`, then `pnpm run seed:demo && pnpm run verify:seed`.
- Manual UAT:
  - [ ] Behind a proxy with `KOA_TRUST_PROXY=true`, two forwarded IPs get independent quotas.
  - [ ] EN-locale POST referencing an EN-published menu item → `201`, relation visible in Admin.
  - [ ] `preferredTime: "7:00 PM"` → `RESERVATION_PREFERRED_TIME_INVALID`.
  - [ ] Two POSTs at the same `HH:mm` → second reports `hasOverlap: true`.
  - [ ] Rapid valid contact POSTs → `429` `CONTACT_RATE_LIMITED` (if step 4 lands).
  - [ ] Public `GET /api/v1/reservation-requests` and `/contact-messages` still denied.
- Evidence to record: append a pass/fail table with the run date to `docs/STATUS.md`.

## Documentation impact

- `docs/architecture.md` — `KOA_TRUST_PROXY` and what the limiter keys on.
- `docs/cms-api-contract.md` — `preferredTime` format, contact 429 row, N5 quota wording.
- `docs/cms-content-model.md` — `preferredTime` canonical format.
- `docs/phases/phase-forms-contact-message.md` — residual-risk entry resolved or restated (N3).
- `docs/STATUS.md` — link this plan under the Forms entries.
- `.env.example` — rate limit knobs, `KOA_TRUST_PROXY`.

## Risks and blockers

- Enabling `KOA_TRUST_PROXY` where no trusted proxy exists makes the limiter bypassable via
  `X-Forwarded-For`. Mitigated by defaulting to `false` and documenting the precondition. Trigger
  to revisit: any deployment topology change in front of Strapi.
- Per-locale menu lookup (N2) can reject `vi` submissions that previously passed if a menu item is
  published in `en` only — that is the correct behavior, but it will look like a regression to an
  editor. Mitigated by naming the missing id in the error message, which it already does.
- Pinning `preferredTime` (N4) will reject anything the FE later sends in a locale-formatted
  string. Mitigated by fixing the format in the API contract before the FE form is built.
- The in-memory map still grows per distinct key between prunes; with N1 fixed it grows per real
  client IP. Mitigated by the existing expiry prune. Trigger to revisit: memory growth on staging.

## Completion record

Implemented 2026-08-06 on branch `fix/flaky-media-processing-test`. Gates:
`lint`, `verify:schema`, `typecheck`, `test` (31 files / 211 tests), `build` — all pass.

| ID | Outcome |
| --- | --- |
| N1 | `config/server.ts` adds `proxy.koa` from `KOA_TRUST_PROXY` (default `false`); `config/server.test.ts` covers both directions |
| N2 | `resolveMenuSelection` takes a `locale` and passes it to both `findMany` calls; the handler threads `parsed.sourceLocale` |
| N3 | Wired (default taken). `contact-rate-limit.ts` mirrors the reservation limiter; `CONTACT_RATE_LIMITED` + `Retry-After` |
| N4 | Pinned (default taken). `^([01]\d\|2[0-3]):[0-5]\d$` + `RESERVATION_PREFERRED_TIME_INVALID`; column left at 40 chars |
| N5 | Fixed in docs, not code — `cms-api-contract.md` now states menu-validation failures consume quota |
| N6 | `RESERVATION_RATE_LIMIT_*`, `CONTACT_RATE_LIMIT_*` and `KOA_TRUST_PROXY` added to `.env.example` |
| N7 | `parsePositiveIntEnv` moved to `src/shared/env/parse-positive-int.ts`; `config/env.helper.ts` and `media-processing/config.ts` untouched as scoped |
| N8 | `provisionPublicRoleActions` loops sequentially instead of `Promise.all` |
| N9 | Handlers extracted to `handle-{contact,reservation}-create.ts`; controllers are thin wrappers; 12 new tests |

Deviation from the plan: step 4 named `write-application-error.ts` as the shared
extraction. It also carries `writeRateLimited`, since both call sites needed the
same `Retry-After` arithmetic, not just the envelope.

Still open (needs a real environment): the manual UAT checklist above, and
`pnpm run check:forms` against Postgres.
