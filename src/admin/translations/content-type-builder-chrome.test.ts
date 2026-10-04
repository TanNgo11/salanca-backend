import { describe, expect, it } from 'vitest';

import {
  buildAdminTranslationOverrides,
  collectMissingAdminMessageIds,
} from './coverage.helper';
import {
  contentTypeBuilderChromeMessages,
  contentTypeBuilderChromeVietnameseTranslations,
} from './content-type-builder-chrome';

const AREA_PREFIXES = [
  'content-type-builder.IconPicker.',
  'content-type-builder.button.',
  'content-type-builder.components.SelectComponents',
  'content-type-builder.configurations',
  'content-type-builder.contentType.',
  'content-type-builder.error.',
  'content-type-builder.form.button.',
  'content-type-builder.from',
  'content-type-builder.menu.section',
  'content-type-builder.modalForm.',
  'content-type-builder.modelPage.attribute',
  'content-type-builder.notification.',
  'content-type-builder.plugin.description',
  'content-type-builder.popUpForm.navContainer',
  'content-type-builder.popUpWarning.',
  'content-type-builder.prompt.unsaved',
  'content-type-builder.relation.',
  'content-type-builder.table.',
];

describe('content-type builder chrome translations', () => {
  it('prefixes every key for the content-type-builder plugin', () => {
    for (const key of Object.keys(contentTypeBuilderChromeVietnameseTranslations)) {
      expect(key.startsWith('content-type-builder.')).toBe(true);
    }
  });

  it('keeps the prefixed map in sync with the raw message map', () => {
    const rawKeys = Object.keys(contentTypeBuilderChromeMessages).sort();

    expect(Object.keys(contentTypeBuilderChromeVietnameseTranslations).sort()).toEqual(
      rawKeys.map((key) => `content-type-builder.${key}`).sort(),
    );

    for (const key of rawKeys) {
      expect(contentTypeBuilderChromeMessages[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('leaves no English message id in the area it owns', () => {
    const leftovers = collectMissingAdminMessageIds(
      buildAdminTranslationOverrides(),
    ).filter((entry) => AREA_PREFIXES.some((prefix) => entry.id.startsWith(prefix)));

    expect(leftovers.map((entry) => entry.id)).toEqual([]);
  });

  it('vietnamizes create buttons and keeps API ID labels technical', () => {
    expect(contentTypeBuilderChromeMessages['button.model.create']).toBe(
      'Tạo danh sách nội dung mới',
    );
    expect(contentTypeBuilderChromeMessages['button.single-types.create']).toBe(
      'Tạo nội dung đơn mới',
    );
    expect(contentTypeBuilderChromeMessages['contentType.apiId-singular.label']).toBe(
      'API ID (số ít)',
    );
    expect(contentTypeBuilderChromeMessages['modalForm.header-edit']).toContain('{name}');
    expect(contentTypeBuilderChromeMessages['prompt.unsaved']).toBe(
      'Bạn có chắc muốn rời trang? Mọi thay đổi sẽ mất.',
    );
  });
});
