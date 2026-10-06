/**
 * Runtime ESM helpers for media reconciliation (used by CLI), unit-tested
 * directly by reconcile-media.helper.test.ts.
 */

const ORIGINAL_VARIANT = 'original';

export function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end -= 1;
  }
  return value.slice(0, end);
}

/** Original + every format url of one file row (shared with media:backfill). */
export function toVariants(file) {
  const variants = [];
  if (typeof file.url === 'string' && file.url) {
    variants.push({ variant: ORIGINAL_VARIANT, url: file.url });
  }
  for (const [name, format] of Object.entries(file.formats ?? {})) {
    if (typeof format?.url === 'string' && format.url) {
      variants.push({ variant: name, url: format.url });
    }
  }
  return variants;
}

/** Bucket key for a stored url, or null when it is not under baseUrl (shared with media:backfill). */
export function toObjectKey(url, baseUrl) {
  if (typeof url !== 'string' || !url || !baseUrl) return null;
  const normalizedBase = stripTrailingSlashes(baseUrl);
  if (!url.startsWith(`${normalizedBase}/`)) {
    return null;
  }
  const key = url.slice(normalizedBase.length + 1);
  return key ? key : null;
}

export function buildMediaReconciliationReport(files, bucketKeys, baseUrl) {
  const expectedKeys = new Set();
  const missingObjects = [];
  const unmanagedUrls = [];
  const presentKeys = new Set(bucketKeys);

  for (const file of files) {
    const fileName = typeof file.name === 'string' && file.name ? file.name : String(file.id);
    for (const { variant, url } of toVariants(file)) {
      const key = toObjectKey(url, baseUrl);
      if (key === null) {
        unmanagedUrls.push({ fileId: file.id, fileName, variant, url });
        continue;
      }
      expectedKeys.add(key);
      if (!presentKeys.has(key)) {
        missingObjects.push({ fileId: file.id, fileName, variant, key });
      }
    }
  }

  return {
    checkedFiles: files.length,
    expectedObjects: expectedKeys.size,
    bucketObjects: presentKeys.size,
    missingObjects,
    orphanCandidates: bucketKeys.filter((key) => !expectedKeys.has(key)),
    unmanagedUrls,
  };
}

export function formatMediaReconciliationReport(report, { deleteOrphans = false } = {}) {
  const lines = [
    'Báo cáo đối chiếu media',
    '',
    `Số bản ghi kiểm tra: ${report.checkedFiles}`,
    `Số object mong đợi:  ${report.expectedObjects}`,
    `Số object trong bucket: ${report.bucketObjects}`,
    '',
    `Object thiếu (${report.missingObjects.length}):`,
  ];

  for (const finding of report.missingObjects) {
    lines.push(
      `  - ${finding.key} — tệp #${finding.fileId} "${finding.fileName}" (${finding.variant})`,
    );
  }

  lines.push('', `Object nghi mồ côi (${report.orphanCandidates.length}):`);
  for (const key of report.orphanCandidates) {
    lines.push(`  - ${key}`);
  }

  lines.push('', `URL ngoài CDN đã cấu hình (${report.unmanagedUrls.length}):`);
  for (const finding of report.unmanagedUrls) {
    lines.push(
      `  - ${finding.url} — tệp #${finding.fileId} "${finding.fileName}" (${finding.variant})`,
    );
  }

  lines.push(
    '',
    deleteOrphans
      ? 'Báo cáo trên chưa xoá gì. Kế hoạch xoá object mồ côi ở phần dưới.'
      : 'Không có gì bị xoá hay sửa. Mỗi mục cần người xem xét và quyết định riêng.',
  );
  return lines.join('\n');
}

const DEFAULT_MIN_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `--delete-orphans` lists what would be deleted; `--apply` is required to
 * delete. `--min-age-days` keeps recent orphans (a Replace leaves the old
 * objects for ISR pages and browser HTML that still carry the old URL).
 */
export function parseReconcileArgs(argv) {
  const args = { deleteOrphans: false, apply: false, minAgeDays: DEFAULT_MIN_AGE_DAYS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--delete-orphans') args.deleteOrphans = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--min-age-days') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--min-age-days needs a whole number of days, at least 1.');
      }
      args.minAgeDays = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.apply && !args.deleteOrphans) {
    throw new Error('--apply only applies to --delete-orphans.');
  }
  return args;
}

/** One key per line; blank lines and `#` comments are ignored. */
export function parseProtectedKeys(text) {
  return new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#')),
  );
}

/**
 * When each key was first seen as an orphan (ISO string). S3 LastModified is
 * the upload time, not the orphan time: a months-old object orphaned by a
 * Replace a minute ago must still wait the grace period. Keys that are no
 * longer orphans drop out, so a re-referenced key starts over.
 */
export function updateOrphanLedger(ledger, orphanKeys, now) {
  const next = {};
  for (const key of orphanKeys) {
    const seen = typeof ledger?.[key] === 'string' ? ledger[key] : undefined;
    next[key] = seen ?? now.toISOString();
  }
  return next;
}

/**
 * Orphans that are safe to delete: not protected and first seen as an orphan
 * at least `minAgeDays` ago (per the ledger).
 */
export function selectOrphansForDeletion(orphanKeys, firstSeenByKey, protectedKeys, now, minAgeDays) {
  const cutoff = now.getTime() - minAgeDays * DAY_MS;
  const deletable = [];
  const kept = [];
  for (const key of orphanKeys) {
    const firstSeen = Date.parse(firstSeenByKey[key] ?? '');
    if (protectedKeys.has(key)) kept.push({ key, reason: 'protected' });
    else if (!Number.isFinite(firstSeen) || firstSeen > cutoff) kept.push({ key, reason: 'too-recent' });
    else deletable.push(key);
  }
  return { deletable, kept };
}

export function formatOrphanDeletionPlan(plan, { apply, minAgeDays }) {
  const lines = [
    '',
    apply ? 'Xoá object mồ côi' : 'Xoá object mồ côi (thử, chưa xoá gì)',
    `Đủ điều kiện xoá — mồ côi từ ${minAgeDays} ngày trở lên (${plan.deletable.length}):`,
    ...plan.deletable.map((key) => `  - ${key}`),
    `Giữ lại (${plan.kept.length}):`,
    ...plan.kept.map(({ key, reason }) => `  - ${key} (${reason})`),
  ];
  if (!apply && plan.deletable.length > 0) {
    lines.push('', 'Chạy lại với --apply để xoá các object trên.');
  }
  return lines.join('\n');
}
