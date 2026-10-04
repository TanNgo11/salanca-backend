import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { adminChromeVietnameseTranslations } from './admin-chrome';
import { adminSettingsVietnameseTranslations } from './admin-settings';
import { contentManagerChromeVietnameseTranslations } from './content-manager-chrome';
import { contentManagerEditVietnameseTranslations } from './content-manager-edit';
import { contentManagerListVietnameseTranslations } from './content-manager-list';
import { contentManagerViewConfigVietnameseTranslations } from './content-manager-view-config';
import { contentTypeBuilderAttributeVietnameseTranslations } from './content-type-builder-attributes';
import { contentTypeBuilderChromeVietnameseTranslations } from './content-type-builder-chrome';
import { documentationPluginVietnameseTranslations } from './documentation-plugin';
import { emailPluginVietnameseTranslations } from './email-plugin';
import { homepageWidgetVietnameseTranslations } from './homepage-widgets';
import { i18nPluginVietnameseTranslations } from './i18n-plugin';
import { mediaLibraryVietnameseTranslations } from './media-library';
import { runtimeFeedbackVietnameseTranslations } from './runtime-feedback';
import { usersPermissionsVietnameseTranslations } from './users-permissions-plugin';
import { vietnameseAdminTranslations } from './vi';

export type StrapiTranslationPackage = {
  packageName: string;
  prefix: string;
  translationsPath: string;
};

const PLUGIN_TRANSLATIONS_PATH = 'dist/admin/translations';

export const STRAPI_TRANSLATION_PACKAGES: readonly StrapiTranslationPackage[] = [
  {
    packageName: '@strapi/admin',
    prefix: '',
    translationsPath: 'dist/admin/admin/src/translations',
  },
  {
    packageName: '@strapi/content-manager',
    prefix: 'content-manager.',
    translationsPath: PLUGIN_TRANSLATIONS_PATH,
  },
  {
    packageName: '@strapi/content-type-builder',
    prefix: 'content-type-builder.',
    translationsPath: PLUGIN_TRANSLATIONS_PATH,
  },
  {
    packageName: '@strapi/content-releases',
    prefix: 'content-releases.',
    translationsPath: PLUGIN_TRANSLATIONS_PATH,
  },
  {
    packageName: '@strapi/email',
    prefix: 'email.',
    translationsPath: PLUGIN_TRANSLATIONS_PATH,
  },
  {
    packageName: '@strapi/i18n',
    prefix: 'i18n.',
    translationsPath: PLUGIN_TRANSLATIONS_PATH,
  },
  {
    packageName: '@strapi/plugin-documentation',
    prefix: 'documentation.',
    translationsPath: PLUGIN_TRANSLATIONS_PATH,
  },
  {
    packageName: '@strapi/plugin-users-permissions',
    prefix: 'users-permissions.',
    translationsPath: PLUGIN_TRANSLATIONS_PATH,
  },
  {
    packageName: '@strapi/review-workflows',
    prefix: 'review-workflows.',
    translationsPath: PLUGIN_TRANSLATIONS_PATH,
  },
  {
    packageName: '@strapi/upload',
    prefix: 'upload.',
    translationsPath: PLUGIN_TRANSLATIONS_PATH,
  },
];

// Resolve from the project package.json so this helper typechecks as CJS
// (src/admin is normally excluded from tsc, but the audit script imports it).
const nodeRequire = createRequire(join(process.cwd(), 'package.json'));
const requireFromStrapi = createRequire(nodeRequire.resolve('@strapi/strapi/package.json'));

export const loadStrapiMessages = (
  entry: StrapiTranslationPackage,
  locale: string,
): Record<string, string> => {
  try {
    const loaded = requireFromStrapi(
      join(
        dirname(requireFromStrapi.resolve(`${entry.packageName}/package.json`)),
        entry.translationsPath,
        `${locale}.json.js`,
      ),
    ) as Record<string, string> & { default?: Record<string, string> };

    return loaded.default ?? loaded;
  } catch {
    return {};
  }
};

export type MissingAdminMessage = {
  id: string;
  packageName: string;
  english: string;
};

export const collectMissingAdminMessageIds = (
  overrides: Record<string, string>,
): MissingAdminMessage[] => {
  const missing: MissingAdminMessage[] = [];

  for (const entry of STRAPI_TRANSLATION_PACKAGES) {
    const english = loadStrapiMessages(entry, 'en');
    const vietnamese = loadStrapiMessages(entry, 'vi');

    for (const [key, value] of Object.entries(english)) {
      const id = `${entry.prefix}${key}`;

      if (key in vietnamese || id in overrides) {
        continue;
      }

      missing.push({ id, packageName: entry.packageName, english: value });
    }
  }

  return missing;
};

export const buildAdminTranslationOverrides = (): Record<string, string> => ({
  ...vietnameseAdminTranslations,
  ...mediaLibraryVietnameseTranslations,
  ...runtimeFeedbackVietnameseTranslations,
  ...contentManagerChromeVietnameseTranslations,
  ...homepageWidgetVietnameseTranslations,
  ...contentManagerEditVietnameseTranslations,
  ...contentManagerListVietnameseTranslations,
  ...adminSettingsVietnameseTranslations,
  ...adminChromeVietnameseTranslations,
  ...i18nPluginVietnameseTranslations,
  ...usersPermissionsVietnameseTranslations,
  ...contentManagerViewConfigVietnameseTranslations,
  ...contentTypeBuilderAttributeVietnameseTranslations,
  ...contentTypeBuilderChromeVietnameseTranslations,
  ...emailPluginVietnameseTranslations,
  ...documentationPluginVietnameseTranslations,
});
