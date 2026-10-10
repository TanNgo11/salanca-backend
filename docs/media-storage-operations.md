# Media storage operations

## Modes

| Mode | When | Behavior |
| --- | --- | --- |
| Local disk | `S3_BUCKET` unset | Strapi default Media Library under `public/uploads` |
| Object storage | `S3_BUCKET` set | `@strapi/provider-upload-aws-s3` + `CDN_URL` required |

Staging and production **must** use object storage. Local disk is acceptable only for early developer machines.

## Required env (object storage)

- `S3_BUCKET`
- `S3_REGION`
- `S3_ROOT_PATH` (stable lowercase prefix, e.g. `uploads` or `staging/uploads`)
- `CDN_URL` (bare HTTPS origin; HTTP only for loopback)

Optional:

- `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE` for S3-compatible vendors
- `S3_ACCESS_KEY_ID` + `S3_ACCESS_SECRET` (or ambient role credentials)
- `S3_ACL=public-read` for ACL-based vendors

## Responsive formats (breakpoints)

`config/plugins.ts` sets `upload.config.breakpoints` to
`{ w640: 640, w960: 960, w1280: 1280, w1920: 1920 }` (plus Strapi's built-in
`thumbnail`). Strapi creates `formats[name]` at upload time only when the
original is larger than the breakpoint on either edge, and only when the Media
Library setting `responsiveDimensions` is on (the media-processing pipeline
forces it when `MEDIA_PROCESSING_ENABLED=true`). The web renders these
derivatives directly via `srcset`.

The names deliberately differ from Strapi's defaults (`small`/`medium`/`large`):
derivative keys are `${name}_${hash}${ext}`, so reusing a default name would
overwrite an existing, immutably cached object with different-size content. Old
`small`/`medium`/`large` formats on existing files are kept untouched. Never
rename a breakpoint once files carry it.

## Cache-Control

Every write through the S3 provider (`upload`, `uploadStream`, `replace`,
`replaceStream`) sends `Cache-Control: public, max-age=31536000, immutable`
(`MEDIA_CACHE_CONTROL` in `config/media-storage.helper.ts`). It is set in
`upload.config.actionOptions`, not in `s3Options.params`: the aws-s3 provider
5.51.1 reads only `Bucket` and `ACL` from `params` and merges per-call
`customParams` (filled from `actionOptions[method]`) into the PutObject input.

### Replace media issues a fresh hash

Stock Strapi **Replace media** keeps the file's `hash` and rewrites the same
object keys, which an `immutable` cache would keep serving for up to a year.
`src/extensions/upload/fresh-hash-replace.ts` overrides it (decision 2026-10-06):

- the new file runs the same steps as Strapi's upload (`formatFileInfo`,
  optimize, `_uploadImage`, provider upload) under a **fresh hash**, so every
  URL is new and gets Cache-Control and derivatives;
- the result is written onto the **existing row** (no temporary row, so only
  `media.update` is emitted); documents that point at the file id keep pointing
  at it, and the row keeps its name unless the editor typed a new one;
- the **old objects are kept**: ISR pages and browser HTML cached before the
  replace still use the old URLs. Clean them up with
  `media:reconcile -- --delete-orphans` (below);
- after success the backend sends a signed `media.replace` webhook
  (`uid: plugin::upload.file`); the web revalidates every CMS tag in both
  locales, so pages switch to the new URL immediately.

The override mirrors `@strapi/upload` 5.51.1 internals (`_uploadImage` is
marked internal) — re-check `fresh-hash-replace.ts` on every Strapi upgrade.

The experience heritage artwork is the `experience-page.heritageImage` field, so
a Replace reaches it like any other CMS image.

### Cleaning orphaned objects (`media:reconcile`)

```powershell
pnpm media:reconcile                                    # read-only report
pnpm media:reconcile -- --delete-orphans                # list what would go
pnpm media:reconcile -- --delete-orphans --apply        # delete it
pnpm media:reconcile -- --delete-orphans --min-age-days 14
```

An orphan is deleted only when it is not referenced by any file row, has been
an orphan for the grace period (default 7 days), and is not listed in
`scripts/reconcile-media/protected-keys.txt`. Add any object referenced by a URL
hardcoded outside the file table to that list. Back up the bucket listing (the
dry-run output) before `--apply`.

The grace clock is when `--delete-orphans` first saw the key as an orphan
(kept in the Strapi core store `media-reconcile`), not the S3 upload time, so
an object a Replace orphaned today waits the full period. Run the dry run
regularly (e.g. weekly) so the clock starts early.

