import type { Core } from '@strapi/strapi';

import {
  PublicContentRoleType,
  getPublicContentPermissionActions,
  type PublicContentPermissionAction,
} from './public-content-permissions.types';

const contentTypeExists = (
  strapi: Core.Strapi,
  action: PublicContentPermissionAction,
): boolean => {
  // action format: api::name.name.find → uid api::name.name
  const contentTypeUid = action.slice(0, action.lastIndexOf('.'));
  try {
    return Boolean(strapi.getModel(contentTypeUid as Parameters<Core.Strapi['getModel']>[0]));
  } catch {
    return false;
  }
};

const ensurePublicPermission = async (
  strapi: Core.Strapi,
  roleDocumentId: string,
  action: PublicContentPermissionAction,
): Promise<void> => {
  if (!contentTypeExists(strapi, action)) {
    return;
  }

  const permission = await strapi.documents('plugin::users-permissions.permission').findFirst({
    fields: ['documentId'],
    filters: {
      action,
      role: {
        documentId: roleDocumentId,
      },
    },
  });

  if (permission) {
    return;
  }

  await strapi.documents('plugin::users-permissions.permission').create({
    data: {
      action,
      role: roleDocumentId,
    },
    fields: ['documentId'],
  });
};

/**
 * Grants Public role read access to published CMS content types.
 * Idempotent; skips actions whose content type is not registered.
 */
export const provisionPublicContentPermissions = async (
  strapi: Core.Strapi,
): Promise<void> => {
  const publicRole = await strapi.documents('plugin::users-permissions.role').findFirst({
    fields: ['documentId'],
    filters: {
      type: PublicContentRoleType.Public,
    },
  });

  if (!publicRole) {
    throw new Error('The public end-user role was not found.');
  }

  await Promise.all(
    getPublicContentPermissionActions().map((action) =>
      ensurePublicPermission(strapi, publicRole.documentId, action),
    ),
  );
};
