import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HomepageWidgetTranslationKey,
  homepageWidgetVietnameseTranslations,
} from './homepage-widgets';

const require = createRequire(import.meta.url);
const requireFromStrapi = createRequire(
  require.resolve('@strapi/strapi/package.json'),
);
const loadEnglishMessages = (packageName: string, relativePath: string) => {
  const loaded = requireFromStrapi(
    join(
      dirname(requireFromStrapi.resolve(`${packageName}/package.json`)),
      relativePath,
    ),
  ) as Record<string, string> & { default?: Record<string, string> };

  return loaded.default ?? loaded;
};

const adminEnglishMessages = loadEnglishMessages(
  '@strapi/admin',
  'dist/admin/admin/src/translations/en.json.js',
);
const contentManagerEnglishMessages = loadEnglishMessages(
  '@strapi/content-manager',
  'dist/admin/translations/en.json.js',
);

const CONTENT_MANAGER_PREFIX = 'content-manager.';

describe('homepage widget translations', () => {
  it('translates every declared key', () => {
    const keys = Object.values(HomepageWidgetTranslationKey);

    expect(keys.length).toBeGreaterThan(0);
    expect(Object.keys(homepageWidgetVietnameseTranslations)).toHaveLength(
      keys.length,
    );

    for (const key of keys) {
      expect(homepageWidgetVietnameseTranslations[key].trim().length).toBeGreaterThan(
        0,
      );
    }
  });

  it('only overrides message ids Strapi actually ships', () => {
    for (const key of Object.values(HomepageWidgetTranslationKey)) {
      if (key.startsWith(CONTENT_MANAGER_PREFIX)) {
        expect(
          contentManagerEnglishMessages[key.slice(CONTENT_MANAGER_PREFIX.length)],
        ).toBeTypeOf('string');
        continue;
      }

      expect(adminEnglishMessages[key]).toBeTypeOf('string');
    }
  });

  it('covers the homepage widget ids missing from the shipped Vietnamese catalogs', () => {
    expect(
      homepageWidgetVietnameseTranslations[
        HomepageWidgetTranslationKey.LastEditedTitle
      ],
    ).toBe('Bản ghi sửa gần đây');
    expect(
      homepageWidgetVietnameseTranslations[
        HomepageWidgetTranslationKey.LastPublishedTitle
      ],
    ).toBe('Bản ghi xuất bản gần đây');
    expect(
      homepageWidgetVietnameseTranslations[
        HomepageWidgetTranslationKey.KeyStatisticsTitle
      ],
    ).toBe('Thống kê dự án');
    expect(
      homepageWidgetVietnameseTranslations[
        HomepageWidgetTranslationKey.ProfileTitle
      ],
    ).toBe('Hồ sơ');
    expect(
      homepageWidgetVietnameseTranslations[
        HomepageWidgetTranslationKey.AddWidgetButton
      ],
    ).toBe('Thêm tiện ích');
    expect(
      homepageWidgetVietnameseTranslations[
        HomepageWidgetTranslationKey.LastEditedSingleType
      ],
    ).toBe('Nội dung đơn');
  });

  it('preserves the ICU placeholders Strapi passes to the entries chart', () => {
    expect(
      homepageWidgetVietnameseTranslations[
        HomepageWidgetTranslationKey.ChartEntriesCountLabel
      ],
    ).toContain('{count');
    expect(
      homepageWidgetVietnameseTranslations[
        HomepageWidgetTranslationKey.ChartEntriesTooltip
      ],
    ).toBe('{count} {label}');
  });
});
