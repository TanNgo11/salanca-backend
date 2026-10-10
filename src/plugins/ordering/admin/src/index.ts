import { ShoppingCart } from '@strapi/icons';

import { PLUGIN_ID } from './pluginId';

export default {
  register(app: {
    addMenuLink: (link: Record<string, unknown>) => void;
    registerPlugin: (plugin: Record<string, unknown>) => void;
    customFields: { register: (field: Record<string, unknown>) => void };
  }) {
    app.customFields.register({
      name: 'localized-text', pluginId: PLUGIN_ID, type: 'json',
      intlLabel: { id: `${PLUGIN_ID}.localized-text.label`, defaultMessage: 'Chữ đa ngôn ngữ' },
      intlDescription: { id: `${PLUGIN_ID}.localized-text.description`, defaultMessage: 'Tiếng Việt và English' },
      components: { Input: () => import('./components/LocalizedTextInput') },
    });
    app.addMenuLink({
      to: `/plugins/${PLUGIN_ID}`,
      icon: ShoppingCart,
      intlLabel: { id: `${PLUGIN_ID}.menu.title`, defaultMessage: 'Bán hàng' },
      Component: () => import('./pages/HomePage'),
      permissions: [],
    });
    app.registerPlugin({ id: PLUGIN_ID, name: 'Ordering' });
  },
};
