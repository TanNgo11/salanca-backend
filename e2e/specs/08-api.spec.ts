import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '../helpers/fixtures';
import { todayVN } from '../helpers/env';

test.describe('API-level checks', () => {
  test('every GET in docs/ordering-admin-openapi.json returns no 5xx', async ({ api }) => {
    const doc = JSON.parse(readFileSync(path.resolve(__dirname, '../../docs/ordering-admin-openapi.json'), 'utf8'));
    const ids: Record<string, string> = { code: 'Q1', template: 'order-placed', locale: 'vi' };
    const params = `branch=Q1&from=${todayVN()}&to=${todayVN()}&businessDate=${todayVN()}`;
    const bad: string[] = [];
    for (const [p, v] of Object.entries<any>(doc.paths)) {
      if (!v.get || /stream/.test(p)) continue;
      const url = `${p.replace(/\{(\w+)\}/g, (_, k) => ids[k] ?? '1')}?${params}`;
      const r = await api.get(url);
      if (r.status >= 500) bad.push(`${r.status} ${url}`);
    }
    expect(bad).toEqual([]);
  });
  test('public openapi.json is served', async ({ pub }) => {
    expect((await pub.call('GET', '/openapi.json')).status).toBe(200);
  });
  test('public storefront basics: branches, config, slots, quote', async ({ pub, orders }) => {
    expect((await pub.call('GET', '/branches')).status).toBe(200);
    const cfg = await pub.call('GET', '/config?branch=Q1'); expect(cfg.status).toBe(200);
    const p = await orders.product();
    const q = await pub.call('POST', '/quote', { branch: 'Q1', locale: 'vi', lines: [{ sellableUid: p.id, quantity: 1 }], receiveMethod: { kind: 'pickup', asap: true } });
    expect([200, 400, 409]).toContain(q.status);
  });
  test('delivery quote with full address', async ({ pub, orders }) => {
    const p = await orders.product();
    const q = await pub.call('POST', '/quote', { branch: 'Q1', locale: 'vi', lines: [{ sellableUid: p.id, quantity: 3 }], receiveMethod: { kind: 'delivery', address: { communeCode: 'XT01002', line1: '12 Test', recipientName: 'E2E', phone: '0901234567' } }, payment: { providerCode: 'cash' } });
    test.skip(q.body?.error?.details?.reason === 'unknown-commune', 'commune catalog only exists in ORDERING_TEST_BUILTINS mode (admin-units catalog missing in dev)');
    expect(q.status, JSON.stringify(q.body)).toBe(200);
  });
  test('idempotency: same key replays the same order', async ({ pub, orders }) => {
    const p = await orders.product(); const cfg = (await pub.call('GET', '/config?branch=Q1')).body;
    const cart = { branch: 'Q1', locale: 'vi', lines: [{ sellableUid: p.id, quantity: 1 }], receiveMethod: { kind: 'pickup', asap: true } };
    const q = await pub.call('POST', '/quote', cart); test.skip(q.status !== 200, 'ASAP not open');
    const body = { ...cart, contact: { name: 'Idem', phone: `0907${String(Date.now()).slice(-6)}` }, consent: { policyVersion: cfg.consentPolicyVersion, accepted: true }, expectedCartHash: q.body.cartHash, captchaToken: 'pass' };
    const key = `idem-${Date.now()}`;
    const a = await pub.call('POST', '/orders', body, { 'Idempotency-Key': key });
    const b = await pub.call('POST', '/orders', body, { 'Idempotency-Key': key });
    expect(a.body.order?.code).toBeTruthy(); expect(b.body.order?.code).toBe(a.body.order?.code);
  });
});
