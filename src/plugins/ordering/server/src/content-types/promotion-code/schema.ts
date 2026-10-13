import { collection } from '../internal';

/**
 * One redeemable code. Uniqueness is `upper(code)` in migration 0008 — Strapi `unique`
 * does not create a Postgres index, and codes compare case-insensitively.
 * `promotionId` is a numeric id, not a relation, so the redemption lock can `FOR UPDATE`
 * the promotion row without a link table.
 */
export default collection(
  'promotion-code',
  {
    promotionId: { type: 'integer', required: true },
    code: { type: 'string', required: true },
    usageLimit: { type: 'integer' },
    usedCount: { type: 'integer', required: true, default: 0 },
    active: { type: 'boolean', required: true, default: true },
    batch: { type: 'string' },
  },
  { displayName: 'Mã khuyến mãi' },
);
