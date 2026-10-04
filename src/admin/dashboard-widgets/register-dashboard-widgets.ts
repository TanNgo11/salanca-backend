import type { StrapiApp, WidgetArgs } from '@strapi/strapi/admin';
import { Calendar, ChartPie, Mail } from '@strapi/icons';

import {
  contactMessageUid,
  leadListPath,
  leadReadPermissions,
  reservationRequestUid,
} from '../lead-shortcuts/lead-shortcuts.helper';

const salancaWidgets: WidgetArgs[] = [
  {
    id: 'lead-overview',
    icon: ChartPie,
    title: { id: 'dashboard-widgets.lead-overview', defaultMessage: 'Tổng quan khách hàng' },
    component: async () => (await import('./LeadOverviewWidget')).default,
    permissions: [
      ...leadReadPermissions(reservationRequestUid),
      ...leadReadPermissions(contactMessageUid),
    ],
  },
  {
    id: 'upcoming-reservations',
    icon: Calendar,
    title: {
      id: 'dashboard-widgets.upcoming-reservations',
      defaultMessage: 'Lịch đặt bàn sắp tới',
    },
    link: {
      label: { id: 'dashboard-widgets.open-inbox', defaultMessage: 'Mở hộp thư đặt bàn' },
      href: '/plugins/reservation-inbox',
    },
    component: async () => (await import('./UpcomingReservationsWidget')).default,
    permissions: leadReadPermissions(reservationRequestUid),
  },
  {
    id: 'latest-contact-messages',
    icon: Mail,
    title: {
      id: 'dashboard-widgets.latest-contact-messages',
      defaultMessage: 'Tin nhắn liên hệ mới',
    },
    link: {
      label: { id: 'dashboard-widgets.open-contacts', defaultMessage: 'Xem tất cả' },
      href: leadListPath(contactMessageUid),
    },
    component: async () => (await import('./LatestContactMessagesWidget')).default,
    permissions: leadReadPermissions(contactMessageUid),
  },
];

/**
 * Restaurant-specific homepage widgets, placed ahead of Strapi's built-in ones
 * so a fresh (never customised) homepage opens on today's leads. Users who
 * already saved a custom layout add them through "Add Widget".
 */
export const registerDashboardWidgets = (app: StrapiApp): void => {
  app.widgets.register((existing) => [...salancaWidgets, ...existing]);
};
