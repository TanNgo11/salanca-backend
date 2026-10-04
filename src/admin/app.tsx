import type { StrapiApp } from '@strapi/strapi/admin';
import { Clock } from '@strapi/icons';

import { hideDeveloperOnlyAdminPermissions } from './admin-navigation-visibility.helper';
import {
  auditLogPermissions,
  getAuditLogTranslationId,
} from './audit-log/audit-log.helper';
import { AuditLogTranslationKey } from './audit-log/audit-log.types';
import { auditLogVietnameseTranslations } from './audit-log/vi';
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
      ...Object.fromEntries(
        Object.entries(auditLogVietnameseTranslations).map(([key, value]) => [
          `audit-log.${key}`,
          value,
        ]),
      ),
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
    // Registered in every build mode: the audit log is a product screen, not a
    // developer tool. The link is permission-gated by auditLogPermissions.read.
    app.addMenuLink({
      to: '/plugins/audit-log',
      icon: Clock,
      intlLabel: {
        id: getAuditLogTranslationId(AuditLogTranslationKey.Title),
        defaultMessage: 'Nhật ký hoạt động',
      },
      Component: () => import('./audit-log/AuditLogScreen'),
      permissions: auditLogPermissions.read,
      position: 10,
    });

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
