# Approved content and image release

After deploying the latest backend main in Dokploy, run from /app in the backend container:

```sh
node scripts/seed-production-content.mjs
```

One invocation applies the complete approved VI/EN release, including Story, Booking, Experience, Space, Offers, Contact, homepage and menu. All 48 original media files are committed in the backend. It uses existing PostgreSQL/S3 configuration; no SFTP, bundle path, mount or second seed command is required.

The script validates schema and file checksums, blocks unpublished destination edits, saves affected populated content under .tmp/content-deploy-backups, uploads/reuses Strapi S3 media, resolves relations and publishes both locales. Matching published records are refreshed from the shipped release. Destination-only documents, leads, accounts and permissions are preserved; no pruning occurs. Editor changes to published records can be replaced by an explicit release run.

Optional read-only inspection uses this same command with --preview. Internal scripts/lib/content-release and scripts/lib/content-import modules remain implementation dependencies; call the production entry above. The old demo, sibling deploy, one-off correction scripts and their package commands are retired.

Failures can leave partial updates. Preserve recovery snapshots and use the platform database backup for full rollback. Rebuild/revalidate the frontend after applying content. Production execution and CDN access remain server checks; Git push alone does not apply CMS data.
