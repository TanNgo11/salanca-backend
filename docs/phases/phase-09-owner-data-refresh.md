# Phase 9 — Owner data refresh

Status: Complete and verified locally, authorized 2026-09-29.

The owner supplied ../Data and authorized bilingual content replacement and necessary frontend templates. Execution plan: [frontend phase 34](../../../salanca-web/plans/phase-34-owner-data-refresh.md).

Final checks passed: lint, schema verification, typecheck, 217 tests and admin build. Published public API reconciliation passed for 8 pages per locale, 56 menu entries, narrative blocks, card details, shared VI/EN IDs and 3,840-pixel hero originals. Final seed created no duplicate records (created=0, updated=134, skipped=63). Frontend check (320 tests/build) and 22 affected browser tests passed. Both development servers remain running.

Applied: 56 items per locale; buffet 950,000/590,000 VND and Rodizio 850,000/490,000 VND; wings 750,000 VND; Steak Salanca without a cut claim; Moqueca without an invented price. Revised DOCX is primary for the five-milestone narrative (including 2020), values and expanded cards. PDF adds Churrasco origins and five 3,840-pixel photo exports mirrored in data/media/salanca. Local CMS originals retain full dimensions.

Owner-refresh reuses existing out-of-scope documents and creates baseline pages/settings only where missing. A full local PostgreSQL snapshot preceded the first write. Read-only reconciliation compares published VI/EN text/prices/portions to the payload, shared IDs and CMS hero widths. No editorial or lead rows are deleted.

Keep VI as default and EN equivalent. Reuse menu-item/category/package schemas, localized text and shared numeric VND prices. Add optional editorial-card detailBody for expandable brand narrative. Apply only selected single types and menu collections through an explicit scoped seed; never prune or overwrite forms/campaigns/gallery. Snapshot affected local documents before the seed. Verify schemas, types, affected tests, public locale reads and frontend rendering. No production deployment is included.
