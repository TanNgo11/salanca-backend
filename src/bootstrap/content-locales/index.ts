import type { Core } from '@strapi/strapi';

import {
  ContentLocaleCode,
  getManagedContentLocales,
  type ContentLocaleDefinition,
} from './content-locales.types';

type I18nLocalesService = {
  findByCode(code: string): Promise<{ code: string; name: string; isDefault?: boolean } | null>;
  create(payload: { code: string; name: string; isDefault?: boolean }): Promise<unknown>;
  setDefaultLocale(payload: { code: string }): Promise<unknown>;
  find(): Promise<Array<{ code: string; isDefault?: boolean }>>;
};

const getLocalesService = (strapi: Core.Strapi): I18nLocalesService =>
  strapi.plugin('i18n').service('locales') as I18nLocalesService;

const ensureLocale = async (
  strapi: Core.Strapi,
  definition: ContentLocaleDefinition,
): Promise<void> => {
  const localesService = getLocalesService(strapi);
  const existing = await localesService.findByCode(definition.code);

  if (!existing) {
    await localesService.create({
      code: definition.code,
      name: definition.name,
      isDefault: definition.isDefault === true,
    });
    return;
  }

  if (definition.isDefault === true) {
    const locales = await localesService.find();
    const currentDefault = locales.find((locale) => locale.isDefault);
    if (currentDefault?.code !== ContentLocaleCode.Vietnamese) {
      await localesService.setDefaultLocale({ code: ContentLocaleCode.Vietnamese });
    }
  }
};

/**
 * Ensures `vi` (default) and `en` locales exist for localized content types.
 * Idempotent — safe to run on every bootstrap.
 */
export const provisionContentLocales = async (strapi: Core.Strapi): Promise<void> => {
  for (const definition of getManagedContentLocales()) {
    await ensureLocale(strapi, definition);
  }

  await getLocalesService(strapi).setDefaultLocale({ code: ContentLocaleCode.Vietnamese });
};
