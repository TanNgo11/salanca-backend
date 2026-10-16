import type { RuleCode } from './audit/types';

export type MessageLang = 'vi' | 'en';

const MESSAGES: Record<RuleCode, Record<MessageLang, string>> = {
  'seo.block-missing': {
    vi: 'Chưa có khối SEO',
    en: 'SEO block is missing',
  },
  'seo.title-missing': {
    vi: 'Thiếu tiêu đề SEO',
    en: 'SEO title is missing',
  },
  'seo.description-missing': {
    vi: 'Thiếu mô tả SEO',
    en: 'SEO description is missing',
  },
  'seo.title-too-long': {
    vi: 'Tiêu đề SEO dài {length} ký tự, vượt mức {limit}',
    en: 'SEO title is {length} characters, over the {limit} limit',
  },
  'seo.description-too-long': {
    vi: 'Mô tả SEO dài {length} ký tự, vượt mức {limit}',
    en: 'SEO description is {length} characters, over the {limit} limit',
  },
  'seo.title-duplicate': {
    vi: 'Tiêu đề SEO trùng với {count} mục khác',
    en: 'SEO title is shared with {count} other entries',
  },
  'seo.description-duplicate': {
    vi: 'Mô tả SEO trùng với {count} mục khác',
    en: 'SEO description is shared with {count} other entries',
  },
  'i18n.translation-missing': {
    vi: 'Thiếu bản dịch {locale}',
    en: 'Missing {locale} translation',
  },
  'media.share-image-missing': {
    vi: 'Chưa có ảnh chia sẻ',
    en: 'Share image is missing',
  },
  'media.share-image-alt-missing': {
    vi: 'Ảnh chia sẻ thiếu văn bản thay thế (alt)',
    en: 'Share image has no alt text',
  },
  'seo.noindex-set': {
    vi: 'Mục đang đặt không index (noIndex)',
    en: 'Entry is set to noIndex',
  },
};

/** Thay `{tên}` bằng `String(params[tên])`; tên không có trong `params` thì giữ nguyên `{tên}`. */
export function formatMessage(
  code: RuleCode,
  params: Record<string, unknown>,
  lang: MessageLang,
): string {
  const template = MESSAGES[code]?.[lang] ?? code;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}
