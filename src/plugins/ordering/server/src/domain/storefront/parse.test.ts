import { describe, expect, it } from 'vitest';

import { parseCartRequest, parseIdempotencyKey, parseOrderRequest } from './parse';

const cart = {
  branch: 'Q1',
  lines: [{ sellableUid: 'bun-bo', quantity: 2, unitAmount: 1 }],
  receiveMethod: { kind: 'pickup', slot: { startsAt: '2026-10-12T05:00:00.000Z' } },
  totals: { grandTotal: 1 },
  adjustments: [{ amount: -1000 }],
};

describe('parseCartRequest', () => {
  it('keeps only allowlisted fields and never client amounts', () => {
    const parsed = parseCartRequest(cart);
    expect(parsed).toEqual({
      locationRef: 'Q1',
      locale: undefined,
      lines: [{ sellableUid: 'bun-bo', quantity: 2, selected: [], note: undefined }],
      receiveMethod: { kind: 'pickup', locationRef: 'Q1' },
      pickup: { slot: { startsAt: '2026-10-12T05:00:00.000Z' } },
    });
    expect(JSON.stringify(parsed)).not.toContain('unitAmount');
    const delivery = parseCartRequest({
      ...cart,
      receiveMethod: {
        kind: 'delivery',
        address: {
          communeCode: 'xt01002',
          line1: '12 đường thử',
          recipientName: 'Lan',
          phone: '0901234567',
          wardName: 'HACKED',
          provinceName: 'HACKED',
        },
      },
    });
    expect(delivery.receiveMethod).toEqual({
      kind: 'delivery',
      providerCode: 'self-delivery',
      address: {
        recipientName: 'Lan',
        phone: '0901234567',
        line1: '12 đường thử',
        wardCode: 'XT01002',
      },
    });
    expect(JSON.stringify(delivery)).not.toContain('HACKED');
    expect(JSON.stringify(parsed)).not.toContain('adjustments');
  });

  it('defaults to ASAP and rejects bad lines and non-pickup', () => {
    expect(parseCartRequest({ ...cart, receiveMethod: { kind: 'pickup' } }).pickup).toEqual({ asap: true });
    expect(() => parseCartRequest({ ...cart, lines: [] })).toThrow(/at least one line/);
    expect(() => parseCartRequest({ ...cart, lines: [{ sellableUid: 'x', quantity: 0 }] })).toThrow(
      /quantity/,
    );
    expect(() => parseCartRequest({ ...cart, receiveMethod: { kind: 'delivery' } })).toThrow(/communeCode/);
    expect(() => parseCartRequest({ ...cart, receiveMethod: { kind: 'ship' } })).toThrow(/not available/);
    expect(() => parseCartRequest('nope')).toThrow(/JSON object/);
  });
});

describe('parseOrderRequest', () => {
  const order = {
    ...cart,
    contact: { name: ' Lan ', phone: '0901234567', email: 'lan@example.com' },
    consent: { policyVersion: 'v1', accepted: true, marketingOptIn: true },
  };

  it('requires accepted consent and a phone, validates email', () => {
    expect(parseOrderRequest(order)).toMatchObject({
      contact: { name: 'Lan', phone: '0901234567', email: 'lan@example.com' },
      consent: { policyVersion: 'v1', marketingOptIn: true },
    });
    expect(() => parseOrderRequest({ ...order, consent: { policyVersion: 'v1' } })).toThrow(/consent/);
    expect(() => parseOrderRequest({ ...order, contact: {} })).toThrow(/contact.phone/);
    expect(() => parseOrderRequest({ ...order, contact: { phone: '0901234567', email: 'x' } })).toThrow(
      /email/,
    );
    expect(() => parseOrderRequest({ ...order, customerNote: 'x'.repeat(501) })).toThrow(/too long/);
  });
});

describe('parseIdempotencyKey', () => {
  it('accepts 8–128 safe characters', () => {
    expect(parseIdempotencyKey('order-12345678')).toBe('order-12345678');
    expect(() => parseIdempotencyKey('short')).toThrow();
    expect(() => parseIdempotencyKey('has space 123')).toThrow();
    expect(() => parseIdempotencyKey(undefined)).toThrow();
  });
});
