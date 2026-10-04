import { describe, expect, it } from 'vitest';

import {
  buildAdminTranslationOverrides,
  collectMissingAdminMessageIds,
} from './coverage.helper';
import { emailPluginMessages, emailPluginVietnameseTranslations } from './email-plugin';

const AREA_PREFIXES = ['email.'];

describe('email plugin translations', () => {
  it('prefixes every key for the email plugin', () => {
    for (const key of Object.keys(emailPluginVietnameseTranslations)) {
      expect(key.startsWith('email.')).toBe(true);
    }
  });

  it('keeps the prefixed map in sync with the raw message map', () => {
    const rawKeys = Object.keys(emailPluginMessages).sort();

    expect(Object.keys(emailPluginVietnameseTranslations).sort()).toEqual(
      rawKeys.map((key) => `email.${key}`).sort(),
    );

    for (const key of rawKeys) {
      expect(emailPluginMessages[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('leaves no English message id in the area it owns', () => {
    const leftovers = collectMissingAdminMessageIds(
      buildAdminTranslationOverrides(),
    ).filter((entry) => AREA_PREFIXES.some((prefix) => entry.id.startsWith(prefix)));

    expect(leftovers.map((entry) => entry.id)).toEqual([]);
  });

  it('preserves configuration placeholders and technical feature names', () => {
    expect(emailPluginMessages['Settings.email.plugin.text.configuration']).toContain('{file}');
    expect(emailPluginMessages['Settings.email.plugin.text.configuration']).toContain('{link}');
    expect(emailPluginMessages['Settings.email.plugin.notification.test.success']).toContain(
      '{to}',
    );
    expect(emailPluginMessages['Settings.capabilities.feature.dkim']).toBe('DKIM');
    expect(emailPluginMessages['Settings.capabilities.feature.oauth2']).toBe('OAuth2');
    expect(emailPluginMessages['Settings.email.plugin.placeholder.testAddress']).toBe(
      'ex: developer@example.com',
    );
  });
});
