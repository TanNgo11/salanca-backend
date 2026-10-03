# Backend-only content and S3 seed

Status: Automated verification passed; production apply unrun. Authorized by owner 2026-10-03; supersedes the SFTP/bind-mount operator workflow.
Related phase: ../phases/phase-09-owner-data-refresh.md

## Goal and decisions
One command in the deployed backend seeds the actual published VI/EN marketing snapshot and uploads every referenced original through the configured S3 provider. Ship a curated release manifest and approved source artwork in Git, not database dumps, generated uploads or secrets. Reuse existing approved data/media/salanca sources by SHA256. No sibling checkout, external download, SFTP, pg_dump installation or extra environment variables.

## Implementation
1. Reconcile the 24 snapshot media originals against approved tracked artwork; add any missing approved originals under data/media/salanca. Ship the 166-document snapshot in data/content-release/bundle.json.
2. Add a backend-only seed entry point. Validate complete media/checksums/schema and target draft guard before any upload. Automatically save an affected-document JSON snapshot locally; this is a content recovery artifact, not a full database backup. Use existing upsert/publish pipeline, no pruning or lead/account changes.
3. Require the runtime S3 provider and preserve provider/URL consistency when reusing media. One operator command: node scripts/seed-production-content.mjs. Optional --preview performs no content/media writes.
4. Replace the SFTP runbook; run manifest completeness tests, syntax checks, typecheck/lint and live local preview. Production upload remains unverified without access to the deployed environment.

## Compatibility and rollback
Matching published marketing records are refreshed; unpublished destination edits block the seed. Destination-only records remain. Sequential seed is not atomic: preserve automatic JSON recovery snapshot and any uploaded S3 objects on failure. No automatic reset, delete or restore. Production restore uses platform database backup where available; JSON snapshot supports content reconstruction and is not a pg_dump replacement.

## Acceptance
All placeholder references resolve to shipped assets; source bytes match SHA256. Backend-only preview reports 166 localized documents and 24 files. Seed can be rerun without duplicate documents/media; no tools besides the already deployed Node/dependencies/configuration required.

## Verification record
2026-10-03: backend-only read-only preview passed against the local CMS (166 localized documents, 24 originals); all approved source bytes and collection/media references verified. Seven affected tests passed; script syntax checks, lint and typecheck passed. No content/media writes or production execution were performed. Production S3 write/CDN verification remains an external gate.
