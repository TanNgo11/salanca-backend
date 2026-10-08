/**
 * Backfills responsive formats (configured upload breakpoints) and the
 * Cache-Control header on existing S3 media.
 *
 * Default is a read-only dry run. Writes only with --apply.
 * Usage: pnpm run media:backfill [--apply] [--limit <n>]
 *
 * Never changes an original's url/hash/name; new formats are merged into
 * `formats` next to the existing keys. Runbook: docs/media-storage-operations.md.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { loadStrapiApp } from '../lib/strapi-load.mjs';
import { requestWebRevalidation } from '../lib/web-revalidate.mjs';
import {
  DEFAULT_CONCURRENCY,
  buildCopyObjectInput,
  fileObjects,
  formatBackfillReport,
  mapWithConcurrency,
  mergeFormats,
  objectKeyFromUrl,
  parseBackfillArgs,
  planFormatBackfill,
  planHeaderBackfill,
  resolveProviderAcl,
  takeFiles,
  toStoredFormat,
} from './backfill-media.helper.mjs';

const FILE_MODEL_UID = 'plugin::upload.file';
const PAGE_SIZE = 200;

// pnpm does not hoist @aws-sdk/client-s3; resolve it from the provider's tree.
const projectRequire = createRequire(import.meta.url);
const providerRequire = createRequire(
  projectRequire.resolve('@strapi/provider-upload-aws-s3/package.json'),
);
const { S3Client, HeadObjectCommand, GetObjectCommand, CopyObjectCommand } =
  providerRequire('@aws-sdk/client-s3');

function readStorageConfig(strapi) {
  const upload = strapi.config.get('plugin::upload') ?? {};
  const { baseUrl, rootPath, s3Options } = upload.providerOptions ?? {};
  const bucket = s3Options?.params?.Bucket;
  const cacheControl = upload.actionOptions?.upload?.CacheControl;
  const breakpoints = upload.breakpoints;

  if (upload.provider !== 'aws-s3' || !baseUrl || !rootPath || !bucket) {
    throw new Error(
      'Media storage is not configured for S3. Set S3_BUCKET, S3_REGION, S3_ROOT_PATH and CDN_URL before backfilling.',
    );
  }
  if (!cacheControl) {
    throw new Error('plugin::upload.actionOptions.upload.CacheControl is not configured.');
  }
  if (!breakpoints || Object.keys(breakpoints).length === 0) {
    throw new Error('plugin::upload.breakpoints is not configured.');
  }

  return {
    provider: upload.provider,
    baseUrl,
    s3Options,
    bucket,
    cacheControl,
    breakpoints,
    acl: resolveProviderAcl(s3Options.params),
  };
}

async function listFileRows(strapi) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await strapi.db.query(FILE_MODEL_UID).findMany({
      select: ['id', 'name', 'hash', 'ext', 'mime', 'url', 'width', 'height', 'formats', 'provider'],
      orderBy: { id: 'asc' },
      limit: PAGE_SIZE,
      offset,
    });
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function headObject(client, bucket, key) {
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

async function scan(strapi, client, storage, label) {
  const files = await listFileRows(strapi);
  const formats = planFormatBackfill(files, storage);
  const keys = [
    ...new Set(
      files.flatMap((file) => fileObjects(file, storage.baseUrl).map((object) => object.key)).filter(Boolean),
    ),
  ];
  const heads = new Map();
  await mapWithConcurrency(keys, DEFAULT_CONCURRENCY, async (key) => {
    heads.set(key, await headObject(client, storage.bucket, key));
  });
  const headers = planHeaderBackfill(files, heads, storage);
  return { files, heads, report: { label, formats, headers } };
}

async function backfillFormats(strapi, client, storage, fileId) {
  const imageManipulation = strapi.plugin('upload').service('image-manipulation');
  const providerService = strapi.plugin('upload').service('provider');
  const query = strapi.db.query(FILE_MODEL_UID);

  const row = await query.findOne({ where: { id: fileId } });
  const key = objectKeyFromUrl(row?.url, storage.baseUrl);
  if (!row || !key) throw new Error('row or object key not found');

  const workDir = await mkdtemp(join(tmpdir(), 'salanca-backfill-'));
  try {
    const filepath = join(workDir, `original${row.ext ?? ''}`);
    const object = await client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: key }));
    await pipeline(object.Body, createWriteStream(filepath));

    // Same shape Strapi's upload service hands to generateResponsiveFormats.
    const source = {
      name: row.name,
      hash: row.hash,
      ext: row.ext,
      mime: row.mime,
      path: null,
      filepath,
      tmpWorkingDirectory: workDir,
      getStream: () => createReadStream(filepath),
    };
    const generated = await imageManipulation.generateResponsiveFormats(source);
    const existing = row.formats ?? {};
    const added = {};
    for (const { key: name, file } of generated ?? []) {
      if (!(name in storage.breakpoints) || existing[name]?.url) continue;
      // Goes through the wrapped provider, so actionOptions (CacheControl) apply.
      await providerService.upload(file);
      added[name] = toStoredFormat(file);
    }
    if (Object.keys(added).length === 0) {
      throw new Error('Strapi generated no missing format (check width/height in DB vs the stored original)');
    }

    const fresh = await query.findOne({ where: { id: fileId }, select: ['formats'] });
    await query.update({ where: { id: fileId }, data: { formats: mergeFormats(fresh?.formats, added) } });
    return Object.keys(added);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function backfillHeaders(client, storage, heads, items) {
  for (const { key } of items) {
    const head = heads.get(key) ?? (await headObject(client, storage.bucket, key));
    if (!head) throw new Error(`object ${key} vanished`);
    await client.send(
      new CopyObjectCommand(
        buildCopyObjectInput({
          bucket: storage.bucket,
          key,
          head,
          cacheControl: storage.cacheControl,
          acl: storage.acl,
        }),
      ),
    );
  }
}

async function runPhase(name, groups, worker, failures) {
  let done = 0;
  await mapWithConcurrency(groups, DEFAULT_CONCURRENCY, async (group) => {
    try {
      const detail = await worker(group);
      done += 1;
      console.log(`  [${name}] file #${group.fileId} ok${detail ? ` (${detail})` : ''}`);
    } catch (error) {
      failures.push({ phase: name, fileId: group.fileId, message: error?.message ?? String(error) });
      console.error(`  [${name}] file #${group.fileId} FAILED: ${error?.message ?? error}`);
    }
  });
  console.log(`[${name}] ${done}/${groups.length} files done`);
}

const options = parseBackfillArgs(process.argv.slice(2));
const app = await loadStrapiApp();
let client;

try {
  const storage = readStorageConfig(app);
  client = new S3Client(storage.s3Options);
  console.log(
    `Mode: ${options.apply ? 'APPLY' : 'DRY-RUN (read-only)'}; breakpoints ${JSON.stringify(storage.breakpoints)}; ` +
      `Cache-Control "${storage.cacheControl}"; ACL ${storage.acl ?? '(not sent)'}` +
      (options.limit ? `; limit ${options.limit} files per phase` : ''),
  );

  const before = await scan(app, client, storage, options.apply ? 'before' : 'dry-run');
  console.log(formatBackfillReport(before.report));

  if (options.apply) {
    const settings = await app.plugin('upload').service('upload').getSettings();
    if (!settings?.responsiveDimensions) {
      throw new Error('Upload setting responsiveDimensions is off; Strapi would generate no formats.');
    }
    const failures = [];

    console.log('\nBackfilling formats…');
    await runPhase(
      'formats',
      takeFiles(before.report.formats.pending, options.limit),
      async ({ fileId }) => (await backfillFormats(app, client, storage, fileId)).join(', '),
      failures,
    );

    // New formats were uploaded with the header, so the first scan already
    // lists every object that still needs it; no second sweep.
    console.log('\nBackfilling Cache-Control…');
    await runPhase(
      'headers',
      takeFiles(before.report.headers.pending, options.limit),
      async ({ items }) => {
        await backfillHeaders(client, storage, before.heads, items);
        return `${items.length} objects`;
      },
      failures,
    );

    const after = await scan(app, client, storage, 'after');
    console.log(`\n${formatBackfillReport(after.report)}`);
    await requestWebRevalidation();
    if (failures.length > 0) {
      console.error(`\n${failures.length} file(s) failed:`);
      for (const failure of failures) {
        console.error(`  - [${failure.phase}] #${failure.fileId}: ${failure.message}`);
      }
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error('media:backfill failed');
  console.error(error?.message ?? error);
  process.exitCode = 1;
} finally {
  client?.destroy();
  await app.destroy().catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}
