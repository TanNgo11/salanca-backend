import type { StrapiApp } from '@strapi/strapi/admin';
import { Bell, Calendar, Clock, Mail } from '@strapi/icons';
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
import { EnumListCell } from './enum-list-cells/EnumListCell';
import {
  formatEnumerationColumns,
  INJECT_COLUMN_IN_TABLE_HOOK,
} from './enum-list-cells/enum-list-cells.helper';
import { LeadExportButton } from './lead-export/LeadExportButton';
import { notificationSettingsPermissions } from './notification-settings/notification-settings.helper';
import { createLeadListRedirect } from './lead-shortcuts/LeadListRedirect';
import { watchLeadNavHighlight } from './lead-shortcuts/lead-nav-highlight.helper';
import {
  contactMessageUid,
  hideLeadCollectionLinks,
  LEAD_COLLECTION_LINKS_HOOK,
  leadReadPermissions,
  reservationRequestUid,
} from './lead-shortcuts/lead-shortcuts.helper';
import { auditLogVietnameseTranslations } from './audit-log/vi';
import { watchContentManagerFieldHintVisibility } from './content-manager-field-hints.helper';
import { seedDefaultAdminLocale } from './interface-language/interface-language.helper';
import { registerDashboardWidgets } from './dashboard-widgets/register-dashboard-widgets';
import { hideContentTypeBuilderAdminSurface } from './content-type-builder-visibility.helper';
import { setupMainNavLabels } from './main-nav-labels.helper';
import { watchStaleChunkPreloadErrors } from './stale-chunk-reload.helper';
import { adminChromeVietnameseTranslations } from './translations/admin-chrome';
import { adminSettingsVietnameseTranslations } from './translations/admin-settings';
import { contentEnumOptionVietnameseTranslations } from './translations/content-enum-options';
import { contentManagerChromeVietnameseTranslations } from './translations/content-manager-chrome';
import { contentManagerEditVietnameseTranslations } from './translations/content-manager-edit';
import { contentManagerListVietnameseTranslations } from './translations/content-manager-list';
import { contentManagerViewConfigVietnameseTranslations } from './translations/content-manager-view-config';
import { contentTypeBuilderAttributeVietnameseTranslations } from './translations/content-type-builder-attributes';
import { contentTypeBuilderChromeVietnameseTranslations } from './translations/content-type-builder-chrome';
import { documentationPluginVietnameseTranslations } from './translations/documentation-plugin';
import { emailPluginVietnameseTranslations } from './translations/email-plugin';
import { homepageWidgetVietnameseTranslations } from './translations/homepage-widgets';
import { i18nPluginVietnameseTranslations } from './translations/i18n-plugin';
import { mediaLibraryVietnameseTranslations } from './translations/media-library';
import { runtimeFeedbackVietnameseTranslations } from './translations/runtime-feedback';
import { usersPermissionsVietnameseTranslations } from './translations/users-permissions-plugin';
import { vietnameseAdminTranslations } from './translations/vi';

enum AdminLocale {
  Vietnamese = 'vi',
}

const config = {
  locales: [AdminLocale.Vietnamese],
  translations: {
    [AdminLocale.Vietnamese]: {
      // Bare enum-value ids go first so no named Strapi message is shadowed.
      ...contentEnumOptionVietnameseTranslations,
      ...vietnameseAdminTranslations,
      ...mediaLibraryVietnameseTranslations,
      ...runtimeFeedbackVietnameseTranslations,
      ...contentManagerChromeVietnameseTranslations,
      ...homepageWidgetVietnameseTranslations,
      ...contentManagerEditVietnameseTranslations,
      ...contentManagerListVietnameseTranslations,
      ...adminSettingsVietnameseTranslations,
      ...adminChromeVietnameseTranslations,
      ...i18nPluginVietnameseTranslations,
      ...usersPermissionsVietnameseTranslations,
      ...contentManagerViewConfigVietnameseTranslations,
      ...contentTypeBuilderAttributeVietnameseTranslations,
      ...contentTypeBuilderChromeVietnameseTranslations,
      ...emailPluginVietnameseTranslations,
      ...documentationPluginVietnameseTranslations,
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
    // Rail order (Strapi sorts by position): Home 0, then the day-to-day lead
    // screens, Content Manager 1, Media Library 4, audit log 8, and Settings,
    // hardcoded at 9, stays last.
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
      position: 8,
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
      position: 0.1,
    });
    app.addMenuLink({
      to: '/plugins/contact-messages',
      icon: Mail,
      intlLabel: { id: 'lead-shortcuts.contact-message', defaultMessage: 'Tin nhắn liên hệ' },
      Component: async () => ({ default: createLeadListRedirect(contactMessageUid) }),
      permissions: leadReadPermissions(contactMessageUid),
      position: 0.3,
    });
    app.addMenuLink({
      to: '/plugins/reservation-requests',
      icon: Calendar,
      intlLabel: {
        id: 'lead-shortcuts.reservation-request',
        defaultMessage: 'Yêu cầu đặt bàn',
      },
      Component: async () => ({ default: createLeadListRedirect(reservationRequestUid) }),
      permissions: leadReadPermissions(reservationRequestUid),
      position: 0.2,
    });
    // Set once and left alone, so it lives under Settings instead of the rail.
    app.addSettingsLink(
      { id: 'salanca', intlLabel: { id: 'salanca.settings.section', defaultMessage: 'Salanca' } },
      {
        id: 'notification-settings',
        to: 'notification-settings',
        intlLabel: { id: 'notification-settings.title', defaultMessage: 'Email thông báo' },
        Component: () => import('./notification-settings/NotificationSettingsScreen'),
        permissions: notificationSettingsPermissions,
      },
    );
    registerDashboardWidgets(app);

    if (!isProductionAdminBuild) {
      return;
    }

    hideContentTypeBuilderAdminSurface(app);
    app.addRBACMiddleware(() => (next) => (permissions) =>
      next(hideDeveloperOnlyAdminPermissions(permissions)),
    );
  },
  bootstrap(app: StrapiApp) {
    // Runs before Strapi builds its store, so the login screen is Vietnamese on
    // a browser that has never signed in here.
    if (typeof window !== 'undefined') {
      seedDefaultAdminLocale(window.localStorage);
    }
    app.registerHook(LEAD_COLLECTION_LINKS_HOOK, hideLeadCollectionLinks);
    // "Xuất CSV" sits on the lead lists themselves; the button hides itself
    // on every other collection and for admins without the export permission.
    app.getPlugin('content-manager').injectComponent('listView', 'actions', {
      name: 'salanca-lead-export',
      Component: LeadExportButton,
    });
    app.registerHook(
      INJECT_COLUMN_IN_TABLE_HOOK,
      formatEnumerationColumns((value) => <EnumListCell value={value} />),
    );
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
    setupMainNavLabels();
    watchLeadNavHighlight();
    watchStaleChunkPreloadErrors();
  },
};
