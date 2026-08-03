# Backend architecture

Current architecture map for the Salanca Strapi backend. It describes ownership,
interfaces, and seams. It is not a file inventory.

## System ownership

Strapi owns CMS content, Admin users, Content API authorization, media metadata,
and operational configuration. The sibling Next.js application at
`../salanca-web` will own public rendering and (later) a same-origin BFF if
end-user features appear. The design prototype at `../salanca-cms` is
read-only reference only.

End-user membership, booking engines, and write-form APIs are out of the
CMS-first milestone.

## Startup composition

```text
src/index.ts
├─ register
│  └─ registerDocumentInvariants        # menu relations, campaign dates
└─ bootstrap
   ├─ provisionContentLocales           # vi default + en
   └─ provisionPublicContentPermissions # Public find/findOne allowlist
```

`register` extends the Document Service before boot. `bootstrap` runs only
idempotent provisioning. Add startup work here only when repeated runs are safe
and failure should block startup.

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

`src/domain/document-invariants/` holds pure helpers plus the Document Service
middleware registration:

- Menu items require a category on create/update when category is present.
- Menu categories with linked items cannot be deleted.
- Campaign `endsAt` must be ≥ `startsAt` when both are provided.

## Public content

`src/bootstrap/public-content-permissions/` grants Public role `find` /
`findOne` on an allowlisted set of content types (published only via Strapi
Draft & Publish). Create/update/delete remain denied for Public.

Demo data: `npm run seed:demo` then `npm run verify:seed`. Contract smoke:
`npm run smoke:api`.

## Quality gates

```powershell
npm run test          # Vitest unit tests for helpers
npm run verify:schema
npm run typecheck
npm run build
npm run check         # schema + typecheck + test + build
npm run check:phase3  # + CRUD/i18n smokes against PostgreSQL
npm run seed:demo
npm run verify:seed
npm run smoke:api
npm run check:phase6  # check + seed + verify + public API smoke
```

## Documentation routing

- Status and authorized next work: [`STATUS.md`](./STATUS.md)
- Pattern-lift plan: [`plans/be-pattern-lift-plan.md`](./plans/be-pattern-lift-plan.md)
- Content model: [`cms-content-model.md`](./cms-content-model.md)
- API contract: [`cms-api-contract.md`](./cms-api-contract.md)
- Technical decisions: [`cms-technical-decisions.md`](./cms-technical-decisions.md)
