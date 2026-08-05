import type { Core } from '@strapi/strapi';

import { provisionPublicRoleActions } from '../public-permissions/provision-public-role-actions';
import { getPublicFormPermissionActions } from './public-form-permissions.types';

/**
 * Grants Public role create-only access to form intake content types.
 * Idempotent; skips actions whose content type is not registered.
 */
export const provisionPublicFormPermissions = async (strapi: Core.Strapi): Promise<void> => {
  await provisionPublicRoleActions(strapi, getPublicFormPermissionActions());
};
