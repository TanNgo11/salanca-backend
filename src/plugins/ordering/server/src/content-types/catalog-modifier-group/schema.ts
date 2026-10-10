import { catalogCollection } from '../internal';

/**
 * Shared add-on group library (contracts §20.1, TastyIgniter MenuOption). Products attach a
 * group via `modifierGroups` and override price/default/hidden per dish; these min/max/free
 * fields are only the defaults the attach record starts from.
 */
export default catalogCollection(
  'catalog-modifier-group',
  {
    name: {
      type: 'customField',
      customField: 'plugin::ordering.localized-text',
      required: true,
    },
    description: { type: 'customField', customField: 'plugin::ordering.localized-text' },
    selectionType: {
      type: 'enumeration',
      enum: ['single', 'multiple', 'quantity', 'text'],
      required: true,
      default: 'multiple',
    },
    minQuantity: { type: 'integer', default: 0 },
    maxQuantity: { type: 'integer', default: 1 },
    freeQuantity: { type: 'integer', default: 0 },
    rank: { type: 'integer', default: 0 },
    modifiers: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.catalog-modifier',
      mappedBy: 'group',
    },
  },
  { displayName: 'Nhóm tùy chọn' },
);
