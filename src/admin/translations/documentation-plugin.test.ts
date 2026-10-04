import { describe, expect, it } from 'vitest';

import {
  buildAdminTranslationOverrides,
  collectMissingAdminMessageIds,
} from './coverage.helper';
import {
  documentationPluginMessages,
  documentationPluginVietnameseTranslations,
} from './documentation-plugin';

const AREA_PREFIXES = ['documentation.'];

describe('documentation plugin translations', () => {
  it('prefixes every key for the documentation plugin', () => {
    for (const key of Object.keys(documentationPluginVietnameseTranslations)) {
      expect(key.startsWith('documentation.')).toBe(true);
    }
  });

  it('keeps the prefixed map in sync with the raw message map', () => {
    const rawKeys = Object.keys(documentationPluginMessages).sort();

    expect(Object.keys(documentationPluginVietnameseTranslations).sort()).toEqual(
      rawKeys.map((key) => `documentation.${key}`).sort(),
    );

    for (const key of rawKeys) {
      expect(documentationPluginMessages[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('leaves no English message id in the area it owns', () => {
    const leftovers = collectMissingAdminMessageIds(
      buildAdminTranslationOverrides(),
    ).filter((entry) => AREA_PREFIXES.some((prefix) => entry.id.startsWith(prefix)));

    expect(leftovers.map((entry) => entry.id)).toEqual([]);
  });

  it('keeps OpenAPI, SWAGGER UI, and {target} placeholders', () => {
    expect(documentationPluginMessages['plugin.description.short']).toContain('OpenAPI');
    expect(documentationPluginMessages['plugin.description.short']).toContain('SWAGGER UI');
    expect(documentationPluginMessages['pages.PluginPage.table.icon.show']).toBe(
      'Mở {target}',
    );
    expect(documentationPluginMessages['pages.PluginPage.table.icon.regenerate']).toBe(
      'Tạo lại {target}',
    );
  });
});
