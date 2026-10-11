import { Cog, Folder, House, ShoppingCart, Store, User } from '@strapi/icons';

import { o3Translations } from './lib/i18n';
import { PERMISSIONS } from './lib/permissions';

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
    app.addMenuLink({
      to: `/plugins/${PLUGIN_ID}/orders`,
      icon: ShoppingCart,
      intlLabel: { id: `${PLUGIN_ID}.menu.title`, defaultMessage: 'Bán hàng' },
      Component: () => import('./pages/Orders'),
      permissions: PERMISSIONS.read,
    });
    app.addMenuLink({
      to: `/plugins/${PLUGIN_ID}/branches`,
      icon: House,
      intlLabel: { id: `${PLUGIN_ID}.menu.branches`, defaultMessage: 'Chi nhánh' },
      Component: () => import('./pages/Branches'),
      permissions: PERMISSIONS.settings,
    });
    app.addMenuLink({
      to: `/plugins/${PLUGIN_ID}/staff`,
      icon: User,
      intlLabel: { id: `${PLUGIN_ID}.menu.staff`, defaultMessage: 'Nhân viên bán hàng' },
      Component: () => import('./pages/Staff'),
      permissions: PERMISSIONS.scope,
    });
    app.addMenuLink({
      to: `/plugins/${PLUGIN_ID}/categories`,
      icon: Folder,
      intlLabel: { id: `${PLUGIN_ID}.menu.categories`, defaultMessage: 'Categories' },
      Component: () => import('./pages/Categories'),
      permissions: [],
    });
    app.addMenuLink({
      to: `/plugins/${PLUGIN_ID}/availability`,
      icon: Store,
      intlLabel: { id: `${PLUGIN_ID}.menu.availability`, defaultMessage: 'Temporarily out' },
      Component: () => import('./pages/Availability'),
      permissions: [],
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
      data: { ...(translationData[locale] ?? {}), ...o3Translations(locale) },
      locale,
    }));
  },
};
