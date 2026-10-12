import { collection } from '../internal';

/**
 * One catalog CSV import run (O10): validate → apply in a second call. `payload` keeps the raw
 * CSV between the two calls (cleared on apply); `catalogVersion` is the max catalog updated_at
 * hash at validation so a catalog change in between fails the apply with CATALOG_IMPORT_STALE.
 * `report` holds per-row errors (capped) and the created/updated counts.
 */
export default collection(
  'catalog-import',
  {
    kind: { type: 'enumeration', enum: ['products', 'modifiers'], required: true },
    fileName: { type: 'string', required: true },
    rowCount: { type: 'integer', required: true, default: 0 },
    status: {
      type: 'enumeration',
      enum: ['validated', 'applied', 'failed'],
      required: true,
      default: 'validated',
    },
    report: { type: 'json' },
    payload: { type: 'text' },
    catalogVersion: { type: 'string' },
    /** Actor ref (`admin:<id>`/`system`) — `createdBy` is reserved for Strapi's admin link. */
    createdByRef: { type: 'string' },
    appliedAt: { type: 'datetime' },
  },
  { displayName: 'Lần nhập menu' },
);
