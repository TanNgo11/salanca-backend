# Homepage space gallery restoration

Hero follow-up: owner requested the original tableside carving photo and scarlet macaw frame. `--restore-hero` extends the guarded write to `home-page.hero` in both locales, using exactly `hero-churrasco-service-v2.png` (1672x941) and `hero-decor-right.png` (535x1252). Validate originals before upload; preserve the draft guard and recovery snapshot. FE reads `hero.decorativeImage.media` and serves both original PNG URLs without Next.js lossy conversion. File resolution remains the quality limit; no upscaling or generated replacement. Release now contains 43 originals.

Implemented additive optional `home.hero.decorativeImage` schema and refreshed release schema hash. Local hero apply passed in VI/EN, reused five S3 files and wrote recovery `.tmp/home-space-1791010282480/recovery.json`. Backend schema verification/typecheck, two release tests, FE typecheck/lint and eleven adapter tests passed. Browser confirmed direct original PNG URLs and native dimensions for both locales. Mobile title scale is bounded to keep Churrascaria on one line. Build, production E2E, production apply and push remain unrun.

Owner request (2026-10-03): restore the homepage space block shown in the supplied screenshot, with CMS-editable content and media.

Scope: restore `home-page.space.images` in VI/EN to approved main dining room, secondary hall and veranda photography. Keep the existing native responsive gallery, CMS heading and navigation link. No schema change or other homepage block update.

Owner follow-up: also restore the six farm-to-table steps and the botanical booking illustration. `--restore-closing` extends the guarded update to exactly `process`, `space` and `bookingStrip` on the two localized homepages. FE must populate and adapt `bookingStrip.image.media`; no static fallback illustration is used. The release includes 41 originals. The default command keeps its gallery-only scope.

Follow-up local verification: FE typecheck/scoped lint and 11 adapter tests passed; two release tests passed. Local apply restored both locales and uploaded one approved botanical PNG; repeat apply reused all four files. Recovery: `.tmp/home-space-1791007642063/recovery.json`. VI browser confirmed six steps and loaded S3 illustration; EN confirmed translated steps and the same CMS illustration; 375px EN had no horizontal document overflow. Evidence: `salanca-web/.tmp/restored-pages/home-process-restored-vi.png` and `home-booking-restored-vi.png`. Strapi reported pool shutdown warning `aborted` after completed writes; CLI shutdown did not promptly exit. Production/build/E2E remain unrun.

Implementation: release manifest owns the three media references. `node scripts/restore-home-space.mjs` validates the allowlisted originals and checksums, requires configured S3, rejects unpublished homepage edits, and saves populated published/draft recovery JSON before updating only `space` through Strapi Document Service and publishing each locale.

Local verification passed: script syntax, FE typecheck and scoped lint; two localized homepage documents updated, three existing S3 files reused, recovery at `.tmp/home-space-1791007280359/recovery.json`; VI desktop screenshot and EN CMS image URLs checked; 375px EN viewport had no horizontal document overflow. Build, production E2E and production apply not run. This change has not been pushed.
