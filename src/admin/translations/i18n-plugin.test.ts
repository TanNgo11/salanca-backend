import { describe, expect, it } from 'vitest';

import {
  buildAdminTranslationOverrides,
  collectMissingAdminMessageIds,
} from './coverage.helper';
import { i18nPluginMessages, i18nPluginVietnameseTranslations } from './i18n-plugin';

const AREA_PREFIXES = ['i18n.'];

describe('i18n plugin translations', () => {
  it('prefixes every key for the i18n plugin', () => {
    for (const key of Object.keys(i18nPluginVietnameseTranslations)) {
      expect(key.startsWith('i18n.')).toBe(true);
    }
  });

  it('keeps the prefixed map in sync with the raw message map', () => {
    const rawKeys = Object.keys(i18nPluginMessages).sort();

    expect(Object.keys(i18nPluginVietnameseTranslations).sort()).toEqual(
      rawKeys.map((key) => `i18n.${key}`).sort(),
    );

    for (const key of rawKeys) {
      expect(i18nPluginMessages[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('leaves no English message id in the area it owns', () => {
    const leftovers = collectMissingAdminMessageIds(
      buildAdminTranslationOverrides(),
    ).filter((entry) => AREA_PREFIXES.some((prefix) => entry.id.startsWith(prefix)));

    expect(leftovers.map((entry) => entry.id)).toEqual([]);
  });

  it('keeps the em tag in the additional info messages', () => {
    for (const key of [
      'Settings.list.actions.deleteAdditionalInfos',
      'Settings.list.actions.publishAdditionalInfos',
      'Settings.list.actions.unpublishAdditionalInfos',
    ]) {
      expect(i18nPluginMessages[key]).toContain('<em>');
      expect(i18nPluginMessages[key]).toContain('</em>');
    }
  });

  it('vietnamizes locale settings chrome', () => {
    expect(i18nPluginMessages['plugin.name']).toBe('Đa ngôn ngữ');
    expect(i18nPluginMessages['Settings.list.actions.add']).toBe('Thêm ngôn ngữ');
    expect(i18nPluginMessages['Settings.locales.row.id']).toBe('ID');
    expect(i18nPluginMessages['actions.select-locale']).toBe('Chọn ngôn ngữ');
    expect(i18nPluginMessages['Field.localized']).toBe(
      'Giá trị này riêng cho ngôn ngữ đang chọn',
    );
  });
});
