import { describe, expect, it } from 'vitest';

import {
  buildAdminTranslationOverrides,
  collectMissingAdminMessageIds,
} from './coverage.helper';
import {
  contentTypeBuilderAttributeMessages,
  contentTypeBuilderAttributeVietnameseTranslations,
} from './content-type-builder-attributes';

const AREA_PREFIXES = [
  'content-type-builder.attribute.',
  'content-type-builder.component.repeatable',
  'content-type-builder.components.componentSelect',
  'content-type-builder.form.attribute.',
  'content-type-builder.media.multiple',
];

describe('content-type builder attribute translations', () => {
  it('prefixes every key for the content-type-builder plugin', () => {
    for (const key of Object.keys(contentTypeBuilderAttributeVietnameseTranslations)) {
      expect(key.startsWith('content-type-builder.')).toBe(true);
    }
  });

  it('keeps the prefixed map in sync with the raw message map', () => {
    const rawKeys = Object.keys(contentTypeBuilderAttributeMessages).sort();

    expect(Object.keys(contentTypeBuilderAttributeVietnameseTranslations).sort()).toEqual(
      rawKeys.map((key) => `content-type-builder.${key}`).sort(),
    );

    for (const key of rawKeys) {
      if (key === 'attribute.null') {
        expect(contentTypeBuilderAttributeMessages[key]).toBe(' ');
        continue;
      }

      expect(contentTypeBuilderAttributeMessages[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('leaves no English message id in the area it owns', () => {
    const leftovers = collectMissingAdminMessageIds(
      buildAdminTranslationOverrides(),
    ).filter((entry) => AREA_PREFIXES.some((prefix) => entry.id.startsWith(prefix)));

    expect(leftovers.map((entry) => entry.id)).toEqual([]);
  });

  it('keeps technical type names and example formats', () => {
    expect(contentTypeBuilderAttributeMessages['attribute.json']).toBe('JSON');
    expect(contentTypeBuilderAttributeMessages['attribute.uid']).toBe('UID');
    expect(contentTypeBuilderAttributeMessages['attribute.blocks']).toBe(
      'Rich text (Blocks)',
    );
    expect(contentTypeBuilderAttributeMessages['form.attribute.item.number.type.integer']).toBe(
      'số nguyên (ex: 10)',
    );
    expect(contentTypeBuilderAttributeMessages['form.attribute.condition.enum-change-warning']).toContain(
      '{fieldNames}',
    );
    expect(contentTypeBuilderAttributeMessages['form.attribute.condition.enum-change-warning']).toContain(
      '{values}',
    );
  });
});
