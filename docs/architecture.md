# Backend architecture

Current architecture map for the Salanca Strapi backend. It describes ownership,
interfaces, and seams. It is not a file inventory.

## System ownership

Strapi owns CMS content, Admin users, Content API authorization, media metadata,
and operational configuration. The sibling Next.js application at
`../salanca-web` will own public rendering and (later) a same-origin BFF if
end-user features appear. The design prototype at `../salanca-cms` is
read-only reference only.

End-user membership and booking engines remain out of the CMS-first milestone.
Public form **lead** APIs (`contact-message`, `reservation-request`) are opened
as Forms phases; they are not booking engines.

## Startup composition

```text
src/index.ts
├─ register
│  ├─ getOrCreateMediaProcessingRuntime # opt-in WebP pipeline
│  └─ registerDocumentInvariants        # single documents.use stack
└─ bootstrap
   ├─ provisionContentLocales           # vi default + en
   ├─ provisionPublicContentPermissions # Public find/findOne allowlist
   ├─ provisionPublicFormPermissions    # Public create-only form intake
   ├─ synchronizeContentManagerLabels
   └─ enforceMediaProcessingUploadSettings
```

`register` extends the Document Service before boot via **one** middleware that
runs ordered handlers (menu, campaign dates, map/social boundaries, then CMS
webhook emit after `next`). Do not add another `strapi.documents.use` for new
invariants — register a handler instead.

`bootstrap` runs only idempotent provisioning. Add startup work here only when
repeated runs are safe and failure should block startup.

Form leads (`contact-message`, `reservation-request`) are not marketing content:
no i18n, no Draft & Publish, Public create only (REST routers use `only: ['create']`).
Shared intake primitives live in `src/domain/form-intake/`; feature validation in
`src/domain/contact-message/` and `src/domain/reservation-request/`. Reservation
uses soft same-slot peer counts (`overlapCount`) and a lazy in-process IP rate
limiter (`src/domain/rate-limit/` + reservation wiring). Public permission grants
(content reads + form creates) share `provisionPublicRoleActions` in
`src/bootstrap/public-permissions/`. Signed CMS webhooks live under
`src/domain/cms-webhook/` (not under `src/api/`).

## Versioned REST and sessions

`config/api-prefix.helper.ts` validates `API_REST_PREFIX` (default `/api/v1`).
`config/plugins.ts` configures Users & Permissions refresh-session mode and
derives the refresh cookie path from that prefix. Public Content API permissions
remain deny-by-default until Phase 6 bootstrap allowlist work.

## CORS

`config/cors.helper.ts` builds the credentialed origin allowlist from
`FRONTEND_URLS` (default `http://localhost:3000`). Entries must be bare origins.

## Media storage

`config/media-storage.helper.ts` owns the S3-compatible upload contract.

- When `S3_BUCKET` is **set**, upload uses `@strapi/provider-upload-aws-s3` and
  requires `S3_REGION`, `S3_ROOT_PATH`, and `CDN_URL`. Startup fails on
  malformed storage settings.
- When `S3_BUCKET` is **unset**, Strapi keeps the local Media Library provider
  for early local development. Staging and production must set object storage.

`src/extensions/upload/` wraps upload `remove` so files still referenced by
documents cannot be deleted.

CSP `img-src` / `media-src` append the CDN origin when CDN is configured.

## Document invariants

`src/domain/document-middleware/` owns the single Document Service middleware.
`src/domain/document-invariants/` holds pure helpers and before-handlers;
`src/domain/cms-webhook/` owns after-handler emit + HMAC helpers:

- Menu items require a category on create/update when category is present.
- Menu categories with linked items cannot be deleted.
- Campaign `endsAt` must be ≥ `startsAt` when both are provided.
- Location / global-setting `mapUrl` and global-setting social links are normalized.
- Publish/unpublish on allowlisted UIDs emit signed webhooks when env is set.

## Public content

`src/bootstrap/public-content-permissions/` grants Public role `find` /
`findOne` on an allowlisted set of content types (published only via Strapi
Draft & Publish). Create/update/delete remain denied for Public marketing
content.

## Public form intake

`src/bootstrap/public-form-permissions/` grants Public role **create only** on
`api::contact-message.contact-message` and
`api::reservation-request.reservation-request`. Smokes:
`pnpm run smoke:contact-form`, `pnpm run smoke:reservation-form`.

Controller bodies live in `src/domain/{contact-message,reservation-request}/handle-*-create.ts`
so the 429 envelope, forced `status`, and error mapping are unit-testable; the
`src/api/**/controllers/` files are thin wrappers.

**Rate limiting keys on `ctx.request.ip`.** Koa only derives that from
`X-Forwarded-For` when `server.proxy.koa` is true, which `config/server.ts`
reads from `KOA_TRUST_PROXY` (default `false`). Behind a reverse proxy with the
flag unset, every request reports the proxy's address and all visitors share one
bucket; with the flag set but no trusted proxy in front, a client can rotate the
header and bypass the limiter. Set it to `true` **only** where a trusted proxy
rewrites the header. The limiter itself is in-process and per instance — it
degrades to per-node quotas, never to a single global bucket.

Demo data: `pnpm run seed:demo` then `pnpm run verify:seed`. Contract smoke:
`pnpm run smoke:api`.

## Quality gates

```powershell
pnpm run test          # Vitest unit tests for helpers
pnpm run verify:schema
pnpm run typecheck
pnpm run build
pnpm run check         # schema + typecheck + test + build
pnpm run check:phase3  # + CRUD/i18n smokes against PostgreSQL
pnpm run seed:demo
pnpm run verify:seed
pnpm run smoke:api
pnpm run check:phase6  # check + seed + verify + public API smoke
```

## Documentation routing

- Status and authorized next work: [`STATUS.md`](./STATUS.md)
- Pattern-lift plan: [`plans/be-pattern-lift-plan.md`](./plans/be-pattern-lift-plan.md)
- Content model: [`cms-content-model.md`](./cms-content-model.md)
- API contract: [`cms-api-contract.md`](./cms-api-contract.md)
- Technical decisions: [`cms-technical-decisions.md`](./cms-technical-decisions.md)
