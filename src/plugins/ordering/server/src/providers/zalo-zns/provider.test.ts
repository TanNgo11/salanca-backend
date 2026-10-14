import { describe, expect, it } from 'vitest';

import { OrderingError } from '../../domain/errors';
import type { ProviderHttpClient, ProviderResponse } from '../_http';
import { createZaloNotificationProvider } from './provider';
import type { ZaloSettings } from './config';

const settings = (overrides: Partial<ZaloSettings> = {}): ZaloSettings => ({
  enabled: true,
  baseUrl: 'https://business.openapi.zalo.me',
  oauthUrl: 'https://oauth.zaloapp.com/v4/oa/access_token',
  ...overrides,
});

type Call = {
  method: string;
  path: string;
  body?: unknown;
  fields?: Record<string, string>;
  headers?: Record<string, string>;
};

/** Queued fake client: records calls and pops the scripted responses in order. */
const fakeClient = (script: ProviderResponse[]) => {
  const calls: Call[] = [];
  const client: ProviderHttpClient = {
    postJson: async (path, body, headers) => {
      calls.push({ method: 'postJson', path, body, headers });
      return script.shift() ?? { status: 500, body: null };
    },
    postForm: async (path, fields, headers) => {
      calls.push({ method: 'postForm', path, fields, headers });
      return script.shift() ?? { status: 500, body: null };
    },
    deleteJson: async (path, body, headers) => {
      calls.push({ method: 'deleteJson', path, body, headers });
      return script.shift() ?? { status: 500, body: null };
    },
  };
  return { client, calls };
};

const input = {
  recipient: { phone: '+84901234567' },
  template: 'customer.order-ready',
  data: {
    znsTemplateId: 'zns-42',
    znsParams: { order_code: 'ORD-1', customer_name: 'A' },
    trackingId: 'nd-7',
  },
};

describe('zalo-zns provider', () => {
  it('sends the template with the static access token and returns msg_id', async () => {
    const { client, calls } = fakeClient([
      { status: 200, body: { error: 0, message: 'Success', data: { msg_id: 'msg-1' } } },
    ]);
    const provider = createZaloNotificationProvider({
      settings: () => settings({ accessToken: 'tok-static' }),
      client,
    });
    const result = await provider.send(input);
    expect(result).toEqual({ providerMessageId: 'msg-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/message/template');
    expect(calls[0].headers?.access_token).toBe('tok-static');
    const body = calls[0].body as Record<string, unknown>;
    expect(body.phone).toBe('84901234567'); // E.164 → digits only
    expect(body.template_id).toBe('zns-42');
    expect(body.template_data).toEqual({ order_code: 'ORD-1', customer_name: 'A' });
    expect(body.tracking_id).toBe('nd-7');
  });

  it('refreshes the OAuth token once on -124 and retries the send', async () => {
    // Call order: refresh (token bootstrap) → send → -124 → forced refresh → send.
    const { client, calls } = fakeClient([
      { status: 200, body: { access_token: 'tok-1', expires_in: 3600 } },
      { status: 200, body: { error: -124, message: 'token expired' } },
      { status: 200, body: { access_token: 'tok-new', expires_in: 3600 } },
      { status: 200, body: { error: 0, data: { msg_id: 'msg-2' } } },
    ]);
    // OAuth refresh goes through a second client on oauthUrl — inject the same fake for both
    // (script order is the assertion).
    const provider = createZaloNotificationProvider({
      settings: () =>
        settings({ appId: 'app', appSecret: 'secret', refreshToken: 'refresh' }),
      client,
      oauthClient: client,
    });
    const result = await provider.send(input);
    expect(result).toEqual({ providerMessageId: 'msg-2' });
    const [refresh1, send1, , send2] = calls;
    expect(refresh1.method).toBe('postForm');
    expect(refresh1.fields?.grant_type).toBe('refresh_token');
    expect(refresh1.fields?.refresh_token).toBe('refresh');
    expect(refresh1.headers?.secret_key).toBe('secret');
    expect(send1.path).toBe('/message/template');
    expect(send1.headers?.access_token).toBe('tok-1');
    expect(send2.headers?.access_token).toBe('tok-new');
  });

  it('fails closed when -124 persists after the refresh', async () => {
    const { client } = fakeClient([
      { status: 200, body: { access_token: 'tok-1', expires_in: 3600 } },
      { status: 200, body: { error: -124 } },
      { status: 200, body: { access_token: 'tok-new', expires_in: 3600 } },
      { status: 200, body: { error: -124 } },
    ]);
    const provider = createZaloNotificationProvider({
      settings: () => settings({ appId: 'a', appSecret: 's', refreshToken: 'r' }),
      client,
      oauthClient: client,
    });
    await expect(provider.send(input)).rejects.toThrow(OrderingError);
  });

  it('maps a non-zero error to PROVIDER_UNAVAILABLE with only the code in details', async () => {
    const { client } = fakeClient([
      { status: 200, body: { error: -109, message: 'template id: zns-42 invalid' } },
    ]);
    const provider = createZaloNotificationProvider({
      settings: () => settings({ accessToken: 'tok' }),
      client,
    });
    const error = await provider.send(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OrderingError);
    expect((error as OrderingError).code).toBe('PROVIDER_UNAVAILABLE');
    const serialized = JSON.stringify((error as OrderingError).toApiError());
    expect(serialized).toContain('-109');
    expect(serialized).not.toContain('zns-42');
  });

  it('rejects a send without znsTemplateId before any HTTP call', async () => {
    const { client, calls } = fakeClient([]);
    const provider = createZaloNotificationProvider({
      settings: () => settings({ accessToken: 'tok' }),
      client,
    });
    await expect(
      provider.send({ ...input, data: { trackingId: 'nd-1' } }),
    ).rejects.toThrow(OrderingError);
    expect(calls).toHaveLength(0);
  });
});
