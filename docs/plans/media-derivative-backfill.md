# Media derivatives: breakpoints, Cache-Control, backfill

Status: Automated verification passed
Owner: unresolved (operator for staging/production apply)
Last updated: 2026-10-06
Related phase: web plan `salanca-web/plans/2026-10-06-media-derivative-flow.md` (step 4, step 8)

## Goal

The web renders Strapi upload derivatives (`file.formats`) directly via `srcset`
instead of `/_next/image`. The backend must generate a useful width ladder,
store objects with a long-lived cache header, and bring existing media in line.

## Non-goals

- No change to originals' `url`/`hash`/`name` (seed data hardcodes some URLs).
- No AVIF/LQIP, no new image service, no change to the media-processing pipeline.
- Admin "Replace media" stores the new file under a fresh hash, keeps old
  objects, and sends a `media.replace` webhook (owner decision 2026-10-06).

## Current evidence (Strapi 5.51.1)

- `@strapi/upload/dist/server/services/image-manipulation.js:174` reads
  `strapi.config.get('plugin::upload.breakpoints', DEFAULT_BREAKPOINTS)`; defaults
  `large/medium/small` at :169-173; eligibility `breakpoint < width || breakpoint < height`
  at :206-208; derivative `name`/`hash` = `${key}_${file.name|hash}` at :198-199;
  `generateResponsiveFormats` returns `[]` unless setting `responsiveDimensions` (:176-177).
- `@strapi/provider-upload-aws-s3/dist/index.js:158-206`: PutObject params are
  `Bucket`, `Key`, `Body`, `ACL` (from `s3Options.params`), `ContentType`, then
  `...customParams`. Other `s3Options.params` keys are ignored.
- `@strapi/upload/dist/server/register.js:86-88` wraps each provider method as
  `(file, options = actionOptions[methodName])`, so `actionOptions.upload` /
  `uploadStream` become `customParams`.
- `@strapi/upload/dist/server/services/upload.js:348-351`: Replace keeps `hash` and `ext`.

## Decisions and assumptions

- Decision (task): breakpoints `w640/w960/w1280/w1920`; names differ from defaults.
- Deviation from the request: `CacheControl` lives in `actionOptions`
  (upload/uploadStream/replace/replaceStream), not `s3Options.params`, because the
  provider ignores it there (evidence above).
- Assumption: production runs with `MEDIA_PROCESSING_ENABLED=true` so
  `responsiveDimensions` is on; the backfill refuses `--apply` otherwise.

## Implementation steps

1. Config: `config/plugins.ts` (`uploadBreakpoints`), `config/media-storage.helper.ts`
   (`MEDIA_CACHE_CONTROL`, action options) + tests.
2. Script: `scripts/backfill-media/` (CLI + pure helper + vitest), `media:backfill`.
3. Docs: `docs/media-storage-operations.md` (breakpoints, Cache-Control, runbook), `AGENTS.md`.

## Data and rollback

- Backfill adds format objects and `formats` keys; existing keys untouched.
  Rollback = restore the DB backup (new objects become orphans; `media:reconcile` lists them).
- Header copy-in-place is idempotent; bucket versioning keeps prior versions.

## Verification

- Automated: `pnpm vitest run config/plugins.test.ts config/media-storage.helper.test.ts scripts/backfill-media`,
  `pnpm test`, `pnpm run lint`, `pnpm run typecheck`.
- Manual (staging, then prod): runbook in `docs/media-storage-operations.md`; record
  before/after counts; check one new upload's `formats` and response headers.

## Risks and blockers

- Replace media leaves the previous objects in the bucket (kept on purpose for
  ISR pages still cached with the old URL); clean orphans periodically from the
  `media:reconcile` report.
- CopyObject on S3-compatible vendors (cloudfly) must accept `ACL` +
  `MetadataDirective: REPLACE`; verify on staging with `--limit 2` first.
