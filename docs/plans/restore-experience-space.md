# Restore experience and space content/layout
Status: In progress. Owner authorized restoration of the old blocks/images, 2026-10-03.
Reference: frontend f3b9865, before the PDF refresh; no branch named mockup is advertised by either remote. The reference is an explicit working assumption pending owner clarification.

Restore the two native page compositions, old approved images and VI/EN seed copy. Keep runtime CMS ownership. Experience cut photos currently reuse menu-item images; add optional shared.editorial-card flavorCards to permit page-specific image/copy editing without overwriting menu images. Older documents retain flavorItems fallback. Restore six gallery entries and space page links.

Ship updated source seed and published release manifest; reuse approved versioned assets. Scope local data writes to experience/space/gallery. Preserve unrelated published content, leads, accounts and editorial drafts. Record populated recovery content before upserts and publishing. No automatic production mutation, no commit/push unless requested.

Verification: schema/typecheck, targeted bilingual adapters and source manifest/reference checks, lint, local CMS/API and responsive browser QA. Production deployment and owner visual acceptance remain open. Rollback: revert additive code and restore affected content from recovery; optional schema field retains backwards compatibility.

## Verification record
2026-10-03: local scoped seed succeeded, 17 destination S3 media created and 16 localized documents updated (two pages plus six gallery entries, VI/EN). Recovery saved under .tmp/content-deploy-backups/1791006061106-marketing.json. Existing unpublished gallery content was compared field-by-field to the approved restoration before republishing; unrelated draft changes remain guarded.
FE: 23 affected adapter tests passed; typecheck and scoped lint passed. BE: schema verification, typecheck, lint and 8 affected seed/guard tests passed. Diff checks passed. VI/EN desktop browser review passed; all four routes at 375px have no horizontal page overflow. Eight screenshots are stored under ../salanca-web/.tmp/restored-pages. Shipped release comparison confirms all other pages, menu collections and global settings remain unchanged.
FE runs at localhost:3001 with STRAPI_API_URL localhost:1338/api/v1; backend runs at 1338. BDS sources at 3000/1337 are preserved. Build, production E2E and production restoration were not run; no commit/push performed. User visual acceptance/reference branch clarification remains open.
