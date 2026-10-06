/**
 * Pure helpers for `media:backfill` (formats + Cache-Control backfill).
 * The CLI (index.mjs) owns all I/O; everything here is unit-tested in
 * backfill-media.helper.test.ts, which imports this file directly (same
 * convention as scripts/reconcile-media).
 */

import { toObjectKey, toVariants } from '../reconcile-media/reconcile-media.helper.mjs';

export const DEFAULT_CONCURRENCY = 3;
export const DEFAULT_EXAMPLE_LIMIT = 10;

/**
 * Mime types Strapi 5.51.1 resizes. Mirrors FORMATS_TO_RESIZE in
 * @strapi/upload/dist/server/services/image-manipulation.js (jpeg, png, webp,
 * tiff, gif); svg/avif get no responsive formats.
 */
const RESIZABLE_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/gif',
]);

const USAGE = 'Usage: pnpm run media:backfill [--apply] [--limit <n>]';

export function parseBackfillArgs(argv) {
  const options = { apply: false, limit: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--limit' || arg.startsWith('--limit=')) {
      const raw = arg === '--limit' ? argv[++index] : arg.slice('--limit='.length);
      if (!/^[1-9]\d*$/.test(raw ?? '')) {
        throw new Error(`--limit needs a positive integer. ${USAGE}`);
      }
      options.limit = Number(raw);
    } else {
      throw new Error(`Unknown argument "${arg}". ${USAGE}`);
    }
  }
  return options;
}

export function isImageFile(file) {
  return typeof file.mime === 'string' && file.mime.startsWith('image/');
}

export function isResizableImageMime(mime) {
  return RESIZABLE_IMAGE_MIMES.has(mime);
}

/**
 * Strapi's rule (image-manipulation.js `breakpointSmallerThan`): a format is
 * generated when the breakpoint is smaller than the original's width OR height.
 */
export function isBreakpointEligible(breakpoint, { width, height }) {
  return breakpoint < (width ?? 0) || breakpoint < (height ?? 0);
}

/** Breakpoint names this file should have but whose format (with a url) is absent. */
export function missingBreakpoints(file, breakpoints) {
  if (!isResizableImageMime(file.mime)) return [];
  const formats = file.formats ?? {};
  return Object.entries(breakpoints)
    .filter(([name, size]) => isBreakpointEligible(size, file) && !formats[name]?.url)
    .map(([name]) => name);
}

/** Object key for a stored url, or null when the url is not under baseUrl. */
export const objectKeyFromUrl = toObjectKey;

/** Original + every format of one file row, each with its object key (or null). */
export function fileObjects(file, baseUrl) {
  return toVariants(file).map((object) => ({ ...object, key: toObjectKey(object.url, baseUrl) }));
}

export function needsCacheControl(head, cacheControl) {
  return (head?.CacheControl ?? '') !== cacheControl;
}

/**
 * ACL exactly as @strapi/provider-upload-aws-s3 resolves it: an explicit `ACL`
 * key (even undefined) wins; a missing key falls back to public-read. A falsy
 * ACL is not sent at all.
 */
export function resolveProviderAcl(params) {
  if (params && Object.prototype.hasOwnProperty.call(params, 'ACL')) {
    return params.ACL || undefined;
  }
  return 'public-read';
}

