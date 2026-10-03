# Seed published content and images on Dokploy

The backend ships the approved VI/EN content release and all 24 referenced original images. The image sources are versioned in `data/media/salanca`; `data/content-release/bundle.json` maps them by checksum. This replaces the SFTP and bind-mount workflow.

After deploying the updated backend main, open its container terminal in Dokploy and run from the app directory:

```sh
node scripts/seed-production-content.mjs
```

No bundle path, file copy, sibling frontend repository, extra packages or new environment variables are required. The command uses the backend's existing PostgreSQL and S3 configuration. It checks schema compatibility, every image checksum and unpublished destination edits before uploading. It saves an affected-marketing-content JSON recovery snapshot, uploads original images through Strapi's S3 provider, connects destination media and relations, then upserts and publishes both locales. Repeating the command reuses matching destination S3 media; destination-only documents and leads are preserved. It does not change accounts or public permissions.

Optional read-only preview:

```sh
node scripts/seed-production-content.mjs --preview
```

The release represents the published CMS snapshot captured on 2026-10-03 with the approved original source artwork rather than recompressed upload copies: 166 localized marketing documents and 24 images. Frontend decoration already shipped as static code assets continues to deploy with the frontend repo. The script refreshes matching published marketing records; it is an explicit release operation and is not run automatically on every backend boot.

Recovery snapshots are written with restricted permissions under `.tmp/content-deploy-backups/*-marketing.json`. They preserve populated published/draft marketing records, not a full PostgreSQL database. Seeding is sequential: an error can leave partial updates. Keep the snapshot and uploaded objects, diagnose before retrying; use the platform database backup for full restoration. Draft edits block replacement to preserve editorial work.

Production execution and CDN accessibility have not been verified by the development agent. Existing backend database/S3 configuration must be valid; successful preview does not prove S3 write access.

`content:pack` and `content:deploy` remain optional developer transport tools. They are not required for this operator workflow.

## Experience and space restoration (2026-10-03)
After deploying the updated backend schema and frontend UI, restore only experience/space and their six approved gallery entries with:

```sh
node scripts/seed-production-content.mjs --restore-experience-space
```

This scope does not rewrite menu items, global settings or other pages. An unpublished gallery draft is republished only when all editable content matches the approved old gallery; changed drafts still block. Experience uses localized `flavorCards` (shared.editorial-card) for its four images/captions, independently of menu-item photos. Existing pages without flavorCards keep the flavorItems relation adapter fallback.
