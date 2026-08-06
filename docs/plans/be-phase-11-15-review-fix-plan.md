# Review fixes — BDS Phase 11–15 lift (Waves 1–4)

Status: Implemented 2026-08-06 (F1–F11); backfill run + manual UAT still open
Owner: Tan Ngo (dev) — F3 taken at its documented default (widen)
Last updated: 2026-08-06
Related phase: [`be-recent-bds-lift-plan.md`](be-recent-bds-lift-plan.md)

## Goal

Close the defects and gaps found while reviewing the code lifted from BDS Phase 11–15
(normalization, safe map URL, WebP pipeline, focal points, social hostname policy) so the
FE revalidation contract is correct, the editor paste flow actually works, and the upload
pipeline cannot be pushed into a memory spike.

## Non-goals

- Closed `destinationKey` nav registry (Phase 15 part) — still deferred per D6, needs FE contract.
- Private-source retention + media processing record CT — dropped by D3, not revived here.
- Watermark profiles, `project` domain, auth/email — permanent non-goals of the lift.
- Rewriting the WebP pipeline to a queue/worker model; the opt-in in-process design stays.

## Current evidence

Reviewed on commit `4f091c6` (branch `fix/flaky-media-processing-test`). `pnpm run test`:
25 files / 167 tests pass. Code read: [`src/shared/normalization/value.ts`](../../src/shared/normalization/value.ts),
[`src/shared/map-url/map-url.ts`](../../src/shared/map-url/map-url.ts),
[`src/shared/social-url/social-url.ts`](../../src/shared/social-url/social-url.ts),
[`src/domain/document-invariants/enforce-content-boundaries.ts`](../../src/domain/document-invariants/enforce-content-boundaries.ts),
[`src/domain/cms-webhook/emit-cms-webhook.ts`](../../src/domain/cms-webhook/emit-cms-webhook.ts),
[`src/domain/media-processing/*`](../../src/domain/media-processing/),
[`src/extensions/upload/strapi-server.ts`](../../src/extensions/upload/strapi-server.ts),
[`src/components/shared/image.json`](../../src/components/shared/image.json),
plus `@strapi/upload@5.51.1` and `@strapi/core@5.51.1` runtime sources.

What is genuinely good (do not "fix"): the helpers are pure and free of Strapi imports;
map URL persists only a normalized `src` and never HTML; social policy is a closed host
allowlist; `AsyncSemaphore` is correct; the processor rejects animation/oversize/pixel bombs
before transform; a single `documents.use` stack instead of scattered lifecycles; the seed
builder already emits `focalPointX/Y`; `assertProductionMediaStorage` is wired in `config/plugins.ts`.

### Findings

| ID | Severity | Finding |
| --- | --- | --- |
| F1 | P1 | Webhook is skipped or sent for the wrong locale on multi-locale publish |
| F2 | P1 | Whole upload is buffered into memory before `maxInputBytes` is checked |
| F3 | P1 | `mapUrl` column is `maxLength: 2048` but the helper accepts 4096 raw chars — the iframe paste flow it was written for is blocked in Admin |
| F4 | P2 | Upload plugin settings are overwritten at every boot and never restored when the flag is turned off |
| F5 | P2 | `focalPointX/Y` are `required` with a default but pre-existing component rows are not backfilled |
| F6 | P2 | Transform timeout does not stop the work — `MEDIA_PROCESSING_CONCURRENCY` is not a real bound |
| F7 | P2 | Every tested unit is a pure helper; none of the wiring (upload optimize, content boundaries, webhook gating) has a test |
| F8 | P3 | `socialLinks: undefined` on a present key throws "phải là mảng" |
| F9 | P3 | `processingVersion` is computed, returned, and dropped |
| F10 | P3 | `media-processing` re-implements an env reader instead of using `config/env.helper.ts`; reads `process.env` directly |
| F11 | P3 | Docs imply everything becomes WebP; Strapi never routes SVG/GIF through `optimize` |

#### F1 — Webhook locale handling (P1)

