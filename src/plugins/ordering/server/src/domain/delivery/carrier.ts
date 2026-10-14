import type { FulfillmentProvider } from '../../contracts/fulfillment';
import type { OrderingRegistry } from '../../services/registry';

/** Capability marker: the provider's `calculatePrice` is the carrier's live quote (O13). */
export const CARRIER_PRICING = 'carrier-pricing';

/**
 * O13: which fulfillment provider owns a branch's delivery legs. `self-delivery` is always
 * registered and stays the fallback — when the configured carrier was removed (config off),
 * new legs silently return to zone pricing instead of failing order placement.
 */
export const resolveDeliveryProvider = (
  registry: Pick<OrderingRegistry, 'fulfillmentProvider' | 'hasFulfillmentProvider'>,
  carrierCode: string | undefined,
): FulfillmentProvider => {
  if (carrierCode && carrierCode !== 'self-delivery' && registry.hasFulfillmentProvider(carrierCode)) {
    return registry.fulfillmentProvider(carrierCode);
  }
  return registry.fulfillmentProvider('self-delivery');
};
