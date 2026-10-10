import type { CatalogAdapter } from '../contracts';

/**
 * Placeholder for the plugin's own catalog module (contracts §20). O2 replaces this stub with a
 * real adapter over the catalog content types; until then the default adapter code resolves but
 * serves nothing.
 */
export const createOrderingCatalogStubAdapter = (): CatalogAdapter => ({
  code: 'ordering-catalog',
  async listCategories() {
    return [];
  },
  async listSellables() {
    return { items: [] };
  },
  async getSellable() {
    return null;
  },
  async getListPrice(_ctx, sellable) {
    return sellable.listPrice;
  },
  async getAvailability() {
    return { available: false };
  },
});
