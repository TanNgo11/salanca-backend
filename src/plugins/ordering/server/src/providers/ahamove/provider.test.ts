import { describe, expect, it } from 'vitest';

import { OrderingError } from '../../domain/errors';
import type { ProviderHttpClient, ProviderResponse } from '../_http';
import { createAhamoveProvider } from './provider';
import type { AhamoveSettings } from './config';

const settings = (overrides: Partial<AhamoveSettings> = {}): AhamoveSettings => ({
  enabled: true,
  apiKey: 'test-api-key',
  mobile: '0901234567',
  webhookToken: 'webhook-token-0123456789',
  environment: 'staging',
  serviceId: 'SGN-BIKE',
  paymentMethod: 'CASH',
  requests: [],
  feeSource: 'zone',
  ...overrides,
});

/** A queued fake client: each call pops the next scripted response (or asserts on the path). */
const fakeClient = (script: Array<{ path: RegExp; response: ProviderResponse }>) => {
  const calls: Array<{ method: 'postJson' | 'postForm' | 'deleteJson'; path: string; headers?: Record<string, string> }> = [];
  const client: ProviderHttpClient = {
    postJson: async (path, _body, headers) => {
      calls.push({ method: 'postJson', path, headers });
      const step = script.find((item) => item.path.test(path));
      return step?.response ?? { status: 500, body: null };
    },
    postForm: async (path, _fields, headers) => {
      calls.push({ method: 'postForm', path, headers });
      const step = script.find((item) => item.path.test(path));
      return step?.response ?? { status: 500, body: null };
    },
    deleteJson: async (path, _body, headers) => {
      calls.push({ method: 'deleteJson', path, headers });
      const step = script.find((item) => item.path.test(path));
      return step?.response ?? { status: 500, body: null };
    },
  };
  return { client, calls };
};

const zoneDeps = { zonesFor: async () => [] };

const webhookOf = (apikey: string, body: unknown) => ({
  headers: { apikey },
  body: JSON.stringify(body),
  receivedAt: '2026-01-01T00:00:00.000Z',
});

