/**
 * Registry of adapters and providers. Apps register their own adapters in their `register()`
 * lifecycle; the plugin checks every enabled code against this registry in `bootstrap()`.
 */
export type CatalogAdapterEntry = { code: string };

const registry = () => {
  const catalogAdapters = new Map<string, CatalogAdapterEntry>();
  const lifecycleSteps: string[] = [];
  const receivedAppEvents: unknown[] = [];

  return {
    recordLifecycle(step: string) { lifecycleSteps.push(step); },
    lifecycle() { return [...lifecycleSteps]; },
    recordAppEvent(payload: unknown) { receivedAppEvents.push(payload); },
    appEvents() { return [...receivedAppEvents]; },
    registerCatalogAdapter(adapter: CatalogAdapterEntry) {
      if (catalogAdapters.has(adapter.code)) {
        throw new Error(`[ordering] catalog adapter "${adapter.code}" is already registered`);
      }
      catalogAdapters.set(adapter.code, adapter);
    },
    hasCatalogAdapter(code: string) {
      return catalogAdapters.has(code);
    },
    catalogAdapterCodes() {
      return [...catalogAdapters.keys()];
    },
  };
};

export type OrderingRegistry = ReturnType<typeof registry>;

export default registry;
