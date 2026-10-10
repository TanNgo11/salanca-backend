import { ShoppingCart } from '@strapi/icons';

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
      to: `/plugins/${PLUGIN_ID}`,
      icon: ShoppingCart,
      intlLabel: { id: `${PLUGIN_ID}.menu.title`, defaultMessage: 'Ordering' },
      Component: () => import('./pages/HomePage'),
      permissions: [],
    });
    app.registerPlugin({ id: PLUGIN_ID, name: 'Ordering' });
  },
  async registerTrads({ locales }: { locales: string[] }) {
    return locales.map((locale) => ({ data: translationData[locale] ?? {}, locale }));
  },
};
