import { collection } from '../internal';

/**
 * Per-branch "tạm hết" flag (contracts §20.1): product/variant/modifier × locationRef. Hidden
 * from Content Manager — writes go through the availability service so scope, actor and the
 * change log stay enforced. One row per (entityType, entity, location) — unique index in 0002.
 */
export default collection(
  'catalog-location-state',
  {
    entityType: {
      type: 'enumeration',
      enum: ['product', 'variant', 'modifier'],
      required: true,
    },
    entityDocumentId: { type: 'string', required: true },
    locationRef: { type: 'string', required: true },
    selling: { type: 'boolean', required: true, default: true },
    outOfStockUntil: { type: 'datetime' },
    untilKind: {
      type: 'enumeration',
      enum: ['end-of-business-day', 'specific-time'],
    },
    toggledBy: { type: 'string' },
    toggledAt: { type: 'datetime' },
  },
  { displayName: 'Trạng thái bán theo chi nhánh' },
);
