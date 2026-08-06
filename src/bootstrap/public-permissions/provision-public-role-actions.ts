import type { Core } from '@strapi/strapi';

import { PublicContentRoleType } from '../public-content-permissions/public-content-permissions.types';

const contentTypeExists = (strapi: Core.Strapi, action: string): boolean => {
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
  action: string,
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
 * Idempotently grants the listed Users-Permissions actions to the Public role.
 * Skips actions whose content type is not registered.
 */
export const provisionPublicRoleActions = async (
  strapi: Core.Strapi,
  actions: readonly string[],
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

  /*
   * Sequential on purpose: ensurePublicPermission is check-then-create with no
   * unique constraint behind it, so concurrent passes can insert duplicate
   * permission rows. Boot-time work over a handful of actions — the wall clock
   * cost is irrelevant next to the duplicate rows.
   */
  for (const action of actions) {
    await ensurePublicPermission(strapi, publicRole.documentId, action);
  }
};
