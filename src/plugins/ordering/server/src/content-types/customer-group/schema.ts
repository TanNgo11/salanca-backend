import { collection } from '../internal';

/**
 * A pricing segment (O14). Membership lives in `customer-group-member` (manual or automatic)
 * rather than a many-to-many, so the daily job can drop automatic members without touching
 * ones staff added, and erasure can remove every row for one customer.
 */
export default collection(
  'customer-group',
  {
    code: { type: 'string', required: true },
    name: { type: 'json', required: true },
    /** `{ minTotalSpent?, minOrderCount?, sinceDays? }` or null when membership is manual only. */
    auto: { type: 'json' },
    active: { type: 'boolean', required: true, default: true },
  },
  { displayName: 'Nhóm khách' },
);
