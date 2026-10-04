import type { Core } from '@strapi/strapi';

import { createAuditLogController } from './audit-log.controller';
import { ensureAuditLogIndexes } from './audit-log.indexes';
import { ApiAuditLogPermission, ApiAuditLogRoute } from './audit-log.types';

const AUDIT_LOG_ACTIONS = [
  {
    section: 'settings',
    displayName: 'Xem nhật ký hoạt động',
    uid: 'audit-log.read',
    pluginName: 'admin',
    category: 'audit log',
    subCategory: 'viewer',
  },
  {
    section: 'settings',
    displayName: 'Xem chi tiết kỹ thuật nhật ký',
    uid: 'audit-log.details',
    pluginName: 'admin',
    category: 'audit log',
    subCategory: 'viewer',
  },
  {
    section: 'settings',
    displayName: 'Xuất CSV nhật ký hoạt động',
    uid: 'audit-log.export',
    pluginName: 'admin',
    category: 'audit log',
    subCategory: 'viewer',
  },
] as const;

type AuditLogRoleService = {
  resetSuperAdminPermissions(): Promise<void>;
};

export const registerAuditLogPermissions = (strapi: Core.Strapi): void => {
  strapi.admin.services.permission.actionProvider.registerMany([
    ...AUDIT_LOG_ACTIONS,
  ]);
};

export const bootstrapAuditLogPermissions = async (
  strapi: Core.Strapi,
): Promise<void> => {
  const roleService = strapi.admin.services.role as unknown as AuditLogRoleService;
  await ensureAuditLogIndexes(strapi);
  await roleService.resetSuperAdminPermissions();
};

export const registerAuditLogAdminRoutes = (strapi: Core.Strapi): void => {
  const controller = createAuditLogController(strapi);

  strapi.server.api('admin').routes([
    {
      method: 'GET',
      path: ApiAuditLogRoute.Events,
      handler: controller.find as never,
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        auth: { scope: [ApiAuditLogPermission.Read] },
      },
    },
    {
      method: 'GET',
      path: ApiAuditLogRoute.Event,
      handler: controller.findOne as never,
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        auth: { scope: [ApiAuditLogPermission.Details] },
      },
    },
    {
      method: 'GET',
      path: ApiAuditLogRoute.Export,
      handler: controller.exportCsv as never,
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        auth: { scope: [ApiAuditLogPermission.Export] },
      },
    },
  ]);
};
