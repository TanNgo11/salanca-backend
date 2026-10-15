import { describe, expect, it } from 'vitest';

import {
  PING_EVENT_TYPE,
  PUBLIC_EVENTS,
  PUBLIC_EVENT_TYPES,
  WEBHOOK_API_VERSION,
  publicEventData,
  publicPayload,
} from './events';

/** Keys a default payload must never contain (PII + staff/internal fields). */
const FORBIDDEN = [
  'name',
  'phone',
  'email',
  'address',
  'contact',
  'customer',
  'actorRef',
  'isPublic',
  'notifyCustomer',
  'rawPayload',
];

const occurrences = (value: unknown, key: string): number => {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + occurrences(item, key), 0);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce(
      (sum, [k, v]) => sum + (k === key ? 1 : 0) + occurrences(v, key),
      0,
    );
  }
  return 0;
};

describe('public event catalog', () => {
  it('covers every emitted outbox event type', () => {
    expect(PUBLIC_EVENT_TYPES).toEqual([
      'order.created',
      'order.transitioned',
      'order.line.canceled',
      'fulfillment-group.transitioned',
      'payment.initiated',
      'payment.captured',
      'payment.event.received',
      'refund.settled',
      'ops-alert.opened',
      'ops-alert.escalated',
      'gift-card.issued',
      'promotion.redeemed',
      'rating.created',
      'customer.erased',
      'loyalty.points.earned',
      'loyalty.tier.changed',
    ]);
  });

  it('declares a vi/en description, group, allowlist and sample for every type', () => {
    for (const spec of PUBLIC_EVENTS) {
      expect(spec.description.vi.length).toBeGreaterThan(0);
      expect(spec.description.en.length).toBeGreaterThan(0);
      expect(spec.fields.length).toBeGreaterThan(0);
      expect(Object.keys(spec.sample).length).toBeGreaterThan(0);
      for (const key of Object.keys(spec.sample)) {
        expect(spec.fields, `${spec.type} sample key ${key}`).toContain(key);
      }
    }
  });

  it('does not include the synthetic ping type', () => {
    expect(PUBLIC_EVENT_TYPES).not.toContain(PING_EVENT_TYPE);
  });
});

