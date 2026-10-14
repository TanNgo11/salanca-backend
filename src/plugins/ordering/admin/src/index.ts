import { Cog, ShoppingCart } from '@strapi/icons';

import { o10Translations, o11Translations, o13Translations, o14Translations, o8Translations, o9Translations, o15Translations, o3Translations, o4Translations, o5Translations, o6Translations, o7Translations } from './lib/i18n';
import { PERMISSIONS, RBAC_ANY_ORDERING } from './lib/permissions';

import { PLUGIN_ID } from './pluginId';
import en from './translations/en.json';
import vi from './translations/vi.json';

const translationData: Record<string, Record<string, string>> = { vi, en };

export default {
  register(app: {
    addMenuLink: (link: Record<string, unknown>) => void;
    registerPlugin: (plugin: Record<string, unknown>) => void;
    customFields: { register: (field: Record<string, unknown>) => void };
  }) {
    app.customFields.register({
      name: 'localized-text', pluginId: PLUGIN_ID, type: 'json',
      intlLabel: { id: `${PLUGIN_ID}.localized-text.label`, defaultMessage: 'Localized text' },
      intlDescription: { id: `${PLUGIN_ID}.localized-text.description`, defaultMessage: 'One input per enabled locale' },
      components: { Input: () => import('./components/LocalizedTextInput') },
    });
    app.customFields.register({
      name: 'modifier-groups', pluginId: PLUGIN_ID, type: 'json',
      intlLabel: { id: `${PLUGIN_ID}.modifier-groups.label`, defaultMessage: 'Attached option groups' },
      intlDescription: { id: `${PLUGIN_ID}.modifier-groups.description`, defaultMessage: 'Library groups attached to this product with per-product overrides (JSON)' },
      components: { Input: () => import('./custom-fields/modifier-groups/Input') },
    });
    app.customFields.register({
      name: 'bundle-slots', pluginId: PLUGIN_ID, type: 'json',
      intlLabel: { id: `${PLUGIN_ID}.bundle-slots.label`, defaultMessage: 'Combo slots' },
      intlDescription: { id: `${PLUGIN_ID}.bundle-slots.description`, defaultMessage: 'Choice groups inside this combo (JSON)' },
      components: { Input: () => import('./custom-fields/bundle-slots/Input') },
    });
    // One main-menu entry; every ordering screen sits under it with its own sub-navigation.
    app.addMenuLink({
      to: `/plugins/${PLUGIN_ID}`,
      icon: ShoppingCart,
      intlLabel: { id: `${PLUGIN_ID}.menu.title`, defaultMessage: 'Bán hàng' },
      Component: () => import('./pages/App'),
      permissions: RBAC_ANY_ORDERING,
    });
    app.registerPlugin({ id: PLUGIN_ID, name: 'Ordering' });
  },
  bootstrap(app: { addSettingsLink: (section: string | Record<string, unknown>, link: Record<string, unknown>) => void }) {
    app.addSettingsLink('global', {
      id: `${PLUGIN_ID}-settings`,
      to: `${PLUGIN_ID}`,
      icon: Cog,
      intlLabel: { id: `${PLUGIN_ID}.settings.title`, defaultMessage: 'Bán hàng' },
      Component: () => import('./pages/Settings'),
      permissions: PERMISSIONS.settings,
    });
  },
  async registerTrads({ locales }: { locales: string[] }) {
    return locales.map((locale) => ({
      data: {
        ...(translationData[locale] ?? {}),
        ...o3Translations(locale),
        ...o4Translations(locale),
        ...o5Translations(locale),
        ...o6Translations(locale),
        ...o7Translations(locale),
        ...o15Translations(locale),
        ...o10Translations(locale),
        ...o11Translations(locale),
        ...o8Translations(locale),
        ...o9Translations(locale),
        ...o13Translations(locale),
        ...o14Translations(locale),
      },
      locale,
    }));
  },
};
