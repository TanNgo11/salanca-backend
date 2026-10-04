import { describe, expect, it } from 'vitest';

import { adminSettingsVietnameseTranslations } from './admin-settings';
import {
  buildAdminTranslationOverrides,
  collectMissingAdminMessageIds,
} from './coverage.helper';

const AREA_PREFIXES = [
  'Settings.adminTokens',
  'Settings.apiTokens',
  'Settings.application',
  'Settings.roles',
  'Settings.sessions',
  'Settings.tokens',
  'global.sessions.',
  'notification.success.adminToken',
];

describe('admin settings translations', () => {
  it('keeps every translated value non-empty', () => {
    const keys = Object.keys(adminSettingsVietnameseTranslations);

    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      expect(adminSettingsVietnameseTranslations[key].trim().length).toBeGreaterThan(0);
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

  it('preserves ICU placeholders on locale permission validation', () => {
    expect(
      adminSettingsVietnameseTranslations['Settings.roles.form.permissions.locales.validation'],
    ).toContain('{count');
    expect(
      adminSettingsVietnameseTranslations['Settings.roles.form.permissions.locales.validation'],
    ).toContain('{actions}');
  });

  it('keeps the Admin Token feature name in English', () => {
    expect(adminSettingsVietnameseTranslations['Settings.adminTokens.title']).toBe(
      'Admin Token',
    );
  });

  it('vietnamizes the sessions screen', () => {
    expect(adminSettingsVietnameseTranslations['Settings.sessions.title']).toBe(
      'Thiết bị đang đăng nhập',
    );
    expect(adminSettingsVietnameseTranslations['Settings.sessions.revoke']).toBe(
      'Kết thúc phiên',
    );
    expect(adminSettingsVietnameseTranslations['Settings.apiTokens.copy.lastWarning']).toBe(
      'Sao chép token của bạn',
    );
  });
});
