/**
 * Soft-overlap: count non-archived leads on the same preferred date+time.
 */

import type { Core } from '@strapi/strapi';

const UID = 'api::reservation-request.reservation-request';

/**
 * Returns peer count for soft-overlap flagging (does not include the row being created).
 */
export const countSlotPeers = async (
  strapi: Core.Strapi,
  preferredDate: string,
  preferredTime: string,
): Promise<number> => {
  const peerCount = await strapi.db.query(UID).count({
    where: {
      preferredDate,
      preferredTime,
      status: { $in: ['new', 'read'] },
    },
  });
  return typeof peerCount === 'number' && Number.isFinite(peerCount) ? peerCount : 0;
};
