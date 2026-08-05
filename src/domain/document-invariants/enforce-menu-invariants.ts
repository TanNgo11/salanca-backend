import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import type { DocumentMiddlewareContext } from '../document-middleware/types';
import {
  hasCategoryRelation,
  MENU_CATEGORY_UID,
  MENU_ITEM_UID,
} from './menu-invariants.helper';

const { ApplicationError } = errors;

/**
 * Menu relation invariants (before next). No-op for other UIDs/actions.
 */
export const enforceMenuInvariants = async (
  strapi: Core.Strapi,
  ctx: DocumentMiddlewareContext,
): Promise<void> => {
  if (ctx.uid === MENU_ITEM_UID && ctx.action === 'create') {
    if (!hasCategoryRelation(ctx.params.data?.category)) {
      throw new ApplicationError('A menu category is required.');
    }
    return;
  }

  if (ctx.uid === MENU_ITEM_UID && ctx.action === 'update') {
    const data = ctx.params.data;
    if (data && 'category' in data && !hasCategoryRelation(data.category)) {
      throw new ApplicationError(
        'A menu item cannot be saved without a menu category.',
      );
    }
    return;
  }

  if (ctx.uid === MENU_CATEGORY_UID && ctx.action === 'delete') {
    const linkedItemCount = await strapi.db.query(MENU_ITEM_UID).count({
      where: {
        category: {
          documentId: ctx.params.documentId,
        },
      },
    });

    if (linkedItemCount > 0) {
      throw new ApplicationError(
        'Cannot delete this menu category while menu items still reference it. Reassign or delete those items first.',
      );
    }
  }
};
