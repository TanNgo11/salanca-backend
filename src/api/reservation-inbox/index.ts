import type { Core } from '@strapi/strapi';

import { createReservationInboxController } from './reservation-inbox.controller';
import { ApiReservationInboxPermission, ApiReservationInboxRoute } from './reservation-inbox.types';

const RESERVATION_INBOX_ACTIONS = [
  {
    section: 'settings',
    displayName: 'Xem hộp thư đặt bàn',
    uid: 'reservation-inbox.read',
    pluginName: 'admin',
    category: 'reservation inbox',
    subCategory: 'viewer',
  },
] as const;

type ReservationInboxRoleService = {
  resetSuperAdminPermissions(): Promise<void>;
};

export const registerReservationInboxPermissions = (strapi: Core.Strapi): void => {
  strapi.admin.services.permission.actionProvider.registerMany([
    ...RESERVATION_INBOX_ACTIONS,
  ]);
};

export const bootstrapReservationInboxPermissions = async (
  strapi: Core.Strapi,
): Promise<void> => {
  const roleService = strapi.admin.services
    .role as unknown as ReservationInboxRoleService;
  await roleService.resetSuperAdminPermissions();
};

export const registerReservationInboxAdminRoutes = (strapi: Core.Strapi): void => {
  const controller = createReservationInboxController(strapi);

  strapi.server.api('admin').routes([
    {
      method: 'GET',
      path: ApiReservationInboxRoute.Summary,
      handler: controller.summary as never,
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        auth: { scope: [ApiReservationInboxPermission.Read] },
      },
    },
    {
      method: 'GET',
      path: ApiReservationInboxRoute.Stream,
      handler: controller.stream as never,
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        auth: { scope: [ApiReservationInboxPermission.Read] },
      },
    },
    {
      method: 'POST',
      path: ApiReservationInboxRoute.MarkRead,
      handler: controller.markRead as never,
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        auth: { scope: [ApiReservationInboxPermission.Read] },
      },
    },
    {
      method: 'GET',
      path: ApiReservationInboxRoute.List,
      handler: controller.list as never,
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        auth: { scope: [ApiReservationInboxPermission.Read] },
      },
    },
    {
      method: 'GET',
      path: ApiReservationInboxRoute.Detail,
      handler: controller.detail as never,
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        auth: { scope: [ApiReservationInboxPermission.Read] },
      },
    },
    {
      method: 'POST',
      path: ApiReservationInboxRoute.SetStatus,
      handler: controller.setStatus as never,
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        auth: { scope: [ApiReservationInboxPermission.Read] },
      },
    },
  ]);
};
