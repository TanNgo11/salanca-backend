# Native menu and CMS media correction

Status: Implemented locally; exact visual UAT pending. Owner request: 2026-10-01.
Related phase: ../phases/phase-09-owner-data-refresh.md

The owner requires editable HTML/CSS rather than PDF page images. FE will read
the existing menu-package and menu-item fields. A localized optional menu-page
`priceNote` makes the printed tax/service line editable. Existing clients remain
compatible; FE omits an empty note. No permissions or locale rules change.

The local published Rodizio photo currently points to the carving-service photo.
Audit published image pointers in both locales and existing media first. Snapshot
changed document fields locally before replacing only known old image pointers
with the individual PDF photo. Preserve prices, descriptions, ordering and drafts.
Use Document Service to update and publish the affected localized document only.
Reversal uses the saved field snapshot; uploaded library files remain reusable.

Gates: verify:schema, typecheck, affected CRUD/i18n smoke checks; FE typecheck,
targeted adapter/render tests, browser inspection in VI/EN and mobile widths.
Human visual UAT and production release remain separate gates.

Local result: published Rodizio, story/experience photos and contact map corrected
in VI/EN; localized priceNote published. Rodizio's recognized original seed list
was reordered once to match the PDF. Every later editor order remains in BE.
The idempotent apply rerun exited successfully with no further content writes.
Schema/typecheck passed. Existing smoke:i18n stopped at its protective empty-DB
guard; no real content was cleared. FE evidence: native-menu-verification.md
in the sibling FE repository. No Git release performed.

Buffet label correction: page 6 of the owner PDF places CHURRASCARIA twice on
the leaf, rather than the four invented seed features. Preview the exact old
VI/EN buffet includedItems, reject editor changes and divergent drafts, snapshot
the two affected arrays, then update/publish only those local package fields.
Use scripts/apply-buffet-pdf-label.mjs (preview default, --apply to write).
The FE hides the separate sauce tab; sauce records remain CMS editable and
continue to render alongside salad/sides. No schema or production change.
