import path from 'node:path';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import {
  catalogView,
  deliveryCatalogWarning,
  lookupCommune,
  lookupProvince,
  readAdminUnitDirectory,
  resolveCatalog,
  type CatalogQuery,
  type ResolvedCatalog,
} from '../domain/admin-units/catalog';
import { TEST_ADMIN_UNITS } from '../domain/admin-units/test-fixture';

/** Official drop location. Runtime reads the source tree; the file is not compiled in. */
export const ADMIN_UNIT_DIR = path.join(
  process.cwd(),
  'src/plugins/ordering/server/src/data/admin-units',
);

/**
 * In-memory catalog. Loaded once per process. A restart picks up a newly added JSON file.
 * Nothing here logs a customer address, name or phone — only catalog version and counts.
 */
const adminUnits = ({ strapi }: { strapi: Core.Strapi }) => {
  let resolved: ResolvedCatalog | null = null;

  const load = (): ResolvedCatalog => {
    if (resolved) return resolved;
    const config = strapi.config.get('plugin::ordering') as OrderingConfig;
    resolved = resolveCatalog({
      fromDisk: readAdminUnitDirectory(ADMIN_UNIT_DIR),
      testingBuiltins: config.testing.builtins,
      fixture: TEST_ADMIN_UNITS,
    });
    return resolved;
  };

  return {
    load,
    catalog: () => load().catalog,
    lookupProvince: (code: string) => lookupProvince(load().catalog, code),
    lookupCommune: (code: string) => lookupCommune(load().catalog, code),
    view: (query: CatalogQuery) => catalogView(load(), query),
    /** True when any branch has turned delivery on. Used by bootstrap, not by quotes. */
    async anyBranchDeliveryEnabled(): Promise<boolean> {
      const rows = (await strapi.db.query('plugin::ordering.branch').findMany({
        select: ['fulfillment'],
      })) as Array<{ fulfillment: { delivery?: { enabled?: boolean } } | null }>;
      return rows.some((row) => row.fulfillment?.delivery?.enabled === true);
    },
    warning: (deliveryEnabled: boolean) => deliveryCatalogWarning({ deliveryEnabled, resolved: load() }),
  };
};

export default adminUnits;
