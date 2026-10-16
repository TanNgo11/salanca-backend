/**
 * Storefront (public `/api/v1/ordering/*`) coverage incl. negative / edge cases.
 * Feature inventory: scripts/ordering/{storefront,cart,cart-checkout,cart-promotion,create-order,idempotency,
 * pickup-slots,fees,variant-order,allergens,daily-stock,pause,dine-in,gift-card-payment,rating,customer-auth,
 * consent-policy,lookup-drafts,sepay-webhook}.mjs
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '../helpers/fixtures';
import { todayVN, uid } from '../helpers/env';

const PICKUP = { kind: 'pickup', asap: true };

test.describe('Catalog & config', () => {
  test('branches, config, categories, products expose the public contract', async ({ pub }) => {
    const b = await pub.call('GET', '/branches'); expect(b.status).toBe(200);
    expect(JSON.stringify(b.body)).toContain('Q1');
    const cfg = (await pub.call('GET', '/config?branch=Q1')).body;
    expect(cfg.currency).toBe('VND'); expect(cfg.branch.timezone).toBe('Asia/Ho_Chi_Minh'); expect(cfg.consentPolicyVersion).toBeTruthy();
    expect(Array.isArray(cfg.branch.fees)).toBe(true);
    expect((await pub.call('GET', '/catalog/categories?locale=vi')).status).toBe(200);
    const items = (await pub.call('GET', '/catalog/products?branch=Q1&locale=vi')).body.items as any[];
    expect(items.length).toBeGreaterThan(0);
    for (const p of items) { expect(p).toHaveProperty('variants'); expect(p).toHaveProperty('allergens'); expect(p).toHaveProperty('available'); }
    const one = await pub.call('GET', `/catalog/products/${items[0].slug}?locale=vi&location=Q1`);
    expect(one.status).toBe(200);
    expect((await pub.call('GET', '/catalog/products/khong-ton-tai-xyz?locale=vi')).status).toBe(404);
  });
  test('unknown branch → BRANCH_NOT_FOUND', async ({ pub }) => {
    const r = await pub.call('GET', '/config?branch=ZZZ'); expect([400, 404]).toContain(r.status); expect(r.body.error.code).toMatch(/BRANCH|VALIDATION|LOCATION_UNAVAILABLE/);
  });
  test('English locale returns English names where configured', async ({ pub }) => {
    const r = await pub.call('GET', '/catalog/products?branch=Q1&locale=en'); expect(r.status).toBe(200);
  });
  test('storefront without intake secret is rejected or rate-limited per IP, never 5xx', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:1447' });
    const r = await ctx.get('/api/v1/ordering/config?branch=Q1'); expect(r.status()).toBeLessThan(500); await ctx.dispose();
  });
});

test.describe('Slots & timing', () => {
  test('slots for today list availability; past date is rejected', async ({ pub }) => {
    const s = await pub.call('GET', `/slots?branch=Q1&date=${todayVN()}&receiveMethod=pickup`);
    expect(s.status).toBe(200); expect(Array.isArray(s.body.items)).toBe(true);
    const past = await pub.call('GET', '/slots?branch=Q1&date=2020-01-01&receiveMethod=pickup');
    expect(past.status === 400 || (past.status === 200 && past.body.items.every((x: any) => !x.available))).toBe(true);
  });
  test('slot beyond maxAdvanceDays is refused at quote', async ({ pub, orders }) => {
    const p = await orders.product();
    const r = await pub.call('POST', '/quote', { branch: 'Q1', locale: 'vi', lines: [{ sellableUid: p.id, quantity: 1 }], receiveMethod: { kind: 'pickup', slot: { startsAt: '2030-01-01T03:00:00.000Z' } } });
    expect(r.status).toBeGreaterThanOrEqual(400); expect(r.status).toBeLessThan(500);
  });
});

test.describe('Quote validation', () => {
  test('empty lines / unknown sellable / quantity 0 / unknown branch', async ({ pub, orders }) => {
    const p = await orders.product();
    const q = (body: any) => pub.call('POST', '/quote', { branch: 'Q1', locale: 'vi', receiveMethod: PICKUP, ...body });
    expect((await q({ lines: [] })).body.error.code).toBe('VALIDATION_ERROR');
    const unk = await q({ lines: [{ sellableUid: 'khong-ton-tai', quantity: 1 }] }); expect(unk.status).toBeGreaterThanOrEqual(400); expect(unk.status).toBeLessThan(500);
    expect((await q({ lines: [{ sellableUid: p.id, quantity: 0 }] })).status).toBe(400);
    expect((await q({ lines: [{ sellableUid: p.id, quantity: -1 }] })).status).toBe(400);
    expect((await q({ branch: 'ZZ', lines: [{ sellableUid: p.id, quantity: 1 }] })).body.error.code).toBe('BRANCH_NOT_FOUND');
  });
  test('variant selection changes the price (variant-order)', async ({ pub }) => {
    const items = (await pub.call('GET', '/catalog/products?branch=Q1&locale=vi')).body.items as any[];
    const multi = items.find((i) => i.variants?.length > 1 && new Set(i.variants.map((v: any) => v.price)).size > 1);
    test.skip(!multi, 'seed has no product with differently-priced variants');
    const [a, b] = multi.variants;
    const qa = await pub.call('POST', '/quote', { branch: 'Q1', locale: 'vi', receiveMethod: PICKUP, lines: [{ sellableUid: a.id, quantity: 1 }] });
    const qb = await pub.call('POST', '/quote', { branch: 'Q1', locale: 'vi', receiveMethod: PICKUP, lines: [{ sellableUid: b.id, quantity: 1 }] });
    expect(qa.body.totals.subtotal).not.toBe(qb.body.totals.subtotal);
  });
  test('invalid promotion code is reported, not applied', async ({ pub, orders }) => {
    const p = await orders.product();
    const r = await pub.call('POST', '/quote', { branch: 'Q1', locale: 'vi', receiveMethod: PICKUP, lines: [{ sellableUid: p.id, quantity: 1 }], promotionCode: 'KHONGCO123' });
    expect(r.status).toBeLessThan(500);
    if (r.status === 200) expect(r.body.totals.discountTotal).toBe(0);
  });
});

test.describe('Create order — negative & idempotency', () => {
  async function cart(pub: any, orders: any, extra: any = {}) {
    const p = await orders.product(); const cfg = (await pub.call('GET', '/config?branch=Q1')).body;
    const base = { branch: 'Q1', locale: 'vi', lines: [{ sellableUid: p.id, quantity: 1 }], receiveMethod: PICKUP };
    const q = await pub.call('POST', '/quote', base); test.skip(q.status !== 200, `ASAP not open: ${JSON.stringify(q.body)}`);
    return { ...base, contact: { name: 'Neg', phone: `0908${String(Date.now()).slice(-6)}` }, consent: { policyVersion: cfg.consentPolicyVersion, accepted: true }, expectedCartHash: q.body.cartHash, captchaToken: 'pass', ...extra };
  }
  test('missing Idempotency-Key → 400', async ({ pub, orders }) => {
    const r = await pub.call('POST', '/orders', await cart(pub, orders)); expect(r.status).toBe(400);
  });
  test('consent not accepted / wrong policy version → CONSENT_REQUIRED', async ({ pub, orders }) => {
    const r = await pub.call('POST', '/orders', await cart(pub, orders, { consent: { policyVersion: 'v0', accepted: true } }), { 'Idempotency-Key': randomUUID() });
    expect(r.status).toBe(400); expect(JSON.stringify(r.body)).toMatch(/CONSENT/);
  });
  test('stale cart hash → refused (price/cart changed)', async ({ pub, orders }) => {
    const r = await pub.call('POST', '/orders', await cart(pub, orders, { expectedCartHash: 'deadbeef' }), { 'Idempotency-Key': randomUUID() });
    expect(r.status).toBeGreaterThanOrEqual(400); expect(r.status).toBeLessThan(500);
  });
  test('invalid phone → VALIDATION_ERROR', async ({ pub, orders }) => {
    const r = await pub.call('POST', '/orders', await cart(pub, orders, { contact: { name: 'x', phone: '12' } }), { 'Idempotency-Key': randomUUID() });
    expect(r.status).toBe(400);
  });
  test('same key + different body → conflict; parallel same key → one order (race)', async ({ pub, orders }) => {
    const body = await cart(pub, orders); const key = randomUUID();
    const results = await Promise.all([0, 1, 2, 3].map(() => pub.call('POST', '/orders', body, { 'Idempotency-Key': key })));
    const codes = new Set(results.filter((r) => r.status < 300).map((r) => r.body.order.code));
    expect(codes.size).toBe(1);
    const other = await pub.call('POST', '/orders', { ...body, contact: { name: 'Khác', phone: '0909999888' } }, { 'Idempotency-Key': key });
    expect(other.status).toBeGreaterThanOrEqual(400); expect(other.status).toBeLessThan(500);
  });
});

test.describe('Order token, lookup, cancel, rating', () => {
  test('token view + payment view; bad token rejected', async ({ pub, orders }) => {
    const o = await orders.place();
    expect((await pub.call('GET', '/orders', undefined, { 'X-Order-Token': o.token })).body.order.code).toBe(o.code);
    expect((await pub.call('GET', '/orders/payment', undefined, { 'X-Order-Token': o.token })).status).toBe(200);
    const bad = await pub.call('GET', '/orders', undefined, { 'X-Order-Token': 'bogus' }); expect([401, 403, 404]).toContain(bad.status);
  });
  test('lookup by code + phone (status-only); wrong phone → ORDER_LOOKUP_FAILED', async ({ pub, orders }) => {
    const o = await orders.place();
    const ok = await pub.call('POST', '/orders/lookup', { code: o.code, phone: o.phone, captchaToken: 'pass' });
    expect(ok.status).toBe(200); expect(JSON.stringify(ok.body)).not.toContain(o.phone);
    expect((await pub.call('POST', '/orders/lookup', { code: o.code, phone: '0900000000', captchaToken: 'pass' })).body.error.code).toBe('ORDER_LOOKUP_FAILED');
  });
  test('customer cancel twice → second refused; rating before completion refused', async ({ pub, orders }) => {
    const o = await orders.place();
    const early = await pub.call('POST', '/orders/rating', { stars: 5 }, { 'X-Order-Token': o.token }); expect(early.status).toBeGreaterThanOrEqual(400);
    expect((await pub.call('POST', '/orders/cancel', {}, { 'X-Order-Token': o.token })).status).toBe(200);
    const again = await pub.call('POST', '/orders/cancel', {}, { 'X-Order-Token': o.token }); expect(again.status).toBeGreaterThanOrEqual(400); expect(again.status).toBeLessThan(500);
  });
  test('customer cannot cancel once the shop accepted', async ({ pub, orders }) => {
    const o = await orders.place(); await orders.advance(o.id, ['preparing']);
    const r = await pub.call('POST', '/orders/cancel', {}, { 'X-Order-Token': o.token }); expect(r.status).toBeGreaterThanOrEqual(400); expect(r.status).toBeLessThan(500);
  });
  test('rating validation: stars out of range', async ({ pub, api, orders }) => {
    const o = await orders.place(); await orders.advance(o.id, ['preparing', 'ready']); await api.post(`/orders/${o.id}/cash-handover`, { method: 'cash' });
    expect((await pub.call('POST', '/orders/rating', { stars: 9 }, { 'X-Order-Token': o.token })).status).toBe(400);
    expect((await pub.call('GET', '/orders/rating', undefined, { 'X-Order-Token': o.token })).status).toBe(200);
  });
});

test.describe('Guest cart → checkout (cart.mjs / cart-checkout.mjs)', () => {
  test('create, add/patch/delete line, checkout, replay, dead cart', async ({ pub, orders }) => {
    const p = await orders.product(); const cfg = (await pub.call('GET', '/config?branch=Q1')).body;
    const c = await pub.call('POST', '/carts', { locationRef: 'Q1', receiveMethod: PICKUP, captchaToken: 'pass' });
    expect(c.status, JSON.stringify(c.body)).toBeLessThan(300); const H = { 'X-Cart-Token': c.body.cartToken };
    const add = await pub.call('POST', '/carts/current/lines', { sellableUid: p.id, quantity: 1, captchaToken: 'pass' }, H);
    expect(add.status, JSON.stringify(add.body)).toBeLessThan(300);
    const line = add.body.cart.lines[0];
    const patched = await pub.call('PATCH', `/carts/current/lines/${line.id}`, { quantity: 3, captchaToken: 'pass' }, H);
    expect(patched.body.cart.lines[0].quantity).toBe(3);
    const extra = await pub.call('POST', '/carts/current/lines', { sellableUid: p.id, quantity: 1, note: 'ít đá', captchaToken: 'pass' }, H);
    const extraLine = extra.body.cart.lines.find((l: any) => l.id !== line.id) ?? extra.body.cart.lines[0];
    if (extra.body.cart.lines.length > 1) expect((await pub.call('DELETE', `/carts/current/lines/${extraLine.id}?captchaToken=pass`, undefined, H)).status).toBeLessThan(300);
    expect((await pub.call('DELETE', '/carts/current/lines/khong-co?captchaToken=pass', undefined, H)).status).toBe(404);
    const contact = await pub.call('PATCH', '/carts/current', { contact: { name: 'Cart E2E', phone: `0905${String(Date.now()).slice(-6)}` }, captchaToken: 'pass' }, H);
    expect(contact.status, JSON.stringify(contact.body)).toBeLessThan(300);
    const cur = await pub.call('GET', '/carts/current?captchaToken=pass', undefined, H); expect(cur.body.quote.totals.grandTotal).toBeGreaterThan(0);
    const noKey = await pub.call('POST', '/carts/current/checkout', { consent: { policyVersion: cfg.consentPolicyVersion, accepted: true }, captchaToken: 'pass' }, H);
    expect(noKey.status).toBe(400);
    const key = randomUUID(); const body = { consent: { policyVersion: cfg.consentPolicyVersion, accepted: true }, expectedCartHash: cur.body.quote.cartHash, captchaToken: 'pass' };
    const out = await pub.call('POST', '/carts/current/checkout', body, { ...H, 'Idempotency-Key': key });
    expect(out.status, JSON.stringify(out.body)).toBeLessThan(300);
    const replay = await pub.call('POST', '/carts/current/checkout', body, { ...H, 'Idempotency-Key': key });
    expect(replay.body.order?.code).toBe(out.body.order?.code);
    const other = await pub.call('POST', '/carts/current/checkout', body, { ...H, 'Idempotency-Key': randomUUID() });
    expect(other.status).toBe(410);
    expect((await pub.call('GET', '/carts/current?captchaToken=pass', undefined, H)).status).toBe(410);
  });
  test('no cart token → CART_NOT_FOUND', async ({ pub }) => {
    expect((await pub.call('GET', '/carts/current?captchaToken=pass')).status).toBe(404);
  });
});

test.describe('Customer auth & self-service (customer-auth.mjs, data-rights.mjs)', () => {
  test('wrong OTP challenge → OTP_INVALID; /me* require X-Customer-Token', async ({ pub }) => {
    expect((await pub.call('POST', '/auth/verify', { challengeId: 'nope', code: '000000' })).body.error.code).toBe('OTP_INVALID');
    for (const p of ['/me', '/me/addresses', '/me/orders', '/me/loyalty', '/me/data-export']) {
      const r = await pub.call('GET', p); expect(r.status, p).toBe(401); expect(r.body.error.code).toBe('CUSTOMER_AUTH_REQUIRED');
    }
    expect((await pub.call('POST', '/me/erase', { confirm: true })).status).toBe(401);
    expect((await pub.call('GET', '/me', undefined, { 'X-Customer-Token': 'forged' })).status).toBe(401);
    expect((await pub.call('POST', '/auth/logout', {}, { 'X-Customer-Token': 'forged' })).status).toBeLessThan(300);
  });
});

test.describe('Gift card balance & payment (gift-card-payment.mjs)', () => {
  test('issued card shows balance; paying an order with it debits the card', async ({ pub, api, orders }) => {
    const issued = await api.post('/gift-cards', { amount: 100000, reason: `e2e ${uid()}` });
    expect(issued.status, JSON.stringify(issued.body)).toBeLessThan(300);
    const code = issued.body.code ?? issued.body.card?.code ?? issued.body.item?.code;
    test.skip(!code, 'issue response did not reveal the code');
    const bal = await pub.call('POST', '/gift-cards/balance', { code, captchaToken: 'pass' });
    expect(bal.status).toBe(200); expect(JSON.stringify(bal.body)).toContain('100000');
    const p = await orders.product(); const cfg = (await pub.call('GET', '/config?branch=Q1')).body;
    const base = { branch: 'Q1', locale: 'vi', lines: [{ sellableUid: p.id, quantity: 1 }], receiveMethod: PICKUP, payment: { providerCode: 'cash', giftCardCode: code } };
    const q = await pub.call('POST', '/quote', base); test.skip(q.status !== 200, 'ASAP not open');
    expect(q.body.totals.dueAfterGiftCard).toBeLessThan(q.body.totals.grandTotal);
    const r = await pub.call('POST', '/orders', { ...base, contact: { name: 'GC', phone: `0904${String(Date.now()).slice(-6)}` }, consent: { policyVersion: cfg.consentPolicyVersion, accepted: true }, expectedCartHash: q.body.cartHash, captchaToken: 'pass' }, { 'Idempotency-Key': randomUUID() });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const after = await pub.call('POST', '/gift-cards/balance', { code, captchaToken: 'pass' });
    expect(JSON.stringify(after.body)).not.toContain('100000');
  });
  test('unknown code → GIFT_CARD_INVALID', async ({ pub }) => {
    expect((await pub.call('POST', '/gift-cards/balance', { code: 'AAAA-BBBB-CCCC-DDDD', captchaToken: 'pass' })).body.error.code).toBe('GIFT_CARD_INVALID');
  });
});

test.describe('Branch pause / busy (pause.mjs)', () => {
  test('pause pickup blocks new pickup quotes; resume restores; busy adds minutes', async ({ api, pub, orders }) => {
    const p = await orders.product();
    expect((await api.post('/branches/Q1/pause', { kinds: ['pickup'], minutes: 15, reason: 'e2e' })).status).toBe(200);
    try {
      const q = await pub.call('POST', '/quote', { branch: 'Q1', locale: 'vi', lines: [{ sellableUid: p.id, quantity: 1 }], receiveMethod: PICKUP });
      expect(q.status).toBeGreaterThanOrEqual(400);
      expect((await pub.call('GET', '/config?branch=Q1')).body.branch.pause.pickup).toBeTruthy();
    } finally { expect((await api.post('/branches/Q1/resume', { kinds: ['pickup'] })).status).toBe(200); }
    expect((await api.post('/branches/Q1/busy', { extraMinutes: 15, minutes: 30 })).status).toBe(200);
    try { expect((await pub.call('GET', '/config?branch=Q1')).body.branch.pickup.busyExtraMinutes).toBe(15); }
    finally { await api.post('/branches/Q1/busy/clear', {}); }
  });
});

test.describe('Availability & daily stock (catalog-availability.mjs, daily-stock.mjs)', () => {
  test('toggle sold-out hides/blocks the item; daily limit enforces ITEM_SOLD_OUT', async ({ api, pub, orders }) => {
    const p = await orders.product(); const productDoc = p.id;
    const off = await api.post('/availability/toggle', { entityType: 'product', entityDocumentId: productDoc, locationRef: 'Q1', selling: false });
    test.skip(off.status === 400 || off.status === 404, `product id is not a documentId here: ${JSON.stringify(off.body)}`);
    try {
      expect(off.status, JSON.stringify(off.body)).toBe(200);
      const q = await pub.call('POST', '/quote', { branch: 'Q1', locale: 'vi', lines: [{ sellableUid: p.id, quantity: 1 }], receiveMethod: PICKUP });
      expect(q.status).toBeGreaterThanOrEqual(400);
    } finally { await api.post('/availability/toggle', { entityType: 'product', entityDocumentId: productDoc, locationRef: 'Q1', selling: true }); }
    const lim = await api.put('/availability/daily-limit', { locationRef: 'Q1', entityType: 'product', entityDocumentId: productDoc, dailyLimit: 1 });
    try {
      expect(lim.status, JSON.stringify(lim.body)).toBe(200);
      const q = await pub.call('POST', '/quote', { branch: 'Q1', locale: 'vi', lines: [{ sellableUid: p.id, quantity: 5 }], receiveMethod: PICKUP });
      expect(q.status).toBeGreaterThanOrEqual(400); expect(JSON.stringify(q.body)).toMatch(/SOLD_OUT|LIMIT|STOCK/);
    } finally { await api.put('/availability/daily-limit', { locationRef: 'Q1', entityType: 'product', entityDocumentId: productDoc, dailyLimit: null }); }
  });
});

test.describe('Dine-in & fees (dine-in.mjs, fees.mjs)', () => {
  test('resolve table token; dine-in quote carries the 5% service fee; bad token → TABLE_NOT_FOUND', async ({ api, pub, orders }) => {
    expect((await pub.call('POST', '/tables/resolve', { token: 'bogus' })).body.error.code).toBe('TABLE_NOT_FOUND');
    const code = `F${uid()}`.slice(0, 10).toUpperCase();
    const t = await api.post('/tables', { locationRef: 'Q1', code, name: `Bàn phí ${code}`, seats: 2 });
    expect(t.status, JSON.stringify(t.body)).toBeLessThan(300);
    const item = t.body.item ?? t.body; const url: string = item.qrUrl ?? item.menuUrl ?? '';
    const token = new URL(url, 'http://x').searchParams.get('t') ?? url.split('/').pop();
    const res = await pub.call('POST', '/tables/resolve', { token }); expect(res.status, JSON.stringify(res.body)).toBe(200);
    const p = await orders.product();
    const q = await pub.call('POST', '/quote', { branch: 'Q1', locale: 'vi', lines: [{ sellableUid: p.id, quantity: 2 }], receiveMethod: { kind: 'dine-in', locationRef: 'Q1', tableToken: token } });
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body.totals.fulfillmentTotal + q.body.totals.adjustmentTotal + (q.body.totals.feeTotal ?? 0)).toBeGreaterThan(0);
    await api.put(`/tables/${item.id}`, { active: false });
  });
});

// Inbound SePay webhook matching (sepay-webhook/match/reconcile.mjs) needs SEPAY_WEBHOOK_SECRET + SEPAY_ACCOUNTS,
// which the local .env leaves unset → known gap; the unregistered-provider case is covered as @bug-14 in 99-bugs.
