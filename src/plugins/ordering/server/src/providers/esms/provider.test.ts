import { describe, expect, it } from 'vitest';

import { OrderingError } from '../../domain/errors';
import type { ProviderHttpClient, ProviderResponse } from '../_http';
import { createEsmsNotificationProvider } from './provider';
import type { EsmsSettings } from './config';

const settings = (overrides: Partial<EsmsSettings> = {}): EsmsSettings => ({
  enabled: true,
  apiKey: 'key-1',
  secretKey: 'secret-1',
  brandname: 'SALANCA',
  smsType: '2',
  isUnicode: true,
  sandbox: false,
  baseUrl: 'https://rest.esms.vn',
  ...overrides,
});

type Call = { path: string; body?: Record<string, unknown>; headers?: Record<string, string> };

const fakeClient = (script: ProviderResponse[]) => {
  const calls: Call[] = [];
  const client: ProviderHttpClient = {
    postJson: async (path, body, headers) => {
      calls.push({ path, body: body as Record<string, unknown>, headers });
      return script.shift() ?? { status: 500, body: null };
    },
    postForm: async () => ({ status: 500, body: null }),
    deleteJson: async () => ({ status: 500, body: null }),
  };
  return { client, calls };
};

const input = {
  recipient: { phone: '+84901234567' },
  template: 'customer.order-ready',
  data: { smsText: 'Don hang ORD-1 san sang', trackingId: 'nd-11' },
};

describe('esms provider', () => {
  it('posts SendMultipleMessage_V4 and returns SMSID as providerMessageId', async () => {
    const { client, calls } = fakeClient([
      { status: 200, body: { CodeResult: '100', SMSID: 'sms-77', CountRefund: 0 } },
    ]);
    const provider = createEsmsNotificationProvider({ settings: () => settings(), client });
    const result = await provider.send(input);
    expect(result).toEqual({ providerMessageId: 'sms-77' });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/MainService.svc/json/SendMultipleMessage_V4_post_json/');
    const body = calls[0].body!;
    expect(body.ApiKey).toBe('key-1');
    expect(body.SecretKey).toBe('secret-1');
    expect(body.Phone).toBe('84901234567'); // E.164 → digits only
    expect(body.Content).toBe('Don hang ORD-1 san sang');
    expect(body.Brandname).toBe('SALANCA');
    expect(body.SmsType).toBe('2');
    expect(body.IsUnicode).toBe('1');
    expect(body.Sandbox).toBe('0');
    expect(body.RequestId).toBe('nd-11');
  });

  it('treats CodeResult 124 (duplicate RequestId) as already accepted', async () => {
    const { client } = fakeClient([{ status: 200, body: { CodeResult: '124' } }]);
    const provider = createEsmsNotificationProvider({ settings: () => settings(), client });
    await expect(provider.send(input)).resolves.toEqual({});
  });

  it('maps a rejected send to PROVIDER_UNAVAILABLE with only the code in details', async () => {
    const { client } = fakeClient([
      { status: 200, body: { CodeResult: '101', ErrorMessage: 'key-1 invalid credentials' } },
    ]);
    const provider = createEsmsNotificationProvider({ settings: () => settings(), client });
    const error = await provider.send(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OrderingError);
    expect((error as OrderingError).code).toBe('PROVIDER_UNAVAILABLE');
    const serialized = JSON.stringify((error as OrderingError).toApiError());
    expect(serialized).toContain('101');
    expect(serialized).not.toContain('key-1');
    expect(serialized).not.toContain('secret-1');
  });

  it('sends sandbox/brandname flags exactly as configured', async () => {
    const { client, calls } = fakeClient([
      { status: 200, body: { CodeResult: '100', SMSID: 'x' } },
    ]);
    const provider = createEsmsNotificationProvider({
      settings: () => settings({ smsType: '8', brandname: undefined, sandbox: true, isUnicode: false }),
      client,
    });
    await provider.send(input);
    const body = calls[0].body!;
    expect(body.SmsType).toBe('8');
    expect('Brandname' in body).toBe(false);
    expect(body.Sandbox).toBe('1');
    expect(body.IsUnicode).toBe('0');
  });

  it('rejects a send without trackingId before any HTTP call', async () => {
    const { client, calls } = fakeClient([]);
    const provider = createEsmsNotificationProvider({ settings: () => settings(), client });
    await expect(
      provider.send({ ...input, data: { smsText: 'hi' } }),
    ).rejects.toThrow(OrderingError);
    expect(calls).toHaveLength(0);
  });
});
