# Admin activity audit log (lift from batdongsan-cms)

Status: Implemented — automated verification run 2026-10-04; manual Admin UAT open
Owner: Salanca technical owner
Last updated: 2026-10-04
Related phase: none (owner-requested lift; reference implementation `../../batdongsan-cms/backend-bds`, `plans/admin-audit-log/README.md`)

## Goal

Authorized Strapi staff open one Vietnamese, read-only Admin screen
`Nhật ký hoạt động` that answers who did what, when, to which CMS object, and
whether it succeeded. Same contracts as the BDS audit log, trimmed to Salanca's
surface (no end-user auth, no business domain events).

## Non-goals

- No Strapi Enterprise Audit Logs, no community audit plugin.
- No purge/retention job, no delete/update route for audit rows (owner decision: keep forever).
- No hash chaining, SIEM forwarding, or compliance-grade guarantee.
- No capture of public Content API form submits (`contact-message`, `reservation-request` create).
- No `pnpm patch` of `@strapi/*` dist files.
- No frontend (`salanca-web`) change.

## Current evidence

- Strapi 5.51.1 Community; no audit collection exists (`docs/STATUS.md`: Wave 3 webhooks shipped "no audit CT").
- `src/middlewares/http-log` (`@tanngo11/log` `strapiRequestLogger`) runs first and already sets a server-issued UUID on `ctx.state.requestId` + `X-Request-ID` (covered by `http-log.test.ts`).
- `src/extensions/upload/strapi-server.ts` already decorates the upload service (`remove` reference guard, image optimize).
- Upstream `@strapi/upload@5.51.1` (verified on unpkg): `remove()` emits `media.delete` **before** the row delete, and a name-only folder update emits **no** `media-folder.update`. BDS fixes this with a dist patch.
- Local `node_modules/.pnpm/@strapi+upload@5.51.1_*/.../services/upload.js` and `folder.js` already contain the BDS server hunks although Salanca has no `patchedDependencies` (shared pnpm store contamination). Local behavior therefore differs from a clean install; code and tests must not depend on it.
- `@strapi/design-system@2.2.3`, `@strapi/icons@2.2.3`, `react-intl@6.6.2` are present transitively but not declared.

## Decisions

- Decision (owner, 2026-10-04): full lift like BDS — ledger, capture, Admin read/detail/CSV API, Admin screen.
- Decision (owner): keep history forever.
- Decision (owner): follow BDS, improve where it fits Salanca. Improvements adopted:
  1. Media delete and folder rename are captured from the existing upload extension (wrap `upload.remove` and `folder.update`, write after the wrapped call resolves) instead of patching dist. EventHub `media.delete` and `media-folder.update` are ignored to keep one row per target.
  2. Reuse `ctx.state.requestId` from `http-log`; no second correlation middleware. Missing/invalid value → generate a UUID for the audit row only (never overwrite state).
  3. No legacy `eventSource` inference: the table is new, every row persists an explicit source (`admin_panel`).
  4. Plain CSS instead of SCSS (no `sass` dependency).
  5. No typed-domain suppression registry beyond the ledger UID and the audit-log Admin routes themselves.
- Decision: `AUDIT_IDENTIFIER_HASH_SECRET` is required at boot (fail-fast in `config/middlewares.ts`), added to `.env.example` and `scripts/generate-strapi-secrets.mjs`. Deploy must set it before release.

## Invariants (copied from BDS locked contracts, Salanca scope)

1. Cardinality: Content Manager / Media → one row per mutated target (bulk shares requestId). Admin user/role metadata → one row per target. Role-permission save → one summary row (from HTTP classifier). Login, token, webhook → one row per request.
2. `permission.*`, `admin.auth.success`, `admin.auth.error` EventHub events are never persisted.
3. One server request ID per HTTP request (from `http-log`).
4. Capture only when route type is `admin` and an admin user is present (except login outcome via HTTP classifier).
5. Search: trimmed 2–100 chars; prefix match on normalized actor/target labels, exact match on eventId/requestId/targetDocumentId; requires explicit `[from, toExclusive)` ≤ 366 days.
6. Dates are half-open UTC instants; UI default last 30 days in `Asia/Ho_Chi_Minh`; no manual +7h.
7. CSV: UTF-8 BOM, formula-escaped, range ≤ 31 days, ≤ 5,000 rows, Vietnamese header, fails (no truncation) when larger.
8. Framework capture is best-effort post-commit: write failure logs event name, requestId, safe target identity via `strapi.log.error` and never fails the source request.
9. Never store request/response bodies, headers, cookies, tokens, passwords, or lead field values. CMS update rows store only sorted changed top-level field names. Failed login stores HMAC fingerprint + masked identifier.
10. Audit rows: hidden from Content Manager and CTB, no Content API routes, no Admin mutation route; writes bypass generic capture (no recursion).

## Implementation steps

1. Ledger + domain write path
   - `src/api/audit-event/content-types/audit-event/schema.json` (+ minimal `index`/routes-free API), `src/domain/audit/*` (types, payload normalization, target label, identifier HMAC, actor, writer, service, suppression).
   - Enums limited to: `cms_entry_{create,update,delete,publish,unpublish}`, `media_{create,update,delete}`, `media_folder_{create,update,delete}`, `admin_user_{create,update,activate,deactivate,delete}`, `admin_role_{create,update,delete,permissions_update}`, `admin_login_{success,failure}`, `admin_logout`, `api_token_{create,update,regenerate,revoke}`, `transfer_token_{create,update,regenerate,revoke}`, `webhook_{create,update,delete}`.
2. Capture
   - EventHub subscriber registered in `register()`; HTTP classifier middleware `src/middlewares/admin-audit-http` after `strapi::body`; upload extension wrappers for media delete / folder update.
3. Admin read API + RBAC
   - `src/api/audit-log/*`: routes `GET /admin/audit-log/events`, `/events/:eventId`, `/export`; actions `admin::audit-log.read|details|export`; Super Admin reset at bootstrap; idempotent PostgreSQL indexes (occurred_at; action+occurred_at; actor+occurred_at; success+occurred_at; target_document_id+occurred_at; `lower(actor_label) text_pattern_ops`, `lower(target_label) text_pattern_ops`).
4. Admin screen
   - `src/admin/audit-log/*`, menu link in `src/admin/app.tsx` (registered in all build modes, permission-gated), Vietnamese labels incl. Salanca content-type names.
5. Docs: `docs/cms-technical-decisions.md`, `docs/cms-content-model.md`, `docs/admin-roles.md`, `docs/cms-editor-guide.md`, `docs/STATUS.md`, `.env.example`.

## Verification

- `pnpm run lint`, `pnpm run verify:schema`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`.
- Unit tests ported/adapted from BDS: eventhub mapping, HTTP classifier, payload normalization, query/date/export, mapper, indexes, upload wrappers.
- `pnpm run smoke:crud` against local PostgreSQL, then confirm `audit_events` rows for create/update/publish/delete with matching request IDs.

## Data and rollback

- New table `audit_events` only; no existing data rewritten. Rollback = revert code; table can stay (inert) or be dropped manually by the owner.

## Manual UAT

- Super Admin sees `Nhật ký hoạt động`; Editor without `audit-log.read` does not and gets 403 on the API.
- Edit/publish a VI and EN entry, upload/delete media, rename a folder, failed + successful login, create/revoke an API token → one row each, correct Vietnamese labels.
- CSV opens correctly in Excel (Vietnamese diacritics).
