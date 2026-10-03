# Published content bundle deployment

Status: Automated verification passed; production apply unrun. Owner authorization: create an automatic content/media deployment script, 2026-10-03.

Export actual published VI/EN marketing documents from the local CMS, not frontend mockups. Bundle media bytes with checksums. On the destination, preview document counts; explicit apply first creates a PostgreSQL backup, then uses the existing seed upsert pipeline to upload through the destination S3 provider and publish both locales. Do not transfer accounts, leads, tokens, permissions, drafts or delete absent documents.

Match collections by slug (gallery by title), resolve relations across environments, validate schema compatibility and media integrity before writes. Preserve destination-only entries. Overwrite matching published marketing content only when apply is selected; reject matching unpublished editorial changes. Use production environment configuration on the destination; never copy `.env` or credentials into the bundle.

Verification: helper unit tests, syntax check, local pack + local preview. Production apply remains unrun until a named destination is available. Rollback requires the pre-apply PostgreSQL dump and retained S3 objects; import is sequential and not a single transaction. Stop on errors and report partial writes.

Verified 2026-10-03: 5 helper tests, syntax checks, typecheck, lint and diff check passed. Packed 24 media files; local read-only preview plans 166 localized marketing documents. Inverse relations are computed rather than exported; owning forward relations receive a second restoration pass after destination ids exist. PostgreSQL backup execution and production write/revalidation were not run. No secrets, data bundle or media snapshot are staged in Git.

2026-10-03 owner correction: the operator no longer transfers a bundle through SFTP. The approved release now ships with backend code and is applied with `node scripts/seed-production-content.mjs`; see [replacement plan](backend-content-seed.md). Legacy pack/deploy remains optional developer tooling.
