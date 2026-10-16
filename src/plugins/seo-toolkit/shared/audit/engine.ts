import { DEFAULT_SEVERITY } from './rules';
import type {
  AuditEntry,
  AuditIssue,
  AuditOptions,
  AuditReport,
  AuditSeo,
  RuleCode,
  Severity,
} from './types';

const RANK: Record<Severity, number> = { error: 0, warn: 1, notice: 2 };
const SEPARATOR = '\u0000';

/** So sánh chuỗi bằng < / > thuần — không dùng localeCompare để kết quả không phụ thuộc môi trường. */
const compare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const trimmed = (value: string | null): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
};

const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Hàm thuần: chỉ đọc `entries`/`options`/`meta`, không gọi Strapi, không đọc giờ hay biến môi trường.
 * Thuật toán 10 bước theo docs/plans/seo-toolkit-v0.1-cms-audit.md.
 */
export function runAudit(
  entries: AuditEntry[],
  options: AuditOptions,
  meta: { generatedAt: string; contentTypes: string[] },
): AuditReport {
  const issues: AuditIssue[] = [];

  const add = (issue: Omit<AuditIssue, 'severity'>): void => {
    const severity = options.severities[issue.code] ?? DEFAULT_SEVERITY[issue.code];
    if (severity === 'off') return;
    issues.push({ ...issue, severity });
  };

  const base = (entry: AuditEntry) => ({
    uid: entry.uid,
    documentId: entry.documentId,
    locale: entry.locale,
    label: entry.label,
    seoField: entry.seoField,
  });

  // Bước 1-5: quy tắc theo từng entry.
  for (const entry of entries) {
    const seo = entry.seo;
    if (seo === null) {
      add({ ...base(entry), code: 'seo.block-missing', field: entry.seoField, params: {} });
      continue;
    }

    const title = trimmed(seo.title);
    if (title === null) {
      add({ ...base(entry), code: 'seo.title-missing', field: options.fields.title, params: {} });
    } else {
      const length = Array.from(title).length;
      if (length > options.limits.title) {
        add({
          ...base(entry),
          code: 'seo.title-too-long',
          field: options.fields.title,
          params: { length, limit: options.limits.title },
        });
      }
    }

    const description = trimmed(seo.description);
    if (description === null) {
      add({
        ...base(entry),
        code: 'seo.description-missing',
        field: options.fields.description,
        params: {},
      });
    } else {
      const length = Array.from(description).length;
      if (length > options.limits.description) {
        add({
          ...base(entry),
          code: 'seo.description-too-long',
          field: options.fields.description,
          params: { length, limit: options.limits.description },
        });
      }
    }

    if (seo.image !== undefined) {
      if (seo.image === null) {
        add({
          ...base(entry),
          code: 'media.share-image-missing',
          field: options.fields.image,
          params: {},
        });
      } else if (trimmed(seo.image.alternativeText) === null) {
        add({
          ...base(entry),
          code: 'media.share-image-alt-missing',
          field: options.fields.image,
          params: {},
        });
      }
    }

    if (seo.noIndex === true) {
      add({ ...base(entry), code: 'seo.noindex-set', field: options.fields.noIndex, params: {} });
    }
  }

  // Bước 6: trùng title và description trong cùng ngôn ngữ.
  const groupDuplicates = (
    selector: (seo: AuditSeo) => string | null,
    code: RuleCode,
    field: string | null,
  ): void => {
    const groups = new Map<string, AuditEntry[]>();
    for (const entry of entries) {
      if (entry.seo === null) continue;
      if (entry.seo.noIndex === true) continue;
      const value = trimmed(selector(entry.seo));
      if (value === null) continue;
      const key = `${entry.locale ?? ''}${SEPARATOR}${normalize(value)}`;
      const members = groups.get(key);
      if (members) members.push(entry);
      else groups.set(key, [entry]);
    }
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const sorted = [...members].sort(
        (left, right) =>
          compare(left.uid, right.uid) ||
          compare(left.documentId, right.documentId) ||
          compare(left.locale ?? '', right.locale ?? '') ||
          compare(left.seoField, right.seoField),
      );
      for (const entry of members) {
        const others = sorted
          .filter((member) => member !== entry)
          .slice(0, 5)
          .map((member) => ({
            uid: member.uid,
            documentId: member.documentId,
            locale: member.locale,
            seoField: member.seoField,
          }));
        add({ ...base(entry), code, field, params: { count: members.length - 1, others } });
      }
    }
  };

  groupDuplicates((seo) => seo.title, 'seo.title-duplicate', options.fields.title);
  groupDuplicates(
    (seo) => seo.description,
    'seo.description-duplicate',
    options.fields.description,
  );

  // Bước 7: thiếu bản dịch (chỉ entry i18n), báo ở ngôn ngữ bị thiếu.
  const documents = new Map<string, AuditEntry[]>();
  for (const entry of entries) {
    if (!entry.localized) continue;
    const key = `${entry.uid}${SEPARATOR}${entry.documentId}`;
    const members = documents.get(key);
    if (members) members.push(entry);
    else documents.set(key, [entry]);
  }
  for (const group of documents.values()) {
    const present = [
      ...new Set(
        group.map((member) => member.locale).filter((locale): locale is string => locale !== null),
      ),
    ].sort(compare);
    if (present.length === 0) continue;
    const labelEntry = [...group].sort((left, right) =>
      compare(left.locale ?? '', right.locale ?? ''),
    )[0];
    for (const locale of options.locales) {
      if (present.includes(locale)) continue;
      add({
        uid: group[0].uid,
        documentId: group[0].documentId,
        locale,
        label: labelEntry.label,
        seoField: null,
        code: 'i18n.translation-missing',
        field: null,
        params: { locale, sourceLocales: present },
      });
    }
  }

  // Bước 9: thứ tự xác định.
  issues.sort(
    (left, right) =>
      RANK[left.severity] - RANK[right.severity] ||
      compare(left.uid, right.uid) ||
      compare(left.documentId, right.documentId) ||
      compare(left.locale ?? '', right.locale ?? '') ||
      compare(left.code, right.code) ||
      compare(left.seoField ?? '', right.seoField ?? '') ||
      compare(left.field ?? '', right.field ?? ''),
  );

  // Bước 10: tổng hợp.
  const summary = { entries: entries.length, error: 0, warn: 0, notice: 0 };
  for (const issue of issues) summary[issue.severity] += 1;

  return {
    generatedAt: meta.generatedAt,
    scope: { status: options.status, locales: options.locales, contentTypes: meta.contentTypes },
    summary,
    issues,
  };
}
