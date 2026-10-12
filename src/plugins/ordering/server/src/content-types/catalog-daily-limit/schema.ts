import { collection } from '../internal';

/**
 * Daily portion cap for one sellable entity at one branch. No row means unlimited.
 * Hidden from Content Manager — the availability service owns writes (scope, actor,
 * change log). `updatedBy` is Strapi's private admin-user relation, so the actor
 * ref lives in `updatedByRef`. Unique key is in migration 0005.
 */
export default collection(
  'catalog-daily-limit',
  {
    entityType: {
      type: 'enumeration',
      enum: ['product', 'variant', 'modifier'],
      required: true,
    },
    entityDocumentId: { type: 'string', required: true },
    locationRef: { type: 'string', required: true },
    dailyLimit: { type: 'integer', required: true, min: 0 },
    updatedByRef: { type: 'string' },
  },
  { displayName: 'Giới hạn phần theo ngày' },
);
