import { collection } from '../internal';

/**
 * A loyalty tier (O16). `code` is unique (migration 0013 owns the index) and immutable;
 * tiers are switched off, never deleted. `multiplier` is ×100 (120 = ×1.2). `customerGroupCode`
 * names the O14 group the tier job keeps in step with the tier (null = no group, e.g. the base tier).
 */
export default collection(
  'loyalty-tier',
  {
    code: { type: 'string', required: true },
    name: { type: 'json', required: true },
    minSpend12m: { type: 'biginteger', required: true, default: 0 },
    multiplier: { type: 'integer', required: true, default: 100 },
    customerGroupCode: { type: 'string' },
    active: { type: 'boolean', required: true, default: true },
  },
  { displayName: 'Hạng thành viên' },
);
