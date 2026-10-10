import type { CatalogAdapter, Sellable } from '../contracts';

export type TestCatalogAdapter = CatalogAdapter & {
  seed(sellables: Sellable[]): void;
  clear(): void;
};

/** In-memory catalog adapter for integration tests; only registered under `testing.builtins`. */
export const createTestCatalogAdapter = (): TestCatalogAdapter => {
  const sellables = new Map<string, Sellable>();

  return {
    code: 'test-catalog',
    seed(items: Sellable[]) {
      for (const item of items) {
        sellables.set(item.ref.uid, item);
      }
    },
    clear() {
      sellables.clear();
    },
    async listCategories() {
      return [];
    },
    async listSellables(_ctx, input) {
      const items = [...sellables.values()]
        .filter((sellable) => sellable.isActive)
        .slice(0, input.limit);
      return { items };
    },
    async getSellable(_ctx, ref) {
      const sellable = sellables.get(ref.uid);
      return sellable && sellable.isActive ? sellable : null;
    },
    async getListPrice(_ctx, sellable) {
      return sellable.listPrice;
    },
    async getAvailability(_ctx, sellable) {
      return { available: sellable.purchasable };
    },
  };
};
