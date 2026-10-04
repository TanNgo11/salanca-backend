import { describe, expect, it } from 'vitest';

import {
  ContentManagerChromeTranslationKey,
  contentManagerChromeVietnameseTranslations,
} from './content-manager-chrome';

describe('content-manager chrome translations', () => {
  it('covers every declared chrome translation key', () => {
    const keys = Object.values(ContentManagerChromeTranslationKey);

    expect(keys.length).toBeGreaterThan(0);
    expect(Object.keys(contentManagerChromeVietnameseTranslations)).toHaveLength(
      keys.length,
    );

    for (const key of keys) {
      expect(
        contentManagerChromeVietnameseTranslations[key]?.trim().length,
      ).toBeGreaterThan(0);
    }
  });

  it('vietnamizes editor-facing list and edit chrome', () => {
    expect(
      contentManagerChromeVietnameseTranslations[
        ContentManagerChromeTranslationKey.ActionsEdit
      ],
    ).toBe('Chỉnh sửa');
    expect(
      contentManagerChromeVietnameseTranslations[
        ContentManagerChromeTranslationKey.ActionsClone
      ],
    ).toBe('Nhân bản');
    expect(
      contentManagerChromeVietnameseTranslations[
        ContentManagerChromeTranslationKey.ActionsDelete
      ],
    ).toContain('Xóa bản ghi');
    expect(
      contentManagerChromeVietnameseTranslations[
        ContentManagerChromeTranslationKey.ListDraft
      ],
    ).toBe('Bản nháp');
    expect(
      contentManagerChromeVietnameseTranslations[
        ContentManagerChromeTranslationKey.ListPublished
      ],
    ).toBe('Đã xuất bản');
    expect(
      contentManagerChromeVietnameseTranslations[
        ContentManagerChromeTranslationKey.EditTitleNew
      ],
    ).toBe('Tạo bản ghi');
    expect(
      contentManagerChromeVietnameseTranslations[
        ContentManagerChromeTranslationKey.EditPublishedLabel
      ],
    ).toBe('Đã đăng lên website');
    expect(
      contentManagerChromeVietnameseTranslations[
        ContentManagerChromeTranslationKey.EditTabPublished
      ],
    ).toBe('đã đăng lên website');
    expect(
      contentManagerChromeVietnameseTranslations[
        ContentManagerChromeTranslationKey.SuccessPublish
      ],
    ).toBe('Đã đăng lên website');
    expect(
      contentManagerChromeVietnameseTranslations[
        ContentManagerChromeTranslationKey.ValidationError
      ],
    ).toBe('Biểu mẫu còn lỗi. Hãy sửa ô đang đánh dấu rồi lưu lại.');
  });
});
