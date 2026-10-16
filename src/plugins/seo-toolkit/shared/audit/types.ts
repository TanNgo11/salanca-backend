export type Severity = 'error' | 'warn' | 'notice';
export type ConfiguredSeverity = Severity | 'off';
export type AuditStatus = 'published' | 'draft';

export const RULE_CODES = [
  'seo.block-missing',
  'seo.title-missing',
  'seo.description-missing',
  'seo.title-too-long',
  'seo.description-too-long',
  'seo.title-duplicate',
  'seo.description-duplicate',
  'i18n.translation-missing',
  'media.share-image-missing',
  'media.share-image-alt-missing',
  'seo.noindex-set',
] as const;
export type RuleCode = (typeof RULE_CODES)[number];

/** Một đơn vị kiểm: (document, ngôn ngữ, khối SEO). Một content type có nhiều khối SEO thì mỗi khối là một entry. */
export interface AuditEntry {
  uid: string;
  documentId: string;
  locale: string | null;
  localized: boolean;
  label: string | null;
  seoField: string; // tên field component của khối này, dùng cho `field` của lỗi block-missing
  seo: AuditSeo | null; // null = không có khối SEO
}

export interface AuditSeo {
  title: string | null;
  description: string | null;
  /** undefined = web không có field ảnh; null = có field nhưng chưa chọn ảnh. */
  image: { alternativeText: string | null } | null | undefined;
  /** undefined = web không có field noIndex. */
  noIndex: boolean | null | undefined;
}

export interface AuditFieldNames {
  title: string;
  description: string;
  image: string | null;
  noIndex: string | null;
}

export interface AuditOptions {
  status: AuditStatus;
  /** Ngôn ngữ cấu hình trong phạm vi lần chạy (đã lọc theo `locales` nếu có). */
  locales: string[];
  limits: { title: number; description: number };
  severities: Partial<Record<RuleCode, ConfiguredSeverity>>;
  fields: AuditFieldNames;
}

export type AuditParamValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | Array<Record<string, string | null>>;

export interface AuditIssue {
  code: RuleCode;
  severity: Severity;
  uid: string;
  documentId: string;
  locale: string | null;
  label: string | null;
  /** SEO block this issue belongs to; null for document-level issues (translation-missing). */
  seoField: string | null;
  field: string | null;
  params: Record<string, AuditParamValue>;
}

export interface AuditReport {
  generatedAt: string; // truyền vào từ ngoài (engine không đọc giờ)
  scope: { status: AuditStatus; locales: string[]; contentTypes: string[] };
  summary: { entries: number; error: number; warn: number; notice: number };
  issues: AuditIssue[];
}
