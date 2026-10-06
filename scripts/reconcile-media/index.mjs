/**
 * Media reconciliation against S3/R2 when CDN + S3 env is configured.
 *
 * Usage:
 *   pnpm media:reconcile                                   read-only report
 *   pnpm media:reconcile -- --delete-orphans               list deletable orphans
 *   pnpm media:reconcile -- --delete-orphans --apply       delete them
 *   ... --min-age-days 14                                  grace period (default 7)
 *
 * `--delete-orphans` records when each orphan was first seen (Strapi core
 * store `media-reconcile`); a key is deleted only after it has stayed an
 * orphan for the grace period, and never when listed in protected-keys.txt.
 * Run it regularly (the dry run is enough) so the clock starts early.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { loadStrapiApp } from '../lib/strapi-load.mjs';
import {
  buildMediaReconciliationReport,
  formatMediaReconciliationReport,
  formatOrphanDeletionPlan,
  parseProtectedKeys,
  parseReconcileArgs,
  selectOrphansForDeletion,
  stripTrailingSlashes,
  updateOrphanLedger,
} from './reconcile-media.helper.mjs';

// pnpm does not hoist @aws-sdk/client-s3; resolve it from the provider's tree.
const projectRequire = createRequire(import.meta.url);
const providerRequire = createRequire(
  projectRequire.resolve('@strapi/provider-upload-aws-s3/package.json'),
);
const { S3Client, ListObjectsV2Command, DeleteObjectCommand } =
  providerRequire('@aws-sdk/client-s3');
const DELETE_CONCURRENCY = 3;
const ORPHAN_LEDGER = { type: 'core', name: 'media-reconcile', key: 'orphans-first-seen' };
const FILE_MODEL_UID = 'plugin::upload.file';
const PAGE_SIZE = 200;

function readProviderOptions(strapi) {
  const options = strapi.config.get('plugin::upload.providerOptions') ?? {};
  const baseUrl = options.baseUrl;
  const rootPath = options.rootPath;
  const s3Options = options.s3Options;
  const bucket = s3Options?.params?.Bucket;

  if (!baseUrl || !rootPath || !bucket) {
    throw new Error(
      'Media storage is not configured for S3. Set S3_BUCKET, S3_REGION, S3_ROOT_PATH and CDN_URL before reconciling.',
    );
  }

  return { baseUrl, rootPath, s3Options, bucket };
}

async function listBucketObjects(s3Options, bucket, rootPath) {
  const client = new S3Client(s3Options);
  const objects = [];
  let continuationToken;

  try {
    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: `${stripTrailingSlashes(rootPath)}/`,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of response.Contents ?? []) {
        if (object.Key) objects.push({ key: object.Key, lastModified: object.LastModified });
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
  } finally {
    client.destroy();
  }

  return objects;
}

async function deleteObjects(s3Options, bucket, keys) {
  const client = new S3Client(s3Options);
  const failed = [];
  try {
    const queue = [...keys];
    const worker = async () => {
      for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
        try {
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
          console.log(`  đã xoá ${key}`);
        } catch (error) {
          failed.push(key);
          console.error(`  lỗi khi xoá ${key}: ${error?.message ?? error}`);
        }
      }
    };
    await Promise.all(Array.from({ length: DELETE_CONCURRENCY }, worker));
  } finally {
    client.destroy();
  }
  return failed;
}

function readProtectedKeys() {
  const text = readFileSync(new URL('./protected-keys.txt', import.meta.url), 'utf8');
  return parseProtectedKeys(text);
}

async function listMediaRows(strapi) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const page = await strapi.db.query(FILE_MODEL_UID).findMany({
      select: ['id', 'name', 'url', 'formats'],
      orderBy: { id: 'asc' },
      limit: PAGE_SIZE,
      offset,
    });
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

const args = parseReconcileArgs(process.argv.slice(2));
const app = await loadStrapiApp();

try {
  const { baseUrl, rootPath, s3Options, bucket } = readProviderOptions(app);
  const [files, bucketObjects] = await Promise.all([
    listMediaRows(app),
    listBucketObjects(s3Options, bucket, rootPath),
  ]);
  const report = buildMediaReconciliationReport(
    files,
    bucketObjects.map((object) => object.key),
    baseUrl,
  );
  console.log(formatMediaReconciliationReport(report, args));
  const hasFindings =
    report.missingObjects.length > 0 ||
    report.orphanCandidates.length > 0 ||
    report.unmanagedUrls.length > 0;
  process.exitCode = hasFindings ? 2 : 0;

  if (args.deleteOrphans) {
    const now = new Date();
    const store = app.store(ORPHAN_LEDGER);
    const ledger = updateOrphanLedger(await store.get({}), report.orphanCandidates, now);
    await store.set({ value: ledger });
    const plan = selectOrphansForDeletion(
      report.orphanCandidates,
      ledger,
      readProtectedKeys(),
      now,
      args.minAgeDays,
    );
    console.log(formatOrphanDeletionPlan(plan, args));
    if (args.apply && plan.deletable.length > 0) {
      const failed = await deleteObjects(s3Options, bucket, plan.deletable);
      const deleted = new Set(plan.deletable.filter((key) => !failed.includes(key)));
      await store.set({
        value: Object.fromEntries(Object.entries(ledger).filter(([key]) => !deleted.has(key))),
      });
      process.exitCode = failed.length > 0 ? 1 : process.exitCode;
    }
  }
} catch (error) {
  console.error('media:reconcile failed');
  console.error(error?.message ?? error);
  process.exitCode = 1;
} finally {
  await app.destroy().catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}
