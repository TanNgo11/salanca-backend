import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

const { ApplicationError } = errors;

type Locale = {
  code: string;
  name: string;
};

type LocaleService = {
  create(locale: Locale): Promise<Locale>;
  findByCode(code: string): Promise<Locale | null>;
  setDefaultLocale(locale: Pick<Locale, 'code'>): Promise<void>;
};

const requiredLocales: Locale[] = [
  { code: 'vi', name: 'Vietnamese (vi)' },
  { code: 'en', name: 'English (en)' },
];

const MENU_CATEGORY_UID = 'api::menu-category.menu-category' as const;
const MENU_ITEM_UID = 'api::menu-item.menu-item' as const;

function hasCategoryRelation(value: unknown): boolean {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).length > 0;
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  const relation = value as {
    connect?: unknown[];
    set?: unknown[];
    documentId?: unknown;
    id?: unknown;
  };

  return Boolean(
    relation.documentId
      || relation.id
      || (Array.isArray(relation.connect) && relation.connect.length > 0)
      || (Array.isArray(relation.set) && relation.set.length > 0),
  );
}

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    strapi.documents.use(async (context, next) => {
      if (context.uid === MENU_ITEM_UID && context.action === 'create') {
        const data = context.params.data as Record<string, unknown> | undefined;

        if (!hasCategoryRelation(data?.category)) {
          throw new ApplicationError('A menu category is required.');
        }
      }

      if (context.uid === MENU_ITEM_UID && context.action === 'update') {
        const data = context.params.data as Record<string, unknown> | undefined;

        if (data && 'category' in data && !hasCategoryRelation(data.category)) {
          throw new ApplicationError(
            'A menu item cannot be saved without a menu category.',
          );
        }
      }

      if (context.uid !== MENU_CATEGORY_UID || context.action !== 'delete') {
        return next();
      }

      const linkedItemCount = await strapi.db.query(MENU_ITEM_UID).count({
        where: {
          category: {
            documentId: context.params.documentId,
          },
        },
      });

      if (linkedItemCount > 0) {
        throw new ApplicationError(
          'Cannot delete this menu category while menu items still reference it. Reassign or delete those items first.',
        );
      }

      return next();
    });
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const localeService = strapi.plugin('i18n').service('locales') as LocaleService;

    for (const locale of requiredLocales) {
      if (!(await localeService.findByCode(locale.code))) {
        await localeService.create(locale);
      }
    }

    await localeService.setDefaultLocale({ code: 'vi' });
  },
};
