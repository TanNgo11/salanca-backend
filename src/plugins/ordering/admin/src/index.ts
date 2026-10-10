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
