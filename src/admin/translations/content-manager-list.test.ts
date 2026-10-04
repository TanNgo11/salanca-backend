import { describe, expect, it } from 'vitest';

import {
  buildAdminTranslationOverrides,
  collectMissingAdminMessageIds,
} from './coverage.helper';
import {
  contentManagerListMessages,
  contentManagerListVietnameseTranslations,
} from './content-manager-list';

const AREA_PREFIXES = [
  'content-manager.App.schemas',
  'content-manager.ListViewTable.',
  'content-manager.actions-drawer.',
  'content-manager.bulk-publish.',
  'content-manager.bulk-unpublish.',
  'content-manager.components.Filters',
  'content-manager.components.ListViewTable',
  'content-manager.components.TableDelete',
  'content-manager.containers.list.',
  'content-manager.error.records',
  'content-manager.header.name',
  'content-manager.listView.validation',
  'content-manager.models',
  'content-manager.pages.NoContentType',
  'content-manager.permissions.not-allowed',
  'content-manager.popUpWarning.',
  'content-manager.popUpwarning.',
  'content-manager.utils.data-loaded',
];

describe('content manager list translations', () => {
  it('prefixes every key for the content-manager plugin', () => {
    for (const key of Object.keys(contentManagerListVietnameseTranslations)) {
      expect(key.startsWith('content-manager.')).toBe(true);
    }
  });

  it('keeps the prefixed map in sync with the raw message map', () => {
    const rawKeys = Object.keys(contentManagerListMessages).sort();

    expect(Object.keys(contentManagerListVietnameseTranslations).sort()).toEqual(
      rawKeys.map((key) => `content-manager.${key}`).sort(),
    );

    for (const key of rawKeys) {
      expect(contentManagerListMessages[key].trim().length).toBeGreaterThan(0);
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

  it('preserves ICU placeholders on loaded-count and bulk publish copy', () => {
    expect(contentManagerListMessages['utils.data-loaded']).toContain('{number, plural');
    expect(contentManagerListMessages['utils.data-loaded']).toContain('#');
    expect(
      contentManagerListMessages['containers.list.selectedEntriesModal.selectedCount.publish'],
    ).toContain('<b>{publishedCount}</b>');
    expect(
      contentManagerListMessages['popUpwarning.warning.bulk-has-draft-relations.message'],
    ).toContain('{ entities, plural');
  });

  it('vietnamizes the bulk action bar', () => {
    expect(contentManagerListMessages['containers.list.selectedEntriesModal.title']).toBe(
      'Xuất bản nhiều bản ghi',
    );
    expect(contentManagerListMessages['bulk-publish.already-published']).toBe('Đã xuất bản');
    expect(contentManagerListMessages['bulk-publish.modified']).toBe('Đã sửa');
    expect(contentManagerListMessages['bulk-publish.waiting-for-action']).toBe('Chờ xử lý');
    expect(contentManagerListMessages['pages.NoContentType.text']).toBe(
      'Chưa có loại nội dung nào',
    );
    expect(contentManagerListMessages['permissions.not-allowed.update']).toBe(
      'Bạn không có quyền sửa bản ghi này',
    );
  });
});