describe('publicEventData', () => {
  it('keeps only allowlisted keys for order.created', () => {
    const data = publicEventData({
      type: 'order.created',
      payload: {
        orderId: 7,
        code: 'SLC-1',
        status: 'open',
        totalAmount: 1000,
        currency: 'VND',
        locationRef: 'Q1',
        contactSnapshot: { name: 'Lan', phone: '0901234567' },
        actorRef: 'admin:3',
      },
    });
    expect(data).toEqual({
      orderId: 7,
      code: 'SLC-1',
      status: 'open',
      totalAmount: 1000,
      currency: 'VND',
      locationRef: 'Q1',
    });
  });

  it.each([
    ['order.transitioned', { orderId: 7, from: 'open', to: 'completed', locationRef: 'Q1', actorRef: 'admin:3' }],
    ['order.line.canceled', { orderId: 7, lineId: 2, quantity: 1, amount: 500, actorRef: 'admin:3' }],
    [
      'fulfillment-group.transitioned',
      {
        orderId: 7,
        groupId: 9,
        from: 'placed',
        to: 'ready',
        workflowName: 'kitchen',
        workflowVersion: 1,
        locationRef: 'Q1',
        delayed: true,
        reasonCode: 'busy',
        actorRef: 'admin:3',
        isPublic: true,
        notifyCustomer: true,
      },
    ],
    ['payment.initiated', { orderId: 7, paymentId: 3, providerCode: 'sepay', amount: 100, providerReference: 'R1' }],
    ['payment.captured', { orderId: 7, paymentId: 3, capturedAmount: 100, providerReference: 'R1' }],
    [
      'payment.event.received',
      {
        paymentEventId: 5,
        providerCode: 'sepay',
        providerTransactionId: 'FT1',
        kind: 'bank-transfer',
        amount: 100,
        transferType: 'in',
        rawPayload: { account: 'secret' },
      },
    ],
    ['refund.settled', { orderId: 7, paymentId: 3, refundId: 4, amount: 50, actorRef: 'admin:3' }],
    [
      'ops-alert.opened',
      { alertId: 1, alertCode: 'webhook-failing', aggregateRef: 'endpoint:2', locationRef: 'Q1', severity: 'warning', count: 2 },
    ],
    [
      'ops-alert.escalated',
      { alertId: 1, alertCode: 'webhook-failing', aggregateRef: 'endpoint:2', locationRef: 'Q1', severity: 'critical', count: 9 },
    ],
    [
      'promotion.redeemed',
      {
        orderId: 7,
        orderCode: 'SLC-1',
        promotionId: 3,
        code: 'KHAITRUONG',
        discountAmount: 25000,
        locationRef: 'Q1',
        phone: '0901234567',
        customerKey: 'abc',
      },
    ],
    [
      'rating.created',
      {
        orderId: 7,
        orderCode: 'SLC-1',
        ratingId: 5,
        stars: 4,
        tags: ['tasty'],
        locationRef: 'Q1',
        comment: 'Gọi 0901234567 giúp mình',
        email: 'lan@example.invalid',
      },
    ],
  ])('%s drops staff/internal fields', (type, payload) => {
    const data = publicEventData({ type, payload });
    expect(data).not.toBeNull();
    for (const key of FORBIDDEN) {
      expect(occurrences(data, key), `${type} leaked ${key}`).toBe(0);
    }
  });

  it('never carries the rating comment, even if the payload grows one', () => {
    const data = publicEventData({
      type: 'rating.created',
      payload: { orderId: 7, ratingId: 5, stars: 2, tags: [], comment: 'số điện thoại 0901234567' },
    });
    expect(data).toEqual({ orderId: 7, ratingId: 5, stars: 2, tags: [] });
    expect(JSON.stringify(data)).not.toContain('0901234567');
  });

  it('keeps the entered promotion code and the amount for promotion.redeemed', () => {
    expect(
      publicEventData({
        type: 'promotion.redeemed',
        payload: { orderId: 7, orderCode: 'SLC-1', promotionId: 3, code: null, discountAmount: 9000, locationRef: 'Q1' },
      }),
    ).toEqual({ orderId: 7, orderCode: 'SLC-1', promotionId: 3, code: null, discountAmount: 9000, locationRef: 'Q1' });
  });

  it('returns null for internal event types', () => {
    expect(publicEventData({ type: 'internal.thing', payload: { a: 1 } })).toBeNull();
    expect(publicEventData({ type: PING_EVENT_TYPE, payload: {} })).toBeNull();
  });

  it('attaches customer only when includeCustomer and a snapshot is given', () => {
    const event = {
      type: 'order.created',
      payload: { orderId: 7, code: 'SLC-1', status: 'open', totalAmount: 100, currency: 'VND', locationRef: 'Q1' },
    };
    expect(publicEventData(event, { includeCustomer: true })).not.toHaveProperty('customer');
    const data = publicEventData(event, {
      includeCustomer: true,
      customer: { name: 'Lan', phone: '0901234567', email: 'lan@example.invalid', address: { line1: '1 X' } },
    });
    expect(data?.customer).toEqual({
      name: 'Lan',
      phone: '0901234567',
      email: 'lan@example.invalid',
      address: { line1: '1 X' },
    });
  });

  it('never attaches customer when includeCustomer is off', () => {
    const data = publicEventData(
      { type: 'order.transitioned', payload: { orderId: 7, from: 'a', to: 'b' } },
      { customer: { name: 'Lan', phone: '0901234567' } },
    );
    expect(data).not.toHaveProperty('customer');
  });

  it('ignores customer on events that are not order-scoped', () => {
    const data = publicEventData(
      { type: 'payment.event.received', payload: { paymentEventId: 5, amount: 1 } },
      { includeCustomer: true, customer: { name: 'Lan' } },
    );
    expect(data).not.toHaveProperty('customer');
  });
});

describe('publicPayload', () => {
  it('builds the signed envelope with the delivery id and API version', () => {
    const body = publicPayload('dlv_123', {
      type: 'order.created',
      occurredAt: '2026-10-12T08:00:00.000Z',
      payload: { orderId: 7, code: 'SLC-1', status: 'open', totalAmount: 100, currency: 'VND', locationRef: 'Q1' },
    });
    expect(body).toEqual({
      id: 'dlv_123',
      type: 'order.created',
      apiVersion: WEBHOOK_API_VERSION,
      occurredAt: '2026-10-12T08:00:00.000Z',
      data: { orderId: 7, code: 'SLC-1', status: 'open', totalAmount: 100, currency: 'VND', locationRef: 'Q1' },
    });
  });

  it('returns null for non-public events', () => {
    expect(publicPayload('x', { type: 'audit.recorded', occurredAt: 't', payload: {} })).toBeNull();
  });
});
