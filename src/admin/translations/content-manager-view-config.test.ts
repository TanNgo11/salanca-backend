import { describe, expect, it } from 'vitest';

import {
  buildAdminTranslationOverrides,
  collectMissingAdminMessageIds,
} from './coverage.helper';
import {
  contentManagerViewConfigMessages,
  contentManagerViewConfigVietnameseTranslations,
} from './content-manager-view-config';

const AREA_PREFIXES = [
  'content-manager.api.id',
  'content-manager.components.DraggableCard',
  'content-manager.components.FieldItem',
  'content-manager.components.FieldSelect',
  'content-manager.components.SettingsViewWrapper',
  'content-manager.containers.EditSettingsView',
  'content-manager.containers.SettingPage',
  'content-manager.containers.SettingsPage',
  'content-manager.containers.SettingsView',
  'content-manager.containers.edit-settings',
  'content-manager.containers.list-settings',
  'content-manager.edit-settings-view.link-to-ctb',
  'content-manager.emptyAttributes.',
  'content-manager.link-to-ctb',
];

describe('content manager view configuration translations', () => {
  it('prefixes every key for the content-manager plugin', () => {
    for (const key of Object.keys(contentManagerViewConfigVietnameseTranslations)) {
      expect(key.startsWith('content-manager.')).toBe(true);
    }
  });

  it('keeps the prefixed map in sync with the raw message map', () => {
    const rawKeys = Object.keys(contentManagerViewConfigMessages).sort();

    expect(Object.keys(contentManagerViewConfigVietnameseTranslations).sort()).toEqual(
      rawKeys.map((key) => `content-manager.${key}`).sort(),
    );

    for (const key of rawKeys) {
      expect(contentManagerViewConfigMessages[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('leaves no English message id in the area it owns', () => {
    const leftovers = collectMissingAdminMessageIds(
      buildAdminTranslationOverrides(),
    ).filter((entry) => AREA_PREFIXES.some((prefix) => entry.id.startsWith(prefix)));

    expect(leftovers.map((entry) => entry.id)).toEqual([]);
  });

  it('keeps API ID untranslated and preserves field placeholders', () => {
    expect(contentManagerViewConfigMessages['api.id']).toBe('API ID');
    expect(contentManagerViewConfigMessages['components.DraggableCard.edit.field']).toContain(
      '{item}',
    );
    expect(contentManagerViewConfigMessages['components.DraggableCard.delete.field']).toContain(
      '{item}',
    );
  });

  it('vietnamizes configure-the-view chrome', () => {
    expect(contentManagerViewConfigMessages['components.FieldSelect.label']).toBe(
      'Thêm trường',
    );
    expect(contentManagerViewConfigMessages['containers.SettingPage.view']).toBe('Chế độ xem');
    expect(contentManagerViewConfigMessages['link-to-ctb']).toBe('Sửa loại nội dung');
  });
});
