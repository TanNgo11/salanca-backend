import type { StrapiApp } from '@strapi/strapi/admin';

import { hideDeveloperOnlyAdminPermissions } from './admin-navigation-visibility.helper';
import { watchContentManagerFieldHintVisibility } from './content-manager-field-hints.helper';
import { hideContentTypeBuilderAdminSurface } from './content-type-builder-visibility.helper';
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

// `strapi develop` serves the admin through Vite in development mode, while
// `strapi build` bundles it in production mode: developer tools stay available
// locally and disappear from deployed servers.
const isProductionAdminBuild = import.meta.env.MODE === 'production';

export default {
  config,
  register(app: StrapiApp) {
    if (!isProductionAdminBuild) {
      return;
    }

    hideContentTypeBuilderAdminSurface(app);
    app.addRBACMiddleware(() => (next) => (permissions) =>
      next(hideDeveloperOnlyAdminPermissions(permissions)),
    );
  },
  bootstrap(_app: StrapiApp) {
    watchContentManagerFieldHintVisibility();
  },
};
