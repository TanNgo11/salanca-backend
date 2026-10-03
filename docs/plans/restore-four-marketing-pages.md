# Restore four marketing pages

Status: Ready for production deployment
Owner: Site owner
Last updated: 2026-10-03

## Goal and evidence

Owner requests Experience, Space, Offers and Contact match demo.salancarest.com.vn, with published Strapi content and original photos. Production Offers still has PDF birds, duplicate featured paragraphs and duplicate event links. Space production still contains PDF content and empty galleries. Contact was replaced with PDF artwork.

## Implementation

1. Capture demo and production pages; restore approved native components and decorations from f3b9865, retaining CMS adapters and responsive fixes.
2. Add optional Contact socialImages (repeatable shared.image). Populate and render CMS media; allow older schema during rolling deployment.
3. Merge approved Contact and Offers data into shipped content release. Extend existing guarded restoration to --restore-marketing-pages: four pages, campaign and gallery collections only. Preserve global contact facts, menu, homepage, leads and unpublished edits.
4. Verify schema, adapter tests, typecheck, lint and local VI/EN pages; capture desktop/mobile evidence. Audit dependencies, commit and push both main branches.

## Data and rollback

Seed validates schema/checksums, saves populated recovery snapshots, refuses unpublished edits and never prunes. Images upload through configured S3 provider. New socialImages is optional; old schemas receive a bounded populate retry. Revert FE components for code rollback; recover approved fields from recorded snapshots for content rollback. Production content requires executing the shipped restoration script after BE deployment; pushing Git alone does not update published CMS records.

## Gates

Local verification passed: FE 50 adapter/compatibility tests, targeted lint and TypeScript; BE schema, TypeScript and six bundle tests. Local scoped seed updated 36 localized documents and uploaded eight missing original images; rerun created zero images and skipped 25 existing ones. Browser checked eight VI/EN routes and four VI mobile pages without horizontal overflow; local evidence is in sibling FE .tmp/restored-pages. Location opening hours are restored from approved demo content while other location facts stay intact. pnpm audit reports 0 critical, 37 high, 56 moderate and 5 low with unchanged dependencies. Production build/form submission E2E not run for this urgent restore. Production deployment and scoped seed execution remain external gates; no production shell access is configured here.
