import type { Core } from '@strapi/strapi';

import { provisionPublicRoleActions } from '../public-permissions/provision-public-role-actions';
import { getPublicContentPermissionActions } from './public-content-permissions.types';

/**
 * Grants Public role read access to published CMS content types.
 * Idempotent; skips actions whose content type is not registered.
 */
export const provisionPublicContentPermissions = async (
  strapi: Core.Strapi,
): Promise<void> => {
  await provisionPublicRoleActions(strapi, getPublicContentPermissionActions());
};
