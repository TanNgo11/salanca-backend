import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { validateCampaignDateRange } from './campaign-invariants.helper';
import {
  hasCategoryRelation,
  MENU_CATEGORY_UID,
  MENU_ITEM_UID,
} from './menu-invariants.helper';

const { ApplicationError } = errors;

const CAMPAIGN_UID = 'api::campaign.campaign' as const;

type DocumentMiddlewareContext = {
  uid: string;
  action: string;
  params: {
    data?: Record<string, unknown>;
    documentId?: string;
  };
};

/**
 * Registers Document Service guards for menu relations and campaign dates.
 */
export const registerDocumentInvariants = (strapi: Core.Strapi): void => {
  strapi.documents.use(async (context, next) => {
    const ctx = context as DocumentMiddlewareContext;

    if (ctx.uid === MENU_ITEM_UID && ctx.action === 'create') {
      const data = ctx.params.data;

      if (!hasCategoryRelation(data?.category)) {
        throw new ApplicationError('A menu category is required.');
      }
    }

    if (ctx.uid === MENU_ITEM_UID && ctx.action === 'update') {
      const data = ctx.params.data;

      if (data && 'category' in data && !hasCategoryRelation(data.category)) {
        throw new ApplicationError(
          'A menu item cannot be saved without a menu category.',
        );
      }
    }

    if (
      ctx.uid === CAMPAIGN_UID
      && (ctx.action === 'create' || ctx.action === 'update')
    ) {
      const data = ctx.params.data;
      if (data && ('startsAt' in data || 'endsAt' in data)) {
        let startsAt = data.startsAt;
        let endsAt = data.endsAt;

        if (ctx.action === 'update' && ctx.params.documentId) {
          if (startsAt === undefined || endsAt === undefined) {
            const existing = await strapi.documents(CAMPAIGN_UID).findOne({
              documentId: ctx.params.documentId,
              fields: ['startsAt', 'endsAt'],
            });
            startsAt = startsAt === undefined ? existing?.startsAt : startsAt;
            endsAt = endsAt === undefined ? existing?.endsAt : endsAt;
          }
        }

        const dateError = validateCampaignDateRange(startsAt, endsAt);
        if (dateError) {
          throw new ApplicationError(dateError);
        }
      }
    }

    if (ctx.uid !== MENU_CATEGORY_UID || ctx.action !== 'delete') {
      return next();
    }

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

    return next();
  });
};
