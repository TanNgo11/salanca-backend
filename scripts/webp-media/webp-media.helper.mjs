/**
 * Pure helpers for `media:webp` (re-encode legacy JPEG derivatives as WebP).
 * The CLI (index.mjs) owns all I/O; everything here is unit-tested in
 * webp-media.helper.test.ts, same convention as scripts/backfill-media.
 */

import { objectKeyFromUrl } from '../backfill-media/backfill-media.helper.mjs';

/**
 * Offline batch, so the slower effort 6 is fine. Measured on a 1920px hero
 * (2026-10-08): JPEG 523 KB, WebP q80/effort 4 393 KB, q75/effort 6 314 KB.
 * q75 is also next/image's default, which the web already accepts.
 */
export const WEBP_OPTIONS = Object.freeze({ quality: 75, effort: 6 });
const WEBP_MIME = 'image/webp';
const EXAMPLE_LIMIT = 10;

/**
 * Only JPEG uploads: the web renders their `formats` straight into `srcset`.
 * Legacy PNG uploads go through next/image (salanca-web e96398f), which
 * already serves WebP, and uploads made with MEDIA_PROCESSING_ENABLED are
 * WebP from the start.
 */
export function isWebpTarget(file) {
  return file.mime === 'image/jpeg';
}

function isUsableFormat(format) {
  return (
    typeof format?.url === 'string' &&
    format.url !== '' &&
    Number.isInteger(format.width) &&
    format.width > 0 &&
    Number.isInteger(format.height) &&
    format.height > 0
  );
}

/** Format names whose stored derivative is not WebP yet. */
export function legacyFormatNames(file) {
  return Object.entries(file.formats ?? {})
    .filter(([, format]) => isUsableFormat(format) && format.mime !== WEBP_MIME)
    .map(([name]) => name)
    .sort();
}

export function planWebpConversion(files, { baseUrl, provider }) {
  const targets = files.filter(isWebpTarget);
  const pending = [];
  const skipped = [];
  for (const file of targets) {
    const names = legacyFormatNames(file);
    if (names.length === 0) continue;
    if (file.provider !== provider || objectKeyFromUrl(file.url, baseUrl) === null) {
      skipped.push({ fileId: file.id, names, reason: 'not stored in the configured bucket' });
      continue;
    }
    pending.push({ fileId: file.id, names });
  }
  return {
    jpegFiles: targets.length,
    pending,
    skipped,
    formats: pending.reduce((total, entry) => total + entry.names.length, 0),
  };
}

/**
 * Upload descriptor for one re-encoded derivative. The hash keeps Strapi's
 * `${name}_${hash}` shape, and the `.webp` extension gives it a new object key,
 * so no immutably cached JPEG object is ever overwritten.
 */
export function buildWebpUpload({ name, row, buffer, width, height }) {
  return {
    name: `${name}_${row.name.replace(/\.[^.]+$/, '')}.webp`,
    hash: `${name}_${row.hash}`,
    ext: '.webp',
    mime: WEBP_MIME,
    path: row.path ?? null,
    width,
    height,
    size: Math.round((buffer.byteLength / 1000) * 100) / 100,
    sizeInBytes: buffer.byteLength,
    buffer,
  };
}

/** Replaces the converted entries; formats the run did not touch are kept. */
export function replaceFormats(existing, converted) {
  return { ...(existing ?? {}), ...converted };
}

export function formatWebpReport({ label, plan, bytes }) {
  const examples = (entries) =>
    entries
      .slice(0, EXAMPLE_LIMIT)
      .map((entry) => `#${entry.fileId}`)
      .join(', ');
  const lines = [`Media WebP report — ${label}`, ''];
  lines.push(`JPEG files: ${plan.jpegFiles}`);
  lines.push(
    `Files with non-WebP derivatives: ${plan.pending.length} (${plan.formats} derivatives)` +
      (plan.pending.length ? ` (e.g. ${examples(plan.pending)})` : ''),
  );
  if (plan.skipped.length) {
    lines.push(`  skipped, not in the configured bucket: ${plan.skipped.length} (e.g. ${examples(plan.skipped)})`);
  }
  if (bytes) {
    const saved = bytes.before - bytes.after;
    const percent = bytes.before > 0 ? Math.round((saved / bytes.before) * 100) : 0;
    lines.push(
      `Converted derivative bytes: ${formatBytes(bytes.before)} -> ${formatBytes(bytes.after)} (-${percent}%)`,
    );
  }
  return lines.join('\n');
}

function formatBytes(value) {
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}