export function encodeCopySource(bucket, key) {
  return `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * CopyObject onto the same key. REPLACE drops every piece of metadata, and a
 * copy resets the ACL, so both are re-sent from HeadObject / provider config.
 */
export function buildCopyObjectInput({ bucket, key, head, cacheControl, acl }) {
  const input = {
    Bucket: bucket,
    Key: key,
    CopySource: encodeCopySource(bucket, key),
    MetadataDirective: 'REPLACE',
    CacheControl: cacheControl,
  };
  if (head?.ContentType) input.ContentType = head.ContentType;
  if (head?.ContentDisposition) input.ContentDisposition = head.ContentDisposition;
  if (head?.ContentEncoding) input.ContentEncoding = head.ContentEncoding;
  if (head?.ContentLanguage) input.ContentLanguage = head.ContentLanguage;
  if (head?.Metadata && Object.keys(head.Metadata).length > 0) input.Metadata = head.Metadata;
  if (acl) input.ACL = acl;
  return input;
}

/** The JSON Strapi stores per format (resizeFileTo fields + provider url). */
export function toStoredFormat(file) {
  return {
    name: file.name,
    hash: file.hash,
    ext: file.ext,
    mime: file.mime,
    path: file.path ?? null,
    width: file.width,
    height: file.height,
    size: file.size,
    sizeInBytes: file.sizeInBytes,
    url: file.url,
  };
}

/** Adds new formats without touching any existing key. */
export function mergeFormats(existing, added) {
  const merged = { ...(existing ?? {}) };
  for (const [name, format] of Object.entries(added)) {
    if (!merged[name]?.url) merged[name] = format;
  }
  return merged;
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Formats part of the report from DB rows alone (no network).
 * `provider` is the configured upload provider; rows stored elsewhere are skipped.
 */
export function planFormatBackfill(files, { breakpoints, baseUrl, provider }) {
  const imageFiles = files.filter(isImageFile);
  const pending = [];
  const skipped = [];
  for (const file of imageFiles) {
    const missing = missingBreakpoints(file, breakpoints);
    if (missing.length === 0) continue;
    if (file.provider !== provider || objectKeyFromUrl(file.url, baseUrl) === null) {
      skipped.push({ fileId: file.id, missing, reason: 'not stored in the configured bucket' });
      continue;
    }
    pending.push({ fileId: file.id, missing });
  }
  return { imageFiles: imageFiles.length, pending, skipped };
}

/**
 * Header part of the report. `heads` maps object key -> HeadObject result, or
 * null when the object does not exist.
 */
export function planHeaderBackfill(files, heads, { baseUrl, cacheControl }) {
  const pending = [];
  const missingObjects = [];
  const unmanaged = [];
  let checkedObjects = 0;
  for (const file of files) {
    for (const object of fileObjects(file, baseUrl)) {
      if (object.key === null) {
        unmanaged.push({ fileId: file.id, variant: object.variant, url: object.url });
        continue;
      }
      checkedObjects += 1;
      const head = heads.get(object.key);
      if (head === null || head === undefined) {
        missingObjects.push({ fileId: file.id, variant: object.variant, key: object.key });
      } else if (needsCacheControl(head, cacheControl)) {
        pending.push({ fileId: file.id, variant: object.variant, key: object.key, current: head.CacheControl ?? null });
      }
    }
  }
  return { checkedObjects, pending, missingObjects, unmanaged };
}

const uniqueIds = (entries) => [...new Set(entries.map((entry) => entry.fileId))];

const exampleIds = (entries, limit) => {
  const ids = uniqueIds(entries);
  const shown = ids.slice(0, limit).map((id) => `#${id}`).join(', ');
  return ids.length > limit ? `${shown}, … (+${ids.length - limit})` : shown;
};

export function formatBackfillReport({ label, formats, headers }, exampleLimit = DEFAULT_EXAMPLE_LIMIT) {
  const lines = [`Media backfill report — ${label}`, ''];
  lines.push(`Image files (plugin::upload.file, image/*): ${formats.imageFiles}`);
  lines.push(
    `Files missing an eligible breakpoint format: ${formats.pending.length}` +
      (formats.pending.length ? ` (e.g. ${exampleIds(formats.pending, exampleLimit)})` : ''),
  );
  if (formats.skipped.length) {
    lines.push(
      `  skipped, not in the configured bucket: ${formats.skipped.length} (e.g. ${exampleIds(formats.skipped, exampleLimit)})`,
    );
  }
  lines.push(`S3 objects checked (original + formats): ${headers.checkedObjects}`);
  lines.push(
    `Objects without the expected Cache-Control: ${headers.pending.length}` +
      (headers.pending.length ? ` in ${uniqueIds(headers.pending).length} files (e.g. ${exampleIds(headers.pending, exampleLimit)})` : ''),
  );
  if (headers.missingObjects.length) {
    lines.push(
      `Objects referenced in the DB but missing in the bucket: ${headers.missingObjects.length} (e.g. ${exampleIds(headers.missingObjects, exampleLimit)})`,
    );
  }
  if (headers.unmanaged.length) {
    lines.push(
      `URLs outside the configured CDN base (not checked): ${headers.unmanaged.length} (e.g. ${exampleIds(headers.unmanaged, exampleLimit)})`,
    );
  }
  return lines.join('\n');
}

/** Groups pending items by file id, keeping first-seen order, capped at `limit` files. */
export function takeFiles(entries, limit) {
  const byFile = new Map();
  for (const entry of entries) {
    if (!byFile.has(entry.fileId)) {
      if (limit !== null && byFile.size >= limit) continue;
      byFile.set(entry.fileId, []);
    }
    byFile.get(entry.fileId).push(entry);
  }
  return [...byFile.entries()].map(([fileId, items]) => ({ fileId, items }));
}
