import type { StrapiApp } from '@strapi/strapi/admin';

import { watchContentManagerFieldHintVisibility } from './content-manager-field-hints.helper';
import { vietnameseAdminTranslations } from './translations/vi';

import './content-manager-field-hints.css';

enum AdminLocale {
  Vietnamese = 'vi',
}

const config = {
  locales: [AdminLocale.Vietnamese],
  translations: {
    [AdminLocale.Vietnamese]: {
      ...vietnameseAdminTranslations,
    },
  },
};

export default {
  config,
  bootstrap(_app: StrapiApp) {
    watchContentManagerFieldHintVisibility();
  },
};
