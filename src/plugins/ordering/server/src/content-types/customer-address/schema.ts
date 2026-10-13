import { collection } from '../internal';

/**
 * Customer address book (O11). Fields mirror the O5 delivery `AddressSnapshot` so a saved
 * address drops straight into checkout; names are the administrative catalog's, never free text.
 * Max 10 rows per customer, at most one `isDefault` — enforced by the customer service.
 */
export default collection(
  'customer-address',
  {
    customer: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.customer',
      inversedBy: 'addresses',
    },
    label: { type: 'string' },
    recipientName: { type: 'string', required: true },
    phone: { type: 'string', required: true },
    line1: { type: 'string', required: true },
    wardCode: { type: 'string', required: true },
    wardName: { type: 'string' },
    provinceCode: { type: 'string' },
    provinceName: { type: 'string' },
    note: { type: 'string' },
    isDefault: { type: 'boolean', required: true, default: false },
  },
  { displayName: 'Địa chỉ khách' },
);
