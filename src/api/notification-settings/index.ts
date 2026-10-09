import type { Core } from '@strapi/strapi';

import { createNotificationSettingsController } from './notification-settings.controller';
import {
  ApiNotificationSettingsPermission,
  ApiNotificationSettingsRoute,
} from './notification-settings.types';

// Changes where guest personal data is emailed, so it has its own action.
const NOTIFICATION_SETTINGS_ACTIONS = [
  {
    section: 'settings',
    displayName: 'Cài đặt email nhận thông báo (đặt bàn, liên hệ)',
    uid: 'notification-settings.manage',
    pluginName: 'admin',
    category: 'notification settings',
    subCategory: 'manage',
  },
] as const;

type NotificationSettingsRoleService = {
  resetSuperAdminPermissions(): Promise<void>;
};

export const registerNotificationSettingsPermissions = (strapi: Core.Strapi): void => {
  strapi.admin.services.permission.actionProvider.registerMany([
    ...NOTIFICATION_SETTINGS_ACTIONS,
  ]);
};

export const bootstrapNotificationSettingsPermissions = async (
  strapi: Core.Strapi,
): Promise<void> => {
  const roleService = strapi.admin.services.role as unknown as NotificationSettingsRoleService;
  await roleService.resetSuperAdminPermissions();
};

export const registerNotificationSettingsAdminRoutes = (strapi: Core.Strapi): void => {
  const controller = createNotificationSettingsController(strapi);
  const config = {
    policies: ['admin::isAuthenticatedAdmin'],
    auth: { scope: [ApiNotificationSettingsPermission.Manage] },
  };

  strapi.server.api('admin').routes([
    { method: 'GET', path: ApiNotificationSettingsRoute.Settings, handler: controller.find as never, config },
    { method: 'PUT', path: ApiNotificationSettingsRoute.Settings, handler: controller.update as never, config },
    { method: 'POST', path: ApiNotificationSettingsRoute.Test, handler: controller.sendTest as never, config },
  ]);
};
