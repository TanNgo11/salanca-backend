import { describe, expect, it } from 'vitest';

import { createSepayTransactionClient } from './client';

const TOKEN = 'test-api-token-value-xx';
const IN_ROW = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  transaction_date: '2026-10-11 10:00:00',
  account_number: '0123456789',
  va: null,
  transfer_type: 'in',
  amount_in: 195000,
  amount_out: 0,
  transaction_content: 'SLCSLC-000001',
  reference_number: 'FTREC8001',
  bank_brand_name: 'MBBank',
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe('SePay transaction client', () => {
  it('retries 429, spaces calls, and maps an in row without leaking the token', async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const urls: string[] = [];
    const auths: string[] = [];
    const responses = [
      json('', 429, { 'retry-after': '1' }),
      json({ status: 'success', data: [IN_ROW] }),
      json({ status: 'success', data: [] }),
    ];
    let call = 0;
    const client = createSepayTransactionClient({
      apiBaseUrl: () => 'https://userapi.sepay.vn/',
      apiToken: () => TOKEN,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      fetchImpl: async (url, init) => {
        call += 1;
        urls.push(url);
        auths.push(init.headers.Authorization);
        const response = responses[call - 1];
        if (!response) throw new Error('unexpected call');
        return response;
      },
    });

    const first = await client.listPage({});
    const second = await client.listPage({ sinceId: 'cursor-1' });

    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]?.event?.providerTransactionId).toBe(IN_ROW.id);
    expect(first.rows[0]?.event?.amount.amount).toBe(195000);
    expect(first.rows[0]?.event?.reference).toBe('FTREC8001');
    expect(first.rows[0]?.event?.metadata?.content).toBe('SLCSLC-000001');
    expect(second.rows).toEqual([]);
    expect(sleeps).toEqual([1000, 334]);
    expect(urls[0]).toBe('https://userapi.sepay.vn/v2/transactions?per_page=100');
    expect(urls[2]).toContain('since_id=cursor-1');
    expect(auths.every((header) => header === `Bearer ${TOKEN}`)).toBe(true);
    expect(urls.join(' ')).not.toContain(TOKEN);
  });

  it('caps per_page at 100 and maps an out row from amount_out', async () => {
    let url = '';
    const client = createSepayTransactionClient({
      apiBaseUrl: () => 'https://userapi.sepay.vn',
      apiToken: () => TOKEN,
      now: () => 0,
      sleep: async () => {},
      fetchImpl: async (requested) => {
        url = requested;
        return json({
          status: 'success',
          data: [{ id: 'out-1', transfer_type: 'out', amount_in: 5, amount_out: 9000, account_number: '0123456789' }],
        });
      },
    });
    const page = await client.listPage({ perPage: 500 });
    expect(url).toContain('per_page=100');
    expect(page.rows[0]?.event?.transferType).toBe('out');
    expect(page.rows[0]?.event?.amount.amount).toBe(9000);
  });

  it('fails closed without the response body or the token', async () => {
    const client = createSepayTransactionClient({
      apiBaseUrl: () => 'https://userapi.sepay.vn',
      apiToken: () => TOKEN,
      now: () => 0,
      sleep: async () => {},
      maxRetries: 0,
      fetchImpl: async () => json(`leak ${TOKEN} 0123456789`, 500),
    });
    await expect(client.listPage({})).rejects.toThrow('sepay transactions request failed (500)');
  });

  it('does not call the network when the token is missing', async () => {
    let called = false;
    const client = createSepayTransactionClient({
      apiBaseUrl: () => 'https://userapi.sepay.vn',
      apiToken: () => '',
      fetchImpl: async () => {
        called = true;
        return json({});
      },
    });
    await expect(client.listPage({})).rejects.toThrow('sepay api token is not configured');
    expect(called).toBe(false);
  });

  it('rejects a payload that is not a transaction list', async () => {
    const client = createSepayTransactionClient({
      apiBaseUrl: () => 'https://userapi.sepay.vn',
      apiToken: () => TOKEN,
      now: () => 0,
      sleep: async () => {},
      fetchImpl: async () => json({ status: 'error', data: null }),
    });
    await expect(client.listPage({})).rejects.toThrow('sepay transactions request failed (bad-response)');
  });
});
