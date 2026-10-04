import { describe, expect, it } from 'vitest';

import {
  buildAdminTranslationOverrides,
  collectMissingAdminMessageIds,
} from './coverage.helper';
import {
  usersPermissionsMessages,
  usersPermissionsVietnameseTranslations,
} from './users-permissions-plugin';

const AREA_PREFIXES = ['users-permissions.'];

describe('users-permissions plugin translations', () => {
  it('prefixes every key for the users-permissions plugin', () => {
    for (const key of Object.keys(usersPermissionsVietnameseTranslations)) {
      expect(key.startsWith('users-permissions.')).toBe(true);
    }
  });

  it('keeps the prefixed map in sync with the raw message map', () => {
    const rawKeys = Object.keys(usersPermissionsMessages).sort();

    expect(Object.keys(usersPermissionsVietnameseTranslations).sort()).toEqual(
      rawKeys.map((key) => `users-permissions.${key}`).sort(),
    );

    for (const key of rawKeys) {
      expect(usersPermissionsMessages[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('leaves no English message id in the area it owns', () => {
    const leftovers = collectMissingAdminMessageIds(
      buildAdminTranslationOverrides(),
    ).filter((entry) => AREA_PREFIXES.some((prefix) => entry.id.startsWith(prefix)));

    expect(leftovers.map((entry) => entry.id)).toEqual([]);
  });

  it('keeps template variables and sample URLs intact', () => {
    expect(usersPermissionsMessages['PopUpForm.Email.options.object.placeholder']).toContain(
      '%APP_NAME%',
    );
    expect(
      usersPermissionsMessages['EditForm.inputToggle.placeholder.email-reset-password'],
    ).toBe('ex: https://yourfrontend.com/reset-password');
  });

  it('vietnamizes roles and providers chrome', () => {
    expect(usersPermissionsMessages['Settings.section-label']).toBe(
      'Plugin Users & Permissions',
    );
    expect(usersPermissionsMessages['Roles.empty.search']).toBe(
      'Không có vai trò nào khớp tìm kiếm.',
    );
    expect(usersPermissionsMessages['roles.website-users.title']).toBe(
      'Vai trò người dùng website',
    );
    expect(usersPermissionsMessages['List.button.roles']).toBe(
      'Thêm vai trò người dùng',
    );
    expect(usersPermissionsMessages['PopUpForm.header.edit.providers']).toBe(
      'Sửa nhà cung cấp',
    );
  });
});
