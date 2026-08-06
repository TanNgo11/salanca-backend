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

## WebP processing (opt-in)

Off unless `MEDIA_PROCESSING_ENABLED=true`. When on, uploads are re-encoded to
WebP (orient → sRGB → edge cap → WebP, no watermark) before storage.

**Not everything becomes WebP.** Strapi only calls the upload plugin's
`optimize` for jpeg/png/webp/tiff/avif, so **SVG and GIF bypass the pipeline
entirely** and are stored as uploaded. The FE must still expect non-WebP assets.
Animated/multi-frame input that *does* reach the pipeline is rejected, not
flattened.

Enabling it rewrites two upload-plugin settings in the database
(`sizeOptimization: false`, `autoOrientation: false`) because our pipeline owns
compression and orientation. Turning it off restores Strapi's stock values
(`true` / `true`) on the next boot. Both directions log at `info` — these two
keys silently revert changes an operator makes in the Media Library settings UI,
so check the boot log before debugging "my setting did not stick".

`responsiveDimensions` is **not** managed: it is a storage/bandwidth choice and
whatever the operator sets in the UI is left alone in both directions.

Tuning: `MEDIA_PROCESSING_MAX_EDGE`, `_WEBP_QUALITY`, `_MAX_INPUT_BYTES`,
`_MAX_PIXELS`, `_TIMEOUT_MS`, `_CONCURRENCY`, `_VERSION` (see `.env.example`).
Oversized uploads are rejected from the declared file size before the file is
read into memory.

## Focal point backfill

`shared.image.focalPointX/Y` are `required` with default 50. Schema sync adds
the columns but does not populate existing rows, so component rows written
before the field existed keep `NULL` — exposed as `null` by the public API, and
failing `required` the next time an editor saves the parent entry.

```bash
pnpm run backfill:focal-points
```

Idempotent: a second run reports 0 rows.

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