## Backfill existing media (`media:backfill`)

After an `--apply` run the script sends the signed `media.replace` webhook (when
`CMS_WEBHOOK_URL` / `CMS_WEBHOOK_SECRET` are set), so web pages cached before the
backfill pick up the new formats immediately. Re-running `--apply` with nothing
pending only sends that webhook.

Breakpoints and Cache-Control only affect new uploads. `pnpm run media:backfill`
brings existing files in line:

- **Formats:** for each image (`plugin::upload.file`, resizable mime) missing an
  eligible configured breakpoint, it downloads the original from S3, runs Strapi's
  own `image-manipulation.generateResponsiveFormats`, uploads each missing format
  through the upload plugin's provider service (so the Cache-Control action
  options apply) and merges the new keys into `formats`. The original's
  `url`/`hash`/`name` never change and existing format keys are kept.
- **Headers:** every object (original + formats) whose `HeadObject` lacks the
  exact Cache-Control is copied onto itself with `MetadataDirective: REPLACE`,
  re-sending `CacheControl`, the existing `ContentType`/metadata and the ACL as
  the provider resolves it (`S3_ACL`).

Default is a read-only dry run that prints counts and example file ids. Flags:
`--apply` (write), `--limit <n>` (files per phase). Concurrency is fixed at 3.
Per-file errors are logged with the file id and do not stop the run; the exit
code is 1 when any file failed.

Runbook (per environment, staging first):

1. Back up PostgreSQL (`pg_dump` / provider snapshot); confirm bucket versioning.
2. Confirm the target env has `MEDIA_PROCESSING_ENABLED=true` (or
   `responsiveDimensions` on in Media Library settings) and the S3 env vars.
3. Dry run: `pnpm run media:backfill` — record the counts.
4. Optional canary: `pnpm run media:backfill --apply --limit 2`, check one file's
   API `formats` and the response headers of an original and a derivative.
5. Apply: `pnpm run media:backfill --apply` — record the before/after report.
6. Re-run the dry run; expect 0 files missing formats and 0 objects without the
   header (DB/bucket mismatches show as missing objects and need a human).
7. If a CDN sits in front of the bucket, purge it so old header-less responses
   are dropped.

## Re-encode legacy JPEG derivatives as WebP (`media:webp`)

Uploads made before `MEDIA_PROCESSING_ENABLED` kept JPEG derivatives, and the
web renders `formats` straight into `srcset`. `pnpm run media:webp` re-encodes
them:

- only `image/jpeg` files (legacy PNG uploads are served through next/image,
  which already sends WebP);
- every derivative whose `mime` is not `image/webp` is encoded from the
  original at its stored width/height (WebP quality 75, effort 6) and uploaded
  through the provider under `${name}_${hash}.webp`, a new key, so no immutably
  cached object is overwritten; a derivative is kept as JPEG when the WebP is
  not smaller;
- the original's `url`/`hash`/`name` never change, and the JPEG objects stay
  in the bucket (they become orphans for `media:reconcile`).

Before each row is updated, its previous `formats` are appended to
`media-webp-backup-<timestamp>.jsonl` in the working directory. To roll a file
back, write that `formats` value onto the row again. The JPEG objects it points
at must still exist, so run the WebP conversion at least one reconcile grace
period (7 days) before any `media:reconcile -- --delete-orphans --apply`, or
keep the backup's keys in `protected-keys.txt` until the rollback window ends.

Runbook (per environment, staging first):

1. Back up PostgreSQL; confirm bucket versioning.
2. Dry run: `pnpm run media:webp` — record the counts.
3. Canary: `pnpm run media:webp --apply --limit 2`; check one file's API
   `formats` (WebP URLs) and that the page still renders its images.
4. Apply: `pnpm run media:webp --apply`; keep the backup file and the report
   (it prints the derivative bytes before/after).
5. The script sends the signed `media.replace` webhook so ISR pages switch to
   the new URLs; Cloudflare's 60 s HTML edge TTL clears on its own.

## Safety

- Upload MIME allow/deny lists live in `config/plugins.ts`.
- Delete is blocked when a file is still related to content (`src/extensions/upload/`).
- Do not commit runtime uploads to Git.

## Backup

1. PostgreSQL: `pg_dump` / provider snapshot.
2. Bucket: enable versioning; separate backup/lifecycle per environment.
3. `strapi export` is a content snapshot, not full disaster recovery (admin users and secrets are not included).

## Environments

Each environment should use its own bucket or at least its own `S3_ROOT_PATH` so local/dev never overwrites production objects.
