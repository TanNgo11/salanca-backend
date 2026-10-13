import { collection } from '../internal';

/**
 * One customer in one group (O14). Ids are stored directly: Strapi relations are link tables,
 * and a unique (customer, group) index cannot sit on two of those. `source` is `manual` when
 * staff added the member and `auto` when the daily job did.
 */
export default collection(
  'customer-group-member',
  {
    customerId: { type: 'integer', required: true },
    customerDocumentId: { type: 'string', required: true },
    groupDocumentId: { type: 'string', required: true },
    source: { type: 'enumeration', enum: ['manual', 'auto'], required: true, default: 'manual' },
  },
  { displayName: 'Thành viên nhóm khách' },
);
