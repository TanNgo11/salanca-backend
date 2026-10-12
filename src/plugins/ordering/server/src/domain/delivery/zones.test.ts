import { describe, expect, it } from 'vitest';

import { quoteDelivery, type DeliveryZone } from './zones';

/** The spec table: under the minimum no delivery, tiers, free above a threshold. */
const near: DeliveryZone = {
  code: 'near',
  label: 'Gần',
  priority: 10,
  match: { kind: 'commune', communeCodes: ['XT01001', 'XT01002'] },
  rules: [
    { when: 'subtotal-lt', subtotal: 100_000, fee: 'unavailable' },
    { when: 'subtotal-lt', subtotal: 300_000, fee: 15_000 },
    { when: 'any', fee: 0 },
  ],
  minOrderAmount: 100_000,
  extraLeadTimeMinutes: 30,
};

const far: DeliveryZone = {
  code: 'far',
  label: 'Xa',
  priority: 1,
  match: { kind: 'commune', communeCodes: ['XT01001', 'XT02001'] },
  rules: [{ when: 'any', fee: 30_000 }],
  minOrderAmount: 0,
  extraLeadTimeMinutes: 45,
};

const zones = [far, near];

describe('quoteDelivery', () => {
  it('refuses an order under the zone minimum', () => {
    expect(quoteDelivery(zones, { communeCode: 'XT01002', subtotal: 99_000 })).toMatchObject({
      available: false,
      reason: 'below-minimum',
      zoneCode: 'near',
      minOrderAmount: 100_000,
    });
  });

  it('charges the first matching tier and names the free threshold', () => {
    expect(quoteDelivery(zones, { communeCode: 'xt01002', subtotal: 200_000 })).toEqual({
      available: true,
      zoneCode: 'near',
      fee: 15_000,
      extraLeadTimeMinutes: 30,
      freeFrom: 300_000,
    });
  });

  it('delivers for free once the free tier is the first match', () => {
    expect(quoteDelivery(zones, { communeCode: 'XT01002', subtotal: 300_000 })).toMatchObject({
      available: true,
      fee: 0,
      freeFrom: null,
    });
  });

  it('lets the higher-priority zone win when a commune sits in two zones', () => {
    expect(quoteDelivery(zones, { communeCode: 'XT01001', subtotal: 500_000 })).toMatchObject({
      available: true,
      zoneCode: 'near',
      fee: 0,
    });
  });

  it('uses the only matching zone when priority does not matter', () => {
    expect(quoteDelivery(zones, { communeCode: 'XT02001', subtotal: 50_000 })).toMatchObject({
      available: true,
      zoneCode: 'far',
      fee: 30_000,
      extraLeadTimeMinutes: 45,
    });
  });

  it('returns outside when no zone lists the commune', () => {
    expect(quoteDelivery(zones, { communeCode: 'XT02002', subtotal: 500_000 })).toEqual({
      available: false,
      reason: 'outside',
    });
  });

  it('does not let a later free rule override an earlier match', () => {
    const eager: DeliveryZone = {
      ...far,
      code: 'eager',
      priority: 5,
      match: { kind: 'commune', communeCodes: ['XT01003'] },
      rules: [
        { when: 'any', fee: 10_000 },
        { when: 'subtotal-gte', subtotal: 1, fee: 0 },
      ],
    };
    expect(quoteDelivery([eager], { communeCode: 'XT01003', subtotal: 1_000_000 })).toMatchObject({
      available: true,
      fee: 10_000,
      freeFrom: null,
    });
  });

  it('treats a matching unavailable rule as no delivery, even above the minimum', () => {
    const blocked: DeliveryZone = {
      ...near,
      code: 'blocked',
      minOrderAmount: 0,
      match: { kind: 'commune', communeCodes: ['XT01003'] },
      rules: [
        { when: 'subtotal-lt', subtotal: 100_000, fee: 'unavailable' },
        { when: 'any', fee: 20_000 },
      ],
    };
    expect(quoteDelivery([blocked], { communeCode: 'XT01003', subtotal: 50_000 })).toMatchObject({
      available: false,
      reason: 'unavailable',
      zoneCode: 'blocked',
    });
    expect(quoteDelivery([blocked], { communeCode: 'XT01003', subtotal: 100_000 })).toMatchObject({
      available: true,
      fee: 20_000,
    });
  });
});
