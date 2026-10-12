import { describe, expect, it } from 'vitest';

import type { Order } from '../contracts';
import type { DeliveryZone } from '../domain/delivery/zones';
import { OrderingError } from '../domain/errors';
import { createSelfDeliveryProvider } from './self-delivery';

const near: DeliveryZone = {
  code: 'near',
  label: 'Gần',
  priority: 10,
  match: { kind: 'commune', communeCodes: ['XT01002'] },
  rules: [
    { when: 'subtotal-lt', subtotal: 100_000, fee: 'unavailable' },
    { when: 'subtotal-lt', subtotal: 300_000, fee: 15_000 },
    { when: 'any', fee: 0 },
  ],
  minOrderAmount: 100_000,
  extraLeadTimeMinutes: 30,
};

const provider = createSelfDeliveryProvider({
  zonesFor: async (locationRef) => (locationRef === 'Q1' ? [near] : []),
});

const order = {
  locationRef: 'Q1',
  subtotalAmount: 0,
  contactSnapshot: { name: 'Lan Thử', phone: '+84901112233' },
} as Order;

describe('self-delivery', () => {
  it('prices the first matching tier and ignores address text on the option', async () => {
    const money = await provider.calculatePrice({
      order,
      group: {} as never,
      option: { communeCode: 'xt01002', subtotal: 200_000, line1: '99 Đường Bí' },
    });
    expect(money).toEqual({ amount: 15_000, currency: 'VND' });
  });

  it('refuses an outside commune without echoing the street, name or phone', async () => {
    const error = await provider
      .calculatePrice({
        order,
        group: {} as never,
        option: { communeCode: 'XT02002', subtotal: 200_000, line1: '99 Đường Bí' },
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(OrderingError);
    const ordering = error as OrderingError;
    expect(ordering.code).toBe('DELIVERY_UNAVAILABLE');
    expect(ordering.details).toEqual({ communeCode: 'XT02002', reason: 'outside' });
    const dumped = JSON.stringify(ordering.details);
    expect(dumped).not.toContain('Đường');
    expect(dumped).not.toContain('Lan');
    expect(dumped).not.toContain('8490');
  });
});
