# A la carte PDF correction

Status: Implementation ready; visual review blocked by saved localhost browser permission. Not pushed.
Owner request: 2026-10-03. Review before push.
Reference: owner menu333666.pdf pages 12–14 (A la carte and Dessert).

## Evidence and fix
The extracted steak photograph faces left but the PDF mirrors it to the right. FE guesses mirroring from a media filename; production checksum names break that guess. Add optional shared.image.mirrorHorizontally, read it in the menu adapter and seed the steak original as mirrored. Keep text/price native and CMS-editable. Restore two-line A LA CARTE / MENU hierarchy and PDF spacing; preserve mobile readable flow.

## Invariants and gates
No URL/file-name detection, no baked text, no frontend business copy. VI/EN, editor-replacement behavior, schema/typecheck, targeted tests and desktop/mobile screenshots. Update the existing single production seed release; no additional operator script. No push until review.

## Rollback
Git revert restores code; optional field defaults false. Existing content is preserved by draft guards/recovery snapshots. Local apply only; production unrun.

## Verification, 2026-10-03
The steak orientation is a CMS boolean, with native editable title, description and price. Dessert uses the original fruit media from CMS, a two-line CMS heading and paid items; included desserts remain in the buffet content. Original fonts are retained. Six local VI/EN records were updated with draft checks and recovery snapshots.

FE targeted tests, typecheck and lint passed. Backend model validation, typecheck, lint and release tests passed. The final single-entry preview passed: 178 localized documents and 48 media files, no pruning. Browser navigation to localhost:3001 is blocked by a saved permission; no desktop/mobile screenshots of the changed menu were obtained. Visual fidelity is not yet verified. User review is required before push.
