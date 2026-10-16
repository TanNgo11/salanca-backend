import { describe, expect, it } from 'vitest';

import { RULE_CODES } from './audit/types';
import { formatMessage } from './messages';

describe('formatMessage', () => {
  it('has a non-empty vi and en message for every rule code', () => {
    for (const code of RULE_CODES) {
      const vi = formatMessage(code, {}, 'vi');
      const en = formatMessage(code, {}, 'en');

      expect(vi).not.toBe('');
      expect(en).not.toBe('');
      expect(vi).not.toBe(code);
      expect(en).not.toBe(code);
    }
  });

  it('substitutes known params', () => {
    expect(formatMessage('seo.title-too-long', { length: 65, limit: 60 }, 'en')).toBe(
      'SEO title is 65 characters, over the 60 limit',
    );
    expect(formatMessage('i18n.translation-missing', { locale: 'en' }, 'vi')).toBe(
      'Thiếu bản dịch en',
    );
    expect(formatMessage('seo.title-duplicate', { count: 2 }, 'vi')).toBe(
      'Tiêu đề SEO trùng với 2 mục khác',
    );
  });

  it('keeps unknown placeholders untouched', () => {
    expect(formatMessage('seo.title-too-long', { length: 1 }, 'en')).toContain('{limit}');
  });
});
