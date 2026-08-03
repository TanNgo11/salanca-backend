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
