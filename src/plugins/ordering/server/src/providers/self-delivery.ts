import type { FulfillmentProvider, JsonObject, Order } from '../contracts';
import { quoteDelivery, type DeliveryZone } from '../domain/delivery/zones';
import { OrderingError } from '../domain/errors';
import type { Money } from '../domain/money';

export const SELF_DELIVERY_CODE = 'self-delivery';

export type SelfDeliveryDeps = {
  /** Zones configured on the branch. Empty when the branch does not exist. */
  zonesFor: (locationRef: string) => Promise<DeliveryZone[]> | DeliveryZone[];
};

const communeOf = (option: JsonObject): string =>
  typeof option.communeCode === 'string' ? option.communeCode.trim().toUpperCase() : '';

const subtotalOf = (option: JsonObject, order: Pick<Order, 'subtotalAmount'>): number => {
  if (typeof option.subtotal === 'number' && Number.isInteger(option.subtotal) && option.subtotal >= 0) {
    return option.subtotal;
  }
  return order.subtotalAmount ?? 0;
};

const locationOf = (order: Pick<Order, 'locationRef'>, option: JsonObject): string => {
  if (typeof order.locationRef === 'string' && order.locationRef !== '') return order.locationRef;
  return typeof option.locationRef === 'string' ? option.locationRef : '';
};

/**
 * Quán tự giao (contracts §5, §19.8). The provider only prices and acknowledges.
 * Core writes the fulfillment row, including the address snapshot. Details never
 * include a street, a name or a phone — only the commune code and the reason.
 */
export const createSelfDeliveryProvider = (deps: SelfDeliveryDeps): FulfillmentProvider => {
  const quote = async (order: Pick<Order, 'locationRef' | 'subtotalAmount'>, option: JsonObject) => {
    const zones = await deps.zonesFor(locationOf(order, option));
    return quoteDelivery(zones, { communeCode: communeOf(option), subtotal: subtotalOf(option, order) });
  };

  const refuse = (communeCode: string, reason: string, minOrderAmount?: number) =>
    new OrderingError('DELIVERY_UNAVAILABLE', 'delivery is not available for this commune', {
      details: {
        communeCode,
        reason,
        ...(minOrderAmount === undefined ? {} : { minOrderAmount }),
      },
    });

  return {
    code: SELF_DELIVERY_CODE,
    capabilities: ['quote', 'delivery'],
    async getOptions() {
      return [];
    },
    async validate(input) {
      const quoted = await quote(input.order, input.option);
      if (!quoted.available) {
        const communeCode = communeOf(input.option);
        return {
          valid: false,
          code: 'DELIVERY_UNAVAILABLE',
          message: 'delivery is not available for this commune',
          details: {
            communeCode,
            reason: quoted.reason,
            ...(quoted.reason === 'below-minimum' ? { minOrderAmount: quoted.minOrderAmount } : {}),
          },
        };
      }
      return { valid: true };
    },
    async calculatePrice(input): Promise<Money> {
      const quoted = await quote(input.order, input.option);
      if (!quoted.available) {
        throw refuse(
          communeOf(input.option),
          quoted.reason,
          quoted.reason === 'below-minimum' ? quoted.minOrderAmount : undefined,
        );
      }
      return { amount: quoted.fee, currency: 'VND' };
    },
    async create() {
      return {};
    },
  };
};
