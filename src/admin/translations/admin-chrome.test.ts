import { describe, expect, it } from 'vitest';

import { adminChromeVietnameseTranslations } from './admin-chrome';
import {
  buildAdminTranslationOverrides,
  collectMissingAdminMessageIds,
} from './coverage.helper';

const AREA_PREFIXES = [
  'app.HeaderLayout',
  'app.components.',
  'app.error.chunk',
  'app.utils.update-filter',
  'components.Blocks.',
  'global.last-change',
  'global.last-changes',
  'global.localeToggle',
];

describe('admin chrome translations', () => {
  it('keeps every translated value non-empty', () => {
    const keys = Object.keys(adminChromeVietnameseTranslations);

    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      expect(adminChromeVietnameseTranslations[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('leaves no English message id in the area it owns', () => {
    const leftovers = collectMissingAdminMessageIds(
      buildAdminTranslationOverrides(),
    ).filter((entry) =>
      AREA_PREFIXES.some((prefix) => entry.id.startsWith(prefix)),
    );

    expect(leftovers.map((entry) => entry.id)).toEqual([]);
  });

  it('keeps HTML link attribute values untranslated', () => {
    expect(
      adminChromeVietnameseTranslations['components.Blocks.popover.link.target.placeholder'],
    ).toBe('_blank, _self, _parent, _top');
    expect(
      adminChromeVietnameseTranslations['components.Blocks.popover.link.rel.placeholder'],
    ).toBe('noopener, nofollow, noreferrer');
  });

  it('vietnamizes shared chrome strings', () => {
    expect(adminChromeVietnameseTranslations['app.error.chunk.title']).toBe(
      'Không tải được màn hình này',
    );
    expect(adminChromeVietnameseTranslations['app.components.Select.placeholder']).toBe(
      'Chọn',
    );
    expect(adminChromeVietnameseTranslations['app.utils.update-filter']).toBe(
      'Cập nhật bộ lọc',
    );
    expect(adminChromeVietnameseTranslations['app.utils.publish']).toBe(
      'Đăng lên website',
    );
    expect(adminChromeVietnameseTranslations['app.utils.published']).toBe(
      'Đã đăng lên website',
    );
  });
});
