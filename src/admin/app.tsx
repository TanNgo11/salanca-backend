import type { StrapiApp } from '@strapi/strapi/admin';
import { Bell, Clock } from '@strapi/icons';
import { Outlet } from 'react-router-dom';

import { hideDeveloperOnlyAdminPermissions } from './admin-navigation-visibility.helper';
import { ReservationInboxProvider } from './reservation-inbox/ReservationInboxProvider';
import {
  getReservationInboxTranslationId,
  reservationInboxPermissions,
} from './reservation-inbox/reservation-inbox.helper';
import { ReservationInboxTranslationKey } from './reservation-inbox/reservation-inbox.types';
import { reservationInboxVietnameseTranslations } from './reservation-inbox/vi';
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
      ...Object.fromEntries(
        Object.entries(reservationInboxVietnameseTranslations).map(([key, value]) => [
          `reservation-inbox.${key}`,
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

// The custom bootstrap only receives a picked subset of the app API (no
// router), so the full instance is captured in register for later use.
let registeredApp: StrapiApp | null = null;

export default {
  config,
  register(app: StrapiApp) {
    registeredApp = app;
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
    app.addMenuLink({
      to: '/plugins/reservation-inbox',
      icon: Bell,
      intlLabel: {
        id: getReservationInboxTranslationId(ReservationInboxTranslationKey.Title),
        defaultMessage: 'Hộp thư đặt bàn',
      },
      Component: () => import('./reservation-inbox/ReservationInboxScreen'),
      permissions: reservationInboxPermissions.read,
      position: 11,
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
    // Route wrapping must run after plugin bootstraps: some plugins call
    // addSettingsLink from bootstrap, which looks up a top-level `settings/*`
    // route in router._routes and crashes if it is nested inside a layout.
    // Custom bootstrap runs last, right before the router is created.
    registeredApp?.router.addRoute((routes) => [
      {
        element: (
          <ReservationInboxProvider>
            <Outlet />
          </ReservationInboxProvider>
        ),
        children: routes,
      },
    ]);
    watchContentManagerFieldHintVisibility();
  },
};
