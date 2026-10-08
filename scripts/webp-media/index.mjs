/**
 * Re-encodes the responsive derivatives (`formats`) of legacy JPEG uploads as
 * WebP. The web renders `formats` straight into `srcset`, so this shrinks what
 * browsers download without touching the original.
 *
 * Default is a read-only dry run. Writes only with --apply.
 * Usage: pnpm run media:webp [--apply] [--limit <n>]
 *
 * Each derivative is encoded from the original at the stored width/height and
 * uploaded under a new `.webp` key; the JPEG objects stay in the bucket. The
 * original's url/hash/name never change. Before a row is updated its old
 * `formats` are appended to media-webp-backup-<timestamp>.jsonl in the working
 * directory. Runbook: docs/media-storage-operations.md.
 */
import { appendFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

import sharp from 'sharp';

import {
  DEFAULT_CONCURRENCY,
  mapWithConcurrency,
  objectKeyFromUrl,
  parseBackfillArgs,
  takeFiles,
  toStoredFormat,
} from '../backfill-media/backfill-media.helper.mjs';
import { loadStrapiApp } from '../lib/strapi-load.mjs';
import { requestWebRevalidation } from '../lib/web-revalidate.mjs';
import {
  buildWebpUpload,
  formatWebpReport,
  legacyFormatNames,
  planWebpConversion,
  replaceFormats,
  WEBP_OPTIONS,
} from './webp-media.helper.mjs';

const FILE_MODEL_UID = 'plugin::upload.file';
const PAGE_SIZE = 200;

// pnpm does not hoist @aws-sdk/client-s3; resolve it from the provider's tree.
const projectRequire = createRequire(import.meta.url);
const providerRequire = createRequire(
  projectRequire.resolve('@strapi/provider-upload-aws-s3/package.json'),
);
const { S3Client, GetObjectCommand } = providerRequire('@aws-sdk/client-s3');

function readStorageConfig(strapi) {
  const upload = strapi.config.get('plugin::upload') ?? {};
  const { baseUrl, rootPath, s3Options } = upload.providerOptions ?? {};
  const bucket = s3Options?.params?.Bucket;
  if (upload.provider !== 'aws-s3' || !baseUrl || !rootPath || !bucket) {
    throw new Error(
      'Media storage is not configured for S3. Set S3_BUCKET, S3_REGION, S3_ROOT_PATH and CDN_URL before converting.',
    );
  }
  if (!upload.actionOptions?.upload?.CacheControl) {
    throw new Error('plugin::upload.actionOptions.upload.CacheControl is not configured.');
  }
  return { provider: upload.provider, baseUrl, s3Options, bucket };
}

async function listFileRows(strapi) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await strapi.db.query(FILE_MODEL_UID).findMany({
      select: ['id', 'name', 'hash', 'ext', 'mime', 'url', 'formats', 'provider'],
      orderBy: { id: 'asc' },
      limit: PAGE_SIZE,
      offset,
    });
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function downloadObject(client, bucket, key) {
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await object.Body.transformToByteArray());
}

function storedBytes(format) {
  if (Number.isFinite(format.sizeInBytes)) return format.sizeInBytes;
  return Math.round((format.size ?? 0) * 1000);
}

async function convertFile(strapi, client, storage, fileId, { backupPath, bytes }) {
  const providerService = strapi.plugin('upload').service('provider');
  const query = strapi.db.query(FILE_MODEL_UID);

  const row = await query.findOne({ where: { id: fileId } });
  const key = objectKeyFromUrl(row?.url, storage.baseUrl);
  if (!row || !key) throw new Error('row or object key not found');

  const original = await downloadObject(client, storage.bucket, key);
  const converted = {};
  const kept = [];
  for (const name of legacyFormatNames(row)) {
    const format = row.formats[name];
    const { data, info } = await sharp(original, { failOn: 'error' })
      .rotate()
      .resize({ width: format.width, height: format.height, fit: 'inside', withoutEnlargement: true })
      .webp(WEBP_OPTIONS)
      .toBuffer({ resolveWithObject: true });
    const before = storedBytes(format);
    if (before > 0 && data.byteLength >= before) {
      kept.push(name);
      continue;
    }
    const file = {
      ...buildWebpUpload({ name, row, buffer: data, width: info.width, height: info.height }),
      getStream: () => Readable.from(data),
    };
    // Goes through the wrapped provider, so actionOptions (CacheControl) apply.
    await providerService.upload(file);
    converted[name] = toStoredFormat(file);
    bytes.before += before;
    bytes.after += data.byteLength;
  }

  if (Object.keys(converted).length > 0) {
    const fresh = await query.findOne({ where: { id: fileId }, select: ['formats'] });
    await appendFile(backupPath, `${JSON.stringify({ id: fileId, formats: fresh?.formats ?? null })}\n`);
    await query.update({ where: { id: fileId }, data: { formats: replaceFormats(fresh?.formats, converted) } });
  }
  const parts = [];
  if (Object.keys(converted).length) parts.push(`webp: ${Object.keys(converted).join(', ')}`);
  if (kept.length) parts.push(`kept, WebP not smaller: ${kept.join(', ')}`);
  return parts.join('; ');
}

const options = parseBackfillArgs(process.argv.slice(2));
const app = await loadStrapiApp();
let client;

try {
  const storage = readStorageConfig(app);
  client = new S3Client(storage.s3Options);
  console.log(
    `Mode: ${options.apply ? 'APPLY' : 'DRY-RUN (read-only)'}; WebP ${JSON.stringify(WEBP_OPTIONS)}` +
      (options.limit ? `; limit ${options.limit} files` : ''),
  );

  const plan = planWebpConversion(await listFileRows(app), storage);
  console.log(formatWebpReport({ label: options.apply ? 'before' : 'dry-run', plan }));

  if (options.apply) {
    const backupPath = `media-webp-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    const bytes = { before: 0, after: 0 };
    const failures = [];
    let done = 0;
    const groups = takeFiles(plan.pending, options.limit);
    console.log(`\nConverting ${groups.length} files; old formats backed up to ${backupPath}`);
    await mapWithConcurrency(groups, DEFAULT_CONCURRENCY, async ({ fileId }) => {
      try {
        const detail = await convertFile(app, client, storage, fileId, { backupPath, bytes });
        done += 1;
        console.log(`  file #${fileId} ok${detail ? ` (${detail})` : ''}`);
      } catch (error) {
        failures.push({ fileId, message: error?.message ?? String(error) });
        console.error(`  file #${fileId} FAILED: ${error?.message ?? error}`);
      }
    });
    console.log(`${done}/${groups.length} files done`);

    const after = planWebpConversion(await listFileRows(app), storage);
    console.log(`\n${formatWebpReport({ label: 'after', plan: after, bytes })}`);
    await requestWebRevalidation();
    if (failures.length > 0) {
      console.error(`\n${failures.length} file(s) failed:`);
      for (const failure of failures) console.error(`  - #${failure.fileId}: ${failure.message}`);
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error('media:webp failed');
  console.error(error?.message ?? error);
  process.exitCode = 1;
} finally {
  client?.destroy();
  await app.destroy().catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}
