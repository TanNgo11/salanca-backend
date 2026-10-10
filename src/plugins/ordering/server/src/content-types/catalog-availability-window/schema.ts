import { catalogCollection } from '../internal';

/**
 * Local-time selling window (contracts §20.1, TastyIgniter Mealtime). Attached to a product or
 * a category — exactly one, enforced by Document Service middleware. `startTime`/`endTime` are
 * local clock times in the branch timezone; a window where start > end crosses midnight.
 * `daysOfWeek` is a JSON array of ISO weekdays (1=Mon … 7=Sun); null/empty means every day.
 */
export default catalogCollection(
  'catalog-availability-window',
  {
    name: { type: 'customField', customField: 'plugin::ordering.localized-text' },
    startTime: { type: 'time', required: true },
    endTime: { type: 'time', required: true },
    daysOfWeek: { type: 'json' },
    validFrom: { type: 'datetime' },
    validTo: { type: 'datetime' },
    category: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.catalog-category',
      inversedBy: 'availabilityWindows',
    },
    product: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.catalog-product',
      inversedBy: 'availabilityWindows',
    },
    isActive: { type: 'boolean', default: true },
    rank: { type: 'integer', default: 0 },
  },
  { displayName: 'Khung giờ bán' },
);
