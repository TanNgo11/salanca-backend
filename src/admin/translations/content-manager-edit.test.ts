import { describe, expect, it } from 'vitest';

import {
  buildAdminTranslationOverrides,
  collectMissingAdminMessageIds,
} from './coverage.helper';
import {
  contentManagerEditMessages,
  contentManagerEditVietnameseTranslations,
} from './content-manager-edit';

const AREA_PREFIXES = [
  'content-manager.actions.',
  'content-manager.apiError',
  'content-manager.components.DragHandle-label',
  'content-manager.components.DynamicZone',
  'content-manager.components.NotAllowedInput',
  'content-manager.components.RelationInput',
  'content-manager.components.RepeatableComponent',
  'content-manager.components.notification',
  'content-manager.components.repeatable',
  'content-manager.components.uid',
  'content-manager.containers.EditView',
  'content-manager.containers.edit.',
  'content-manager.containers.untitled',
  'content-manager.dnd.',
  'content-manager.form.Input',
  'content-manager.popover.display-relations',
  'content-manager.relation.',
  'content-manager.select.currently',
  'content-manager.success.record',
  'content-manager.validation.error',
];

describe('content manager edit translations', () => {
  it('prefixes every key for the content-manager plugin', () => {
    for (const key of Object.keys(contentManagerEditVietnameseTranslations)) {
      expect(key.startsWith('content-manager.')).toBe(true);
    }
  });

  it('keeps the prefixed map in sync with the raw message map', () => {
    const rawKeys = Object.keys(contentManagerEditMessages).sort();

    expect(Object.keys(contentManagerEditVietnameseTranslations).sort()).toEqual(
      rawKeys.map((key) => `content-manager.${key}`).sort(),
    );

    for (const key of rawKeys) {
      expect(contentManagerEditMessages[key].trim().length).toBeGreaterThan(0);
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

  it('preserves ICU placeholders on dynamic zone and drag-and-drop copy', () => {
    expect(contentManagerEditMessages['components.DynamicZone.add-component']).toContain(
      '{componentName}',
    );
    expect(contentManagerEditMessages['dnd.grab-item']).toContain('{item}');
    expect(contentManagerEditMessages['dnd.grab-item']).toContain('{position}');
    expect(contentManagerEditMessages['form.Input.hint.text']).toContain('{min, select');
    expect(contentManagerEditMessages['form.Input.hint.text']).toContain('{max, select');
  });

  it('vietnamizes the edit-view relation, uid, and untitled chrome', () => {
    expect(contentManagerEditMessages['relation.add']).toBe('Thêm liên kết');
    expect(contentManagerEditMessages['relation.disconnect']).toBe('Bỏ liên kết');
    expect(contentManagerEditMessages['relation.loadMore']).toBe('Tải thêm');
    expect(contentManagerEditMessages['relation.notAvailable']).toBe('Không còn lựa chọn');
    expect(contentManagerEditMessages['relation.isLoading']).toBe('Đang tải liên kết');
    expect(contentManagerEditMessages['components.uid.regenerate']).toBe('Tạo lại');
    expect(contentManagerEditMessages['components.uid.available']).toBe('Dùng được');
    expect(contentManagerEditMessages['components.uid.unavailable']).toBe(
      'Đã có bản ghi khác dùng',
    );
    expect(contentManagerEditMessages['containers.untitled']).toBe('Chưa có tiêu đề');
  });
});