describe('ahamove provider', () => {
  it('authenticates lazily and caches the token between calls', async () => {
    const { client, calls } = fakeClient([
      { path: /accounts\/token/, response: { status: 200, body: { token: 'tok-1' } } },
      {
        path: /orders\/estimates/,
        response: { status: 200, body: { data: [{ total_fee: 41000 }] } },
      },
      {
        path: /v3\/orders$/,
        response: { status: 200, body: { order_id: 'AHM123', status: 'IDLE', total_fee: 41000, shared_link: 'https://x/t' } },
      },
    ]);
    const provider = createAhamoveProvider({ settings, client, ...zoneDeps });
    const pickup = { address: '1 Shop St', lat: 0, lng: 0, name: 'Shop', phone: '0900000000' };
    const dropoff = { address: '9 Home Ave', lat: 0, lng: 0, phone: '0911111111' };

    const quotes = await provider.quoteCarrier!({ pickup, dropoff, codAmount: 50000 });
    expect(quotes).toEqual([
      { providerCode: 'ahamove', serviceId: 'SGN-BIKE', fee: { amount: 41000, currency: 'VND' } },
    ]);
    const booking = await provider.book!({ pickup, dropoff, codAmount: 50000, remarks: 'ORD-1' });
    expect(booking.carrierRef).toBe('AHM123');
    expect(booking.trackingUrl).toBe('https://x/t');
    expect(booking.carrierFee).toBe(41000);
    // One token call for both requests — the bearer is cached in memory.
    expect(calls.filter((call) => /accounts\/token/.test(call.path))).toHaveLength(1);
    expect(calls[1].headers?.Authorization).toBe('Bearer tok-1');
  });

  it('re-authenticates once when the bearer token is rejected (401)', async () => {
    let estimates = 0;
    const { client, calls } = fakeClient([
      { path: /accounts\/token/, response: { status: 200, body: { token: 'tok-2' } } },
    ]);
    // Scripted per-path is not enough — override estimates to fail then pass.
    const realPost = client.postJson;
    client.postJson = async (path, body, headers) => {
      if (/orders\/estimates/.test(path)) {
        estimates += 1;
        return estimates === 1 ? { status: 401, body: null } : { status: 200, body: { data: [{ total_fee: 1000 }] } };
      }
      return realPost(path, body, headers);
    };
    const provider = createAhamoveProvider({ settings, client, ...zoneDeps });
    const quotes = await provider.quoteCarrier!({
      pickup: { address: 'A', lat: 0, lng: 0 },
      dropoff: { address: 'B', lat: 0, lng: 0 },
      codAmount: 0,
    });
    expect(quotes[0].fee.amount).toBe(1000);
    expect(estimates).toBe(2);
    expect(calls.filter((call) => /accounts\/token/.test(call.path))).toHaveLength(2);
  });

  it('uses the configured token without a token call', async () => {
    const { client, calls } = fakeClient([
      {
        path: /orders\/estimates/,
        response: { status: 200, body: { data: [{ total_fee: 1000 }] } },
      },
    ]);
    const provider = createAhamoveProvider({
      settings: () => settings({ token: 'fixed-token', mobile: undefined }),
      client,
      ...zoneDeps,
    });
    await provider.quoteCarrier!({
      pickup: { address: 'A', lat: 0, lng: 0 },
      dropoff: { address: 'B', lat: 0, lng: 0 },
      codAmount: 0,
    });
    expect(calls.filter((call) => /accounts\/token/.test(call.path))).toHaveLength(0);
    expect(calls[0].headers?.Authorization).toBe('Bearer fixed-token');
  });

  it('maps booking HTTP failures to CARRIER_BOOKING_FAILED with a safe reason', async () => {
    const { client } = fakeClient([
      { path: /accounts\/token/, response: { status: 200, body: { token: 'tok' } } },
      { path: /v3\/orders$/, response: { status: 422, body: { code: 'INSUFFICIENT_BALANCE', message: 'acct ... secrets' } } },
    ]);
    const provider = createAhamoveProvider({ settings, client, ...zoneDeps });
    const error = await provider
      .book!({ pickup: { address: 'A', lat: 0, lng: 0 }, dropoff: { address: 'B', lat: 0, lng: 0 }, codAmount: 0 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OrderingError);
    expect((error as OrderingError).code).toBe('CARRIER_BOOKING_FAILED');
    expect((error as OrderingError).details?.reason).toBe('INSUFFICIENT_BALANCE');
    expect(JSON.stringify((error as OrderingError).details)).not.toContain('secrets');
  });

  it('cancel posts DELETE /v3/orders/{id} and rejects an underway trip', async () => {
    const { client, calls } = fakeClient([
      { path: /accounts\/token/, response: { status: 200, body: { token: 'tok' } } },
      { path: /v3\/orders\/AHM9/, response: { status: 200, body: { success: true } } },
    ]);
    const provider = createAhamoveProvider({ settings, client, ...zoneDeps });
    const leg = { providerReference: 'AHM9', carrierStatus: 'ASSIGNING' };
    await provider.cancel!({ fulfillment: leg as never, reason: 'staff-cancelled' });
    expect(calls.some((call) => call.method === 'deleteJson' && call.path === '/v3/orders/AHM9')).toBe(true);

    const underway = { providerReference: 'AHM9', carrierStatus: 'IN PROCESS' };
    await expect(provider.cancel!({ fulfillment: underway as never, reason: 'x' })).rejects.toThrow(
      OrderingError,
    );
  });

  it('parses a signed webhook; a wrong apikey is 401, a bad body is 400', async () => {
    const provider = createAhamoveProvider({ settings, client: fakeClient([]).client, ...zoneDeps });
    const events = await provider.parseCarrierWebhook!(
      webhookOf('webhook-token-0123456789', {
        _id: 'AHM77',
        status: 'IN PROCESS',
        path: [{}, { tracking_link: 'https://x/track' }],
        supplier: { name: 'Tai', mobile: '0909123456' },
      }),
    );
    expect(events).toEqual([
      {
        carrierRef: 'AHM77',
        status: 'in-process',
        carrierStatus: 'IN PROCESS',
        driver: { name: 'Tai', phoneMasked: '***3456' },
        trackingUrl: 'https://x/track',
      },
    ]);

    await expect(
      provider.parseCarrierWebhook!(webhookOf('wrong-token-0000000000', { _id: 'X', status: 'IDLE' })),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
    await expect(provider.parseCarrierWebhook!(webhookOf('webhook-token-0123456789', 'junk'))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      provider.parseCarrierWebhook!(webhookOf('webhook-token-0123456789', { status: 'IDLE' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('ACKs a valid-but-unknown status with no events so the carrier stops retrying', async () => {
    const provider = createAhamoveProvider({ settings, client: fakeClient([]).client, ...zoneDeps });
    await expect(
      provider.parseCarrierWebhook!(webhookOf('webhook-token-0123456789', { _id: 'AHM1', status: 'WHATEVER_NEW' })),
    ).resolves.toEqual([]);
    expect(provider.carrierWebhookResponse!({ result: 'accepted' })).toEqual({
      status: 200,
      body: { success: true },
    });
    expect(provider.carrierWebhookResponse!({ result: 'invalid-signature' })).toEqual({ status: 401 });
    expect(provider.carrierWebhookResponse!({ result: 'invalid-payload' })).toEqual({ status: 400 });
  });

  it('maps IDLE/ASSIGNING → searching, ACCEPTED → booked, CANCELLED/FAILED through', async () => {
    const provider = createAhamoveProvider({ settings, client: fakeClient([]).client, ...zoneDeps });
    for (const [raw, mapped] of [
      ['IDLE', 'searching'],
      ['ASSIGNING', 'searching'],
      ['ACCEPTED', 'booked'],
      ['COMPLETED', 'delivered'],
      ['CANCELLED', 'cancelled'],
      ['FAILED', 'failed'],
    ] as const) {
      const [event] = await provider.parseCarrierWebhook!(
        webhookOf('webhook-token-0123456789', { _id: 'AHM2', status: raw }),
      );
      expect(event.status).toBe(mapped);
      expect(event.carrierStatus).toBe(raw);
    }
  });
});
