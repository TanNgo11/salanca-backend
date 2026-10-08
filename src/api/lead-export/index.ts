import type { Core } from '@strapi/strapi';

import { createLeadExportController } from './lead-export.controller';
import { ApiLeadExportPermission, LEAD_EXPORT_ROUTE } from './lead-export.types';

// Bulk personal-data download, so it has its own action instead of riding on
// Content Manager read.
const LEAD_EXPORT_ACTIONS = [
  {
    section: 'settings',
    displayName: 'Xuất CSV khách hàng (đặt bàn, liên hệ, newsletter)',
    uid: 'lead-export.export',
    pluginName: 'admin',
    category: 'lead export',
    subCategory: 'export',
  },
] as const;

type LeadExportRoleService = {
  resetSuperAdminPermissions(): Promise<void>;
};

export const registerLeadExportPermissions = (strapi: Core.Strapi): void => {
  strapi.admin.services.permission.actionProvider.registerMany([...LEAD_EXPORT_ACTIONS]);
};

export const bootstrapLeadExportPermissions = async (strapi: Core.Strapi): Promise<void> => {
  const roleService = strapi.admin.services.role as unknown as LeadExportRoleService;
  await roleService.resetSuperAdminPermissions();
};

export const registerLeadExportAdminRoutes = (strapi: Core.Strapi): void => {
  const controller = createLeadExportController(strapi);

  strapi.server.api('admin').routes([
    {
      method: 'GET',
      path: LEAD_EXPORT_ROUTE,
      handler: controller.exportCsv as never,
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        auth: { scope: [ApiLeadExportPermission.Export] },
      },
    },
  ]);
};
