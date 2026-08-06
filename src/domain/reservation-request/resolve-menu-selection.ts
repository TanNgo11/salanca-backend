/**
 * Batch-verify published active menu package/item documentIds for reservation intake.
 */

import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { ReservationRequestValidationErrorCode } from './reservation-request.validation';

const { ApplicationError } = errors;

const MENU_PACKAGE_UID = 'api::menu-package.menu-package' as const;
const MENU_ITEM_UID = 'api::menu-item.menu-item' as const;

const assertAllPublishedActive = async (
  strapi: Core.Strapi,
  uid: typeof MENU_PACKAGE_UID | typeof MENU_ITEM_UID,
  documentIds: string[],
  label: string,
  locale: string,
): Promise<void> => {
  if (documentIds.length === 0) {
    return;
  }

  const found = await strapi.documents(uid).findMany({
    filters: {
      documentId: { $in: documentIds },
      isActive: true,
    },
    locale,
    status: 'published',
    fields: ['documentId'],
    limit: documentIds.length,
  });

  const foundIds = new Set(
    (Array.isArray(found) ? found : [])
      .map((row) => row.documentId)
      .filter((id): id is string => typeof id === 'string'),
  );

  const missing = documentIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new ApplicationError(
      `${label} not found, inactive, or not published: ${missing.join(', ')}`,
      { code: ReservationRequestValidationErrorCode.MenuIdsInvalid },
    );
  }
};

export type MenuConnectPayload = {
  menuPackages?: { connect: Array<{ documentId: string }> };
  menuItems?: { connect: Array<{ documentId: string }> };
};

/**
 * Validates menu documentIds exist as published+active, returns Document Service connect shape.
 *
 * `menu-item` and `menu-package` are localized, so the lookup must run in the
 * locale the guest was browsing: without it only the default (vi) row is
 * considered, and an EN-page selection is rejected for content the EN page
 * showed as published.
 */
export const resolveMenuSelection = async (
  strapi: Core.Strapi,
  menuPackageIds: string[],
  menuItemIds: string[],
  locale: string,
): Promise<MenuConnectPayload> => {
  await Promise.all([
    assertAllPublishedActive(strapi, MENU_PACKAGE_UID, menuPackageIds, 'menuPackages', locale),
    assertAllPublishedActive(strapi, MENU_ITEM_UID, menuItemIds, 'menuItems', locale),
  ]);

  const payload: MenuConnectPayload = {};
  if (menuPackageIds.length > 0) {
    payload.menuPackages = {
      connect: menuPackageIds.map((documentId) => ({ documentId })),
    };
  }
  if (menuItemIds.length > 0) {
    payload.menuItems = {
      connect: menuItemIds.map((documentId) => ({ documentId })),
    };
  }
  return payload;
};
