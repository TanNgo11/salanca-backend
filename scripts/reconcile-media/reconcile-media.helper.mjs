/**
 * Runtime ESM helpers for media reconciliation (used by CLI).
 * Keep in sync with reconcile-media.helper.ts (unit-tested).
 */

const ORIGINAL_VARIANT = 'original';

export function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end -= 1;
  }
  return value.slice(0, end);
}

function toVariants(file) {
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

function toObjectKey(url, baseUrl) {
  const normalizedBase = stripTrailingSlashes(baseUrl);
  if (!url.startsWith(`${normalizedBase}/`)) {
    return null;
  }
  return url.slice(normalizedBase.length + 1);
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

export function formatMediaReconciliationReport(report) {
  const lines = [
    'Báo cáo đối chiếu media (chỉ đọc)',
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
    'Không có gì bị xoá hay sửa. Mỗi mục cần người xem xét và quyết định riêng.',
  );
  return lines.join('\n');
}
