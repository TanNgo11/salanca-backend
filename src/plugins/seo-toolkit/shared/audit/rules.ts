import type { RuleCode, Severity } from './types';

export const DEFAULT_SEVERITY: Record<RuleCode, Severity> = {
  'seo.block-missing': 'error',
  'seo.title-missing': 'error',
  'seo.description-missing': 'error',
  'seo.title-too-long': 'warn',
  'seo.description-too-long': 'warn',
  'seo.title-duplicate': 'warn',
  'seo.description-duplicate': 'warn',
  'i18n.translation-missing': 'warn',
  'media.share-image-missing': 'notice',
  'media.share-image-alt-missing': 'notice',
  'seo.noindex-set': 'warn',
};
