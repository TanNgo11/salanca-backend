import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  mediaLibraryMessages,
  mediaLibraryVietnameseTranslations,
} from './media-library';
import { AdminTranslationKey, vietnameseAdminTranslations } from './vi';

const require = createRequire(import.meta.url);
const requireFromStrapi = createRequire(
  require.resolve('@strapi/strapi/package.json'),
);
const uploadEnglishMessages = requireFromStrapi(
  join(
    dirname(requireFromStrapi.resolve('@strapi/upload/package.json')),
    'dist/admin/translations/en.json.js',
  ),
) as Record<string, string>;

describe('media library translations', () => {
  it('covers every @strapi/upload admin English key', () => {
    const messageKeys = Object.keys(mediaLibraryMessages).sort();
    const englishKeys = Object.keys(uploadEnglishMessages).sort();

    expect(messageKeys).toEqual(englishKeys);
    expect(Object.keys(mediaLibraryVietnameseTranslations)).toHaveLength(
      messageKeys.length,
    );

    for (const key of messageKeys) {
      expect(
        mediaLibraryMessages[key as keyof typeof mediaLibraryMessages].trim()
          .length,
      ).toBeGreaterThan(0);
      expect(mediaLibraryVietnameseTranslations[`upload.${key}`]).toBe(
        mediaLibraryMessages[key as keyof typeof mediaLibraryMessages],
      );
    }
  });

  it('prefixes every key for the upload plugin', () => {
    for (const key of Object.keys(mediaLibraryVietnameseTranslations)) {
      expect(key.startsWith('upload.')).toBe(true);
    }
  });

  it('keeps the already-shipped plugin name', () => {
    expect(
      mediaLibraryVietnameseTranslations[AdminTranslationKey.MediaLibraryPluginName],
    ).toBe(
      vietnameseAdminTranslations[AdminTranslationKey.MediaLibraryPluginName],
    );
  });

  it('vietnamizes the Media Library settings screen', () => {
    expect(mediaLibraryMessages['settings.header.label']).toBe(
      'Thư viện phương tiện',
    );
    expect(mediaLibraryMessages['settings.sub-header.label']).toBe(
      'Cấu hình thư viện phương tiện',
    );
    expect(mediaLibraryMessages['settings.blockTitle']).toBe(
      'Quản lý tài nguyên',
    );
    expect(mediaLibraryMessages['settings.form.responsiveDimensions.label']).toBe(
      'Tải lên đa kích thước',
    );
    expect(mediaLibraryMessages['settings.form.sizeOptimization.label']).toBe(
      'Tối ưu dung lượng',
    );
    expect(mediaLibraryMessages['settings.form.autoOrientation.label']).toBe(
      'Tự xoay hướng',
    );
  });

  it('vietnamizes editor-facing Media Library chrome', () => {
    expect(mediaLibraryMessages['plugin.name']).toBe('Thư viện phương tiện');
    expect(mediaLibraryMessages['header.actions.add-assets']).toBe(
      'Thêm tài nguyên',
    );
    expect(mediaLibraryMessages['header.actions.add-folder']).toBe(
      'Thêm thư mục',
    );
    expect(mediaLibraryMessages['folder.create.title']).toBe('Thư mục mới');
    expect(mediaLibraryMessages['control-card.edit']).toBe('Chỉnh sửa');
    expect(mediaLibraryMessages['list.bulk-actions.delete']).toBe('Xóa');
    expect(mediaLibraryMessages['search.label']).toBe('Tìm tài nguyên');
  });

  it('preserves ICU placeholders used by Strapi', () => {
    expect(mediaLibraryMessages['header.content.assets']).toContain(
      '{numberFolders',
    );
    expect(mediaLibraryMessages['header.content.assets']).toContain(
      '{numberAssets',
    );
    expect(
      mediaLibraryMessages['list.bulk-actions.delete.confirm.title'],
    ).toContain('{count');
    expect(mediaLibraryMessages['list.folder.select']).toContain('{name}');
  });
});
