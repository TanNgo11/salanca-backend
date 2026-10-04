import { describe, expect, it } from 'vitest';

import {
  buildAdminTranslationOverrides,
  collectMissingAdminMessageIds,
  loadStrapiMessages,
  STRAPI_TRANSLATION_PACKAGES,
} from './coverage.helper';

describe('admin translation coverage helper', () => {
  it('lists every Strapi admin package that ships translations', () => {
    const names = STRAPI_TRANSLATION_PACKAGES.map((entry) => entry.packageName);

    expect(names).toContain('@strapi/admin');
    expect(names).toContain('@strapi/content-manager');
    expect(names).toContain('@strapi/upload');
  });

  it('prefixes plugin ids the way Strapi does', () => {
    const byName = Object.fromEntries(
      STRAPI_TRANSLATION_PACKAGES.map((entry) => [entry.packageName, entry.prefix]),
    );

    expect(byName['@strapi/admin']).toBe('');
    expect(byName['@strapi/upload']).toBe('upload.');
    expect(byName['@strapi/i18n']).toBe('i18n.');
  });

  it('reads the shipped English catalogue', () => {
    const admin = STRAPI_TRANSLATION_PACKAGES.find(
      (entry) => entry.packageName === '@strapi/admin',
    );

    expect(admin).toBeDefined();
    expect(loadStrapiMessages(admin!, 'en')['HomePage.head.title']).toBe('Homepage');
  });

  it('reports no missing ids for the fully covered upload plugin', () => {
    const missing = collectMissingAdminMessageIds(buildAdminTranslationOverrides());

    expect(missing.filter((entry) => entry.id.startsWith('upload.'))).toHaveLength(0);
  });

  it('still reports ids nobody translated yet', () => {
    const missing = collectMissingAdminMessageIds({});

    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((entry) => typeof entry.english === 'string')).toBe(true);
  });
});