[`emit-cms-webhook.ts:77`](../../src/domain/cms-webhook/emit-cms-webhook.ts#L77) does
`const locale = ctx.params.locale ?? 'vi'`, then drops anything outside `{vi, en}`.
Strapi 5 `documents.publish` accepts `locale: '*'` (see `multiLocaleToLookup` in
`@strapi/core/dist/services/document-service/internationalization.js`) and omits `locale`
entirely when the caller relies on the default locale. Consequences:

- Publish-all-locales (`'*'`) → warn + **no webhook at all**; neither `vi` nor `en` revalidates.
- Omitted locale → hardcoded `vi`, which is right only because `vi` happens to be the
  configured default; it breaks silently if the default locale ever changes.

#### F2 — Buffer-then-check (P1)

[`upload-optimize.ts:30-45`](../../src/domain/media-processing/upload-optimize.ts#L30-L45)
reads the entire working file into a `Buffer`, and only then does
[`processor.ts:66`](../../src/domain/media-processing/processor.ts#L66) compare
`buffer.byteLength` against `maxInputBytes` (15 MB default). Strapi's own `sizeLimit`
default is 200 MB, so a 200 MB image is fully resident before rejection — times the
per-request upload concurrency. The size is already known from `file.size` /
`file.sizeInBytes` / `fs.stat(file.filepath)` before any read.

#### F3 — mapUrl length ceiling (P1)

`MAP_INPUT_MAX_RAW_LENGTH = 4096` ([`map-url.types.ts:14`](../../src/shared/map-url/map-url.types.ts#L14))
exists so an editor can paste a full `<iframe>`. Both schemas still declare
`"mapUrl": { "type": "text", "maxLength": 2048 }`
([`location`](../../src/api/location/content-types/location/schema.json#L49),
[`global-setting`](../../src/api/global-setting/content-types/global-setting/schema.json#L67)),
so the Content Manager form rejects the paste client-side before normalization ever runs.
Plan D5/W2-01 called for widening the column; it was not done. Server-side is safe either
way because the document middleware normalizes inside `next()`, i.e. before entity validation.

#### F4 — Upload settings are one-way (P2)

[`enforceMediaProcessingUploadSettings`](../../src/domain/media-processing/upload-optimize.ts#L122-L148)
writes `sizeOptimization:false, responsiveDimensions:true, autoOrientation:false` into the
plugin store on every bootstrap when enabled. Turning `MEDIA_PROCESSING_ENABLED` off later
leaves those values in the database, so stock Strapi optimization stays silently disabled
and any operator change in the Media Library settings UI is reverted at the next restart
with no log line.

#### F5 — Focal point backfill (P2)

`focalPointX/Y` are `required: true, default: 50`. New writes are fine (seed builder passes
them). Component rows written before this change are not backfilled by Strapi's schema sync,
so an old `shared.image` row can carry `NULL`, which the public API exposes as `null` and
which fails `required` the next time an editor saves that parent entry.

#### F6 — Timeout does not cancel (P2)

[`withTimeout`](../../src/domain/media-processing/processor.ts#L13-L33) races a timer against
the sharp promise. On timeout the semaphore slot is released while the sharp work keeps
burning CPU/RAM, so `MEDIA_PROCESSING_CONCURRENCY` stops bounding real concurrency exactly
when it matters. `sharp().metadata()` at line 75 runs entirely outside the timeout.

#### F7 — Untested wiring (P2)

Tested: `processRaster` happy path + oversize, config default, `bytesToKbytes`, map URL,
social URL, normalization, webhook sign/verify. Untested: `createMediaProcessingOptimize`
(delegation when disabled, ext/mime/size/name rewrite when enabled), `enforceContentBoundaries`
(uid/action gating, `MapUrlError`/`SocialUrlError` → `ApplicationError` mapping),
`emitCmsWebhook` (locale + UID gating, documentId resolution), and the `maxEdgePx` resize branch.

## Decisions and assumptions

- Decision: keep the fire-and-forget webhook delivery (no retry, no audit CT) — Wave 3 scope.
- Decision: keep the in-process opt-in pipeline; F6 is bounded, not redesigned.
- Assumption: widening `mapUrl` to 4096 is a non-breaking Postgres `text` change — verified by
  running `pnpm run seed:demo` + `pnpm run verify:seed` against local Postgres.
- Assumption: no production data exists yet, so F5 can be closed with a documented one-off
  `UPDATE` instead of a migration framework. Verified against `docs/STATUS.md` (staging still open).
- Owner decision required: F3 — widen the column to 4096 (accept iframe paste), or keep 2048
  and tell editors to paste only the URL. Blocks the F3 step only; default is widen.

## Invariants

- `mapUrl` persisted in the database is always a normalized HTTPS URL, never HTML, never a
  secret-bearing query string.
- `socialLinks[].url` is always HTTPS on an allowlisted host for its platform.
- Media processing is off unless `MEDIA_PROCESSING_ENABLED=true`; with it off, upload behaves
  exactly like stock Strapi.
- The webhook fires only for allowlisted UIDs and `vi`/`en`, and is signed with HMAC-SHA256.
- No public write path is added by any step here.

## Implementation steps

1. **F1 — expand webhook locale fan-out**
   - Files: `src/domain/cms-webhook/emit-cms-webhook.ts`, `src/domain/cms-webhook/cms-webhook.types.ts`
   - Resolve `ctx.params.locale` into a list: `'*'`/undefined → every locale in
     `CMS_WEBHOOK_ALLOWED_LOCALES`; array → filter to allowed; string → single. Emit one signed
     payload per locale. Keep the warn-and-skip only for a string outside the allowlist.
   - Verification: new unit test `emit-cms-webhook.test.ts` with a stubbed `strapi.log` and a
     `fetch` spy asserting 2 payloads for `'*'`, 1 for `'en'`, 0 for `'de'`.
2. **F2 — check size before reading**
   - Files: `src/domain/media-processing/upload-optimize.ts`
   - Read `file.sizeInBytes ?? file.size * 1000 ?? fs.stat(filepath).size` and throw
     `MediaProcessingError(InputTooLarge)` before `readWorkingFileBuffer`. Keep the existing
     post-read check as the backstop for the stream path.
   - Verification: unit test that a stub file with `sizeInBytes` over the limit rejects without
     the read function being called.
3. **F3 — widen `mapUrl` to 4096** *(after owner confirms)*
   - Files: `src/api/location/content-types/location/schema.json`,
     `src/api/global-setting/content-types/global-setting/schema.json`,
     `docs/cms-editor-guide.md` (paste flow), `docs/cms-content-model.md`
   - Verification: `pnpm run verify:schema`, then in Admin paste a real Google Maps iframe into
     Location → save → field shows the bare `https://www.google.com/maps/embed?pb=…`.
4. **F4 — make upload settings reversible**
   - Files: `src/domain/media-processing/upload-optimize.ts`
   - When disabled, restore `sizeOptimization:true, autoOrientation:true` (stock defaults) instead
     of returning early; log at `info` on every write so the override is visible in boot logs.
   - Verification: unit test over a fake plugin store for both branches.
5. **F5 — backfill focal points**
   - Files: `scripts/backfill-focal-points.mjs` (new), `docs/media-storage-operations.md`
   - Idempotent `UPDATE components_shared_images SET focal_point_x = 50 WHERE focal_point_x IS NULL`
     (and `_y`), reusing the `scripts/lib` Strapi bootstrap pattern.
   - Verification: run twice against local Postgres; second run reports 0 rows.
6. **F6 — bound the transform**
   - Files: `src/domain/media-processing/processor.ts`
   - Move `metadata()` inside `withTimeout`; hold the semaphore until the raced promise settles
     (`promise.finally`) so a timed-out job still occupies its slot until sharp actually finishes.
   - Verification: unit test with `MEDIA_PROCESSING_TIMEOUT_MS=1` asserting `Timeout` and that a
     following job still runs.
7. **F7 — cover the wiring**
   - Files: `src/domain/media-processing/upload-optimize.test.ts` (new),
     `src/domain/document-invariants/enforce-content-boundaries.test.ts` (new),
     `src/domain/cms-webhook/emit-cms-webhook.test.ts` (new, from step 1)
   - Cases: optimize delegates when disabled / rewrites ext+mime+size when enabled; boundaries
     no-op on `findMany` and on unrelated UIDs, map/social errors surface as `ApplicationError`
     with the original `code`; resize branch triggers above `maxEdgePx`.
   - Verification: `pnpm run test`.
8. **F8–F11 — cleanups**
   - `social-url.ts`: treat `undefined` like an absent key.
   - `processor.ts` / `types.ts`: log `processingVersion` with the correlation id in
     `upload-optimize.ts`, or drop the field.
   - `media-processing/{config,runtime}.ts`: take the `env` reader from Strapi
     (`strapi.config.get` / `config/env.helper.ts`) instead of a private `process.env` wrapper;
     delete the duplicated `EnvReader` type. Add `MEDIA_PROCESSING_VERSION` to `.env.example`.
   - `toEditorSafeMessage(error)`: drop the duplicated `correlationId` parameter.
   - `docs/media-storage-operations.md` + `docs/cms-api-contract.md`: state that SVG and GIF
     bypass the pipeline (Strapi only calls `optimize` for jpeg/png/webp/tiff/avif), so the FE
     must still expect non-WebP assets.
   - Verification: `pnpm run check`.

## Data and rollback

- Migration/backfill: step 5 only (`focalPointX/Y` NULL → 50). Step 3 widens a `text` column's
  declared `maxLength`; Postgres `text` is unaffected, only Strapi validation changes.
- Compatibility: no public API response shape changes. Webhook consumers receive *more* events
  after F1 (one per locale) — the FE revalidate route must be idempotent, which it already is
  for a single-locale payload.
- Rollback: every step is forward-only code; reverting the commit restores prior behavior.
  The focal backfill is not reverted (50 is the schema default anyway).

## Verification

- Automated: `pnpm run check` (lint → verify:schema → typecheck → test → build).
- With Postgres up: `pnpm run seed:demo && pnpm run verify:seed && pnpm run smoke:api`.
- Manual UAT: Admin → Location → paste a Google Maps iframe → save → normalized URL persisted;
  with `MEDIA_PROCESSING_ENABLED=true`, upload a 4000px JPEG → Media Library shows a `.webp`
  capped at 2560px; upload an SVG → stored unchanged.
- Evidence to record: append a pass/fail table to `docs/STATUS.md` with the run date.

## Documentation impact

- `docs/cms-api-contract.md` — webhook now emits per locale; SVG/GIF bypass note.
- `docs/cms-editor-guide.md` — iframe paste flow for `mapUrl`.
- `docs/media-storage-operations.md` — backfill script, upload-settings override behavior.
- `docs/STATUS.md` — link this plan under the recent-lift entry.
- `.env.example` — `MEDIA_PROCESSING_VERSION`.

## Risks and blockers

- Widening `mapUrl` (F3) invites editors to paste arbitrary HTML; mitigated by the existing
  parse5 single-iframe + host allowlist rules, which run before persistence.
- Per-locale webhook fan-out (F1) doubles revalidation traffic on publish-all; mitigated by the
  FE route being cheap and idempotent. Trigger to revisit: FE reports revalidation storms.
- F6 changes when the semaphore is released; if a hung sharp job never settles, the slot leaks.
  Mitigated by the fact that sharp always settles and the timeout still surfaces to the editor.

## Completion record

Implemented 2026-08-06 on branch `fix/flaky-media-processing-test`. Gates:
`lint`, `verify:schema`, `typecheck`, `test` (31 files / 211 tests), `build` — all pass.

| ID | Outcome |
| --- | --- |
| F1 | `resolveWebhookLocales` fans `'*'` and an omitted locale out to the full allowlist, filters arrays, warns only on an explicit bad locale; 8 tests |
| F2 | `resolveDeclaredBytes` rejects from `sizeInBytes` → `size × 1000` → `fs.stat` before the read; the post-read check stays as the stream-path backstop |
| F3 | Widened (default taken). Both schemas now `maxLength: 4096`; the normalized URL is still capped at 2048 by `parseHttpsMapUrl` |
| F4 | `enforceMediaProcessingUploadSettings` restores stock values when disabled, skips no-op writes, and logs every write at `info`. **Follow-up fix:** only `sizeOptimization` + `autoOrientation` are managed — pinning `responsiveDimensions: true` in both directions reproduced F4 the other way round (it reverted the operator's Media Library choice on every boot, including on installs that never enabled the pipeline) |
| F5 | `scripts/backfill-focal-points.mjs` + `pnpm run backfill:focal-points` |
| F6 | `metadata()` moved inside the timeout via `inspectSource`; `withTimeout` returns `settled` so the semaphore slot is held until sharp really finishes |
| F7 | New `upload-optimize.test.ts` (10), `enforce-content-boundaries.test.ts` (7), `emit-cms-webhook.test.ts` (8) |
| F8 | `socialLinks: undefined` now treated as an absent key |
| F9 | Logged with the correlation id in `upload-optimize.ts` via `runtime.logger` |
| F10 | `runtime.ts` takes `env` from `@strapi/utils`; the duplicated `EnvReader` type is now one `MediaProcessingEnvReader` in `types.ts`; `MEDIA_PROCESSING_VERSION` documented |
| F11 | SVG/GIF bypass documented in `media-storage-operations.md` and — **follow-up fix**, the plan named both files — in the FE-facing `cms-api-contract.md` Media section |

Deviations from the plan: `toEditorSafeMessage` lost its duplicated
`correlationId` parameter (it reads `error.correlationId`), and `processor.ts`
was restructured into `inspectSource` / `transformToWebp` rather than patched in
place — F6 needed both under one timeout and the nesting was already deep.

Still open (needs a real environment): `pnpm run backfill:focal-points` against
Postgres, and the manual UAT — iframe paste into `mapUrl`, 4000px JPEG → capped
WebP, SVG stored unchanged.
