/**
 * Read-only media reconciliation against S3/R2 when CDN + S3 env is configured.
 * Usage: npm run media:reconcile
 */
import { createRequire } from 'node:module';

import { loadStrapiApp } from '../lib/strapi-load.mjs';
import {
  buildMediaReconciliationReport,
  formatMediaReconciliationReport,
  stripTrailingSlashes,
} from './reconcile-media.helper.mjs';

const require = createRequire(import.meta.url);
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

async function listBucketKeys(s3Options, bucket, rootPath) {
  let S3Client;
  let ListObjectsV2Command;
  try {
    ({ S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3'));
  } catch {
    throw new Error(
      'Missing @aws-sdk/client-s3. Install it to run media:reconcile against a live bucket.',
    );
  }

  const client = new S3Client(s3Options);
  const keys = [];
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
        if (object.Key) keys.push(object.Key);
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
  } finally {
    client.destroy();
  }

  return keys;
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

const app = await loadStrapiApp();

try {
  const { baseUrl, rootPath, s3Options, bucket } = readProviderOptions(app);
  const [files, bucketKeys] = await Promise.all([
    listMediaRows(app),
    listBucketKeys(s3Options, bucket, rootPath),
  ]);
  const report = buildMediaReconciliationReport(files, bucketKeys, baseUrl);
  console.log(formatMediaReconciliationReport(report));
  const hasFindings =
    report.missingObjects.length > 0 ||
    report.orphanCandidates.length > 0 ||
    report.unmanagedUrls.length > 0;
  process.exitCode = hasFindings ? 2 : 0;
} catch (error) {
  console.error('media:reconcile failed');
  console.error(error?.message ?? error);
  process.exitCode = 1;
} finally {
  await app.destroy().catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}
