import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import type { DocumentMiddlewareContext } from '../document-middleware/types';
import { validateCampaignDateRange } from './campaign-invariants.helper';

const { ApplicationError } = errors;

const CAMPAIGN_UID = 'api::campaign.campaign' as const;

/**
 * Campaign date-range invariant (before next). No-op for other UIDs/actions.
 */
export const enforceCampaignInvariants = async (
  strapi: Core.Strapi,
  ctx: DocumentMiddlewareContext,
): Promise<void> => {
  if (
    ctx.uid !== CAMPAIGN_UID
    || (ctx.action !== 'create' && ctx.action !== 'update')
  ) {
    return;
  }

  const data = ctx.params.data;
  if (!data || !('startsAt' in data || 'endsAt' in data)) {
    return;
  }

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
};
