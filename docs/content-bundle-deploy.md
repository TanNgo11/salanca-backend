# Deploy the published local CMS with its media

This transports live published VI/EN marketing content, not frontend seed mockups. It excludes users, tokens, leads, unpublished source drafts and destination-only documents. Matched marketing entries are overwritten and published; destination drafts differing from published content abort the operation. Gallery matches by title; renaming a title creates a new entry and does not delete the old one.

## Local machine

Run from `salanca-backend` using its local `.env`:

```powershell
pnpm content:pack .tmp/content-release
```

Use a new directory for each export. The bundle includes `bundle.json` and `media/`. Media is downloaded from the configured HTTPS `CDN_URL` or read from local uploads. Keep this directory outside Git. Copy the **entire directory** to the server using your existing deployment/file-transfer method.

## Server

Deploy matching backend code first. Use the server's production database and S3 environment configuration. No local `.env` is transferred.

```sh
pnpm content:deploy /path/to/content-release
pnpm content:deploy /path/to/content-release --apply --database YOUR_PRODUCTION_DATABASE_NAME
```

The first command previews creates/updates. Apply validates all media hashes and the model schema, rejects unpublished target edits, requires the target database name, and creates a custom PostgreSQL dump under `.tmp/content-deploy-backups/` before content writes. `pg_dump` must be installed and compatible with the server; set `PG_DUMP_BIN` to its executable path if needed. Standard PostgreSQL SSL environment variables remain available for managed databases.

Images upload through the server's Strapi upload provider to its S3 configuration; content-hashed filenames prevent changed images from reusing an old same-name upload. Native frontend assets are delivered by normal FE deployment. After content deploy, rebuild or revalidate the frontend using its existing pipeline. Git push alone does not execute these commands.

## Dokploy / FileZilla

Transfer `bundle.json` and the entire `media/` directory through FileZilla SFTP to `/opt/salanca-content-release` on the VPS. In the backend application's Advanced > Volumes/Mounts, configure a Bind Mount from that Host Path to `/content-release`, then redeploy the backend with this script. These example paths must be configured on the actual VPS; they are not created by Git push.

Inside the backend container, run from its application directory:

```sh
node scripts/content-bundle.mjs deploy /content-release
pg_dump --version
node scripts/content-bundle.mjs deploy /content-release --apply --database "$DATABASE_NAME"
```

The direct Node command avoids this project's documented stale pnpm PATH in Nixpacks containers. `DATABASE_NAME` must match the effective production database; if `DATABASE_URL` names a different database, pass that actual name instead. The backup guard requires `pg_dump` in the container, not merely on the VPS host; set `PG_DUMP_BIN` if it is installed at another path. A missing/incompatible backup binary aborts before content writes.

Only published source content is exported. Do not run concurrent editorial changes or content deployment while packing/applying. Target matching drafts must equal the published version; save/publish or resolve them first. Source content cannot reference records outside the bundle. The importer is sequential and can partially succeed; errors stop processing. Preserve the backup, restore it before retrying a failed deployment, and retain newly uploaded S3 objects until rollback has been verified. PostgreSQL dumps contain private target data and must remain private. S3 object deletion is not automated.

## Verification status

Local pack and read-only preview passed for 166 localized documents and 24 media files. Five helper tests, typecheck and lint passed. PostgreSQL backup execution and production apply have not run. No production connection or deployment pipeline was supplied. This is an operator-invoked release script, suitable for an explicit post-deploy step after the bundle is copied. It does not configure CI credentials or GitHub deployment hooks.
