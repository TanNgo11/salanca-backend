import { describe, expect, it } from 'vitest';

import {
  AdminTranslationKey,
  vietnameseAdminTranslations,
} from './vi';

describe('vietnamese admin translations', () => {
  it('covers every declared admin translation key', () => {
    const keys = Object.values(AdminTranslationKey);

    expect(keys.length).toBeGreaterThan(0);
    expect(Object.keys(vietnameseAdminTranslations)).toHaveLength(keys.length);

    for (const key of keys) {
      expect(vietnameseAdminTranslations[key]?.trim().length).toBeGreaterThan(0);
    }
  });

  it('vietnamizes the Content Manager User list chrome', () => {
    expect(
      vietnameseAdminTranslations[AdminTranslationKey.ContentManagerCreateEntry],
    ).toBe('Tạo mới');
    expect(
      vietnameseAdminTranslations[AdminTranslationKey.ContentManagerListSubtitle],
    ).toContain('Tìm thấy');
    expect(
      vietnameseAdminTranslations[AdminTranslationKey.UsersPermissionsUserDisplayName],
    ).toBe('Người dùng');
    expect(
      vietnameseAdminTranslations[AdminTranslationKey.UsersPermissionsUserUsername],
    ).toBe('Tên đăng nhập');
    expect(
      vietnameseAdminTranslations[
        AdminTranslationKey.UsersPermissionsUserResetPasswordTokenExpiresAt
      ],
    ).toBe('Hết hạn token đặt lại mật khẩu');
    expect(
      vietnameseAdminTranslations[AdminTranslationKey.ContentManagerSystemCreatedAt],
    ).toBe('Ngày tạo');
    expect(
      vietnameseAdminTranslations[AdminTranslationKey.ContentManagerSystemCreatedBy],
    ).toBe('Người tạo');
    expect(
      vietnameseAdminTranslations[AdminTranslationKey.ContentManagerSystemDocumentId],
    ).toBe('Mã bản ghi');
    expect(
      vietnameseAdminTranslations[AdminTranslationKey.UsersPermissionsUserCreatedBy],
    ).toBe('Người tạo');
  });
});
