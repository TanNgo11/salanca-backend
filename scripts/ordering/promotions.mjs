// Promotion quote/create: same total, per-customer, first order, cancel returns a use,
// a line-targeted percent, a code that does not exist, and (HTTP) the wrong-code guard:
// captcha after 3 guesses per IP, 429 at the configured limit, eligibility misses not counted.
import assert from 'node:assert/strict';

// Trusted visitor-IP forwarding gives each HTTP section its own wrong-code bucket.
process.env.FORM_INTAKE_SHARED_SECRET = 'promotions-test-secret';

import { basicOrderInput, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const PHONE = '+84901110001';

const createPromotion = async (app, data, code) => {
  const row = await app.db.query('plugin::ordering.promotion').create({ data });
  if (code) {
    await app.db.query('plugin::ordering.promotion-code').create({
      data: {
        promotionId: row.id,
        code: code.code,
        usageLimit: code.usageLimit ?? null,
        usedCount: 0,
        active: true,
      },
    });
  }
  return row;
};

const basePromotion = (overrides) => ({
  name: { vi: 'Giảm', en: 'Off' },
  kind: 'code',
  discountType: 'percent',
  value: 10,
  maxDiscount: null,
  target: { kind: 'order', refs: [] },
  minSubtotal: 0,
  locationRefs: ['Q1'],
  receiveKinds: ['pickup'],
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-12-01T00:00:00.000Z',
  weekdays: [],
  timeRanges: [],
  firstOrderOnly: false,
  usageLimit: null,
  perCustomerLimit: null,
  stackable: false,
  priority: 1,
  active: true,
  usedCount: 0,
  ...overrides,
});

withApp(async (app) => {
  const { order, transition } = services(app);
  await seedBranches(app);
  seedMenu(app);

  await createPromotion(
    app,
    basePromotion({ name: { vi: 'Giảm 10%' }, maxDiscount: 30000, perCustomerLimit: 1, stackable: true }),
    { code: 'GIAM10', usageLimit: null },
  );

  const inputFor = (phone, code, extra = {}) =>
    basicOrderInput({
      adjustments: [],
      promotionCode: code,
      contact: { name: 'Khách test', phone },
      placedAt: '2026-10-13T04:30:00.000Z',
      ...extra,
    });

  const first = inputFor(PHONE, 'giam10');
  const { idempotencyKey: _key, ...draft } = first;
  const quoted = await order.quote(draft, systemCtx);
  const created = await order.createOrder(first, systemCtx);
  assert.equal(quoted.totals.grandTotal, 198000);
  assert.equal(created.order.order.totalAmount, quoted.totals.grandTotal);
  assert.equal(created.order.order.adjustmentAmount, -22000);
  assert.equal(quoted.promotions[0].code, 'GIAM10');
  assert.equal(quoted.rejectedPromotions.length, 0);
  console.log('[ordering-test] quote matches create for GIAM10, total', created.order.order.totalAmount);

  await assert.rejects(
    () => order.createOrder(inputFor(PHONE, 'GIAM10'), systemCtx),
    (error) => error.code === 'PROMOTION_NOT_ELIGIBLE' && error.details?.reason === 'per-customer',
  );
  console.log('[ordering-test] second order for the same phone is per-customer');

  const other = await order.createOrder(inputFor('+84901110002', 'GIAM10'), systemCtx);
  assert.equal(other.order.order.totalAmount, 198000);
  await transition.cancelOrder({ orderId: other.order.order.id, reason: 'test' }, systemCtx);
  const promo = await app.db.query('plugin::ordering.promotion').findOne({ where: { id: { $gt: 0 } } });
  assert.equal(promo.usedCount, 1);
  console.log('[ordering-test] cancel releases the use; one redemption remains');

  await createPromotion(
    app,
    basePromotion({
      name: { vi: 'Bún bò' },
      kind: 'auto',
      discountType: 'percent',
      value: 10,
      target: { kind: 'products', refs: ['bun-bo'] },
      stackable: false,
      priority: 0,
    }),
  );
  const linePromo = await order.quote(
    basicOrderInput({
      adjustments: [],
      contact: { name: 'Khách', phone: '+84901110003' },
      placedAt: '2026-10-13T04:30:00.000Z',
    }),
    systemCtx,
  );
  // Bún bò 130000 × 10% = 13000. No code, so only the automatic promotion applies.
  assert.equal(linePromo.totals.grandTotal, 220000 - 13000);
  assert.equal(linePromo.promotions[0].target, 'lines');
  console.log('[ordering-test] product promotion discounts only the matching line');

  const badQuote = await order.quote(
    basicOrderInput({
      adjustments: [],
      promotionCode: 'NOPE1',
      contact: { name: 'Khách', phone: '+84901110004' },
      placedAt: '2026-10-13T04:30:00.000Z',
    }),
    systemCtx,
  );
  assert.equal(badQuote.rejectedPromotions[0].reason, 'invalid');
  await assert.rejects(
    () =>
      order.createOrder(
        basicOrderInput({
          adjustments: [],
          promotionCode: 'NOPE1',
          contact: { name: 'Khách', phone: '+84901110004' },
          placedAt: '2026-10-13T04:30:00.000Z',
        }),
        systemCtx,
      ),
    (error) => error.code === 'PROMOTION_INVALID',
  );
  console.log('[ordering-test] an unknown code is rejected on the quote and refused on create');
  // --- HTTP: wrong-code guard ------------------------------------------------------------
  app.config.set('plugin::ordering.storefront.rateLimits.promotionCode', { max: 6, windowMs: 600_000 });
  app.config.set('plugin::ordering.storefront.rateLimits.quote', { max: 100, windowMs: 60_000 });
  await createPromotion(
    app,
    basePromotion({
      name: { vi: 'Đơn lớn' },
      minSubtotal: 10_000_000,
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: null,
    }),
    { code: 'DONLON', usageLimit: null },
  );
  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  const call = async (body, ip) => {
    const res = await fetch(`${base}/quote`, {
      method: 'POST',
      headers: {
        'x-salanca-intake-secret': 'promotions-test-secret',
        'x-salanca-visitor-ip': ip,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const config = await (await fetch(`${base}/config?branch=Q1`)).json();
  const slotDate = config.branch.pickup.bookableFrom;
  const slots = await (await fetch(`${base}/slots?branch=Q1&date=${slotDate}`)).json();
  const slot = slots.items.find((row) => row.available);
  assert.ok(slot, 'an open slot for the HTTP quotes');
  const cart = (promotionCode, extra = {}) => ({
    branch: 'Q1',
    locale: 'vi',
    lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
    receiveMethod: { kind: 'pickup', slot: { startsAt: slot.startsAt } },
    promotionCode,
    ...extra,
  });

  // A real code the cart is too small for: eligibility, not a guess — never needs captcha.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const miss = await call(cart('DONLON'), '198.51.100.7');
    assert.equal(miss.status, 200, JSON.stringify(miss.body));
    assert.equal(miss.body.rejectedPromotions[0].reason, 'min-subtotal');
  }
  console.log('[ordering-test] eligibility misses on a real code do not count as guesses');

  const guesser = '198.51.100.9';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const guess = await call(cart(`SAI${attempt}X`), guesser);
    assert.equal(guess.status, 200);
    assert.equal(guess.body.rejectedPromotions[0].reason, 'invalid');
  }
  const noCaptcha = await call(cart('SAI9X'), guesser);
  assert.equal(noCaptcha.body.error?.code, 'CAPTCHA_FAILED', 'after 3 wrong codes a captcha is required');
  const plain = await call(cart(undefined), guesser);
  assert.equal(plain.status, 200, 'a quote without a code never needs the captcha');
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    last = await call(cart(`SAI${attempt}Y`, { captchaToken: 'pass' }), guesser);
  }
  assert.equal(last.status, 429, 'the configured wrong-code limit answers 429');
  assert.equal(last.body.error.code, 'RATE_LIMITED');
  assert.equal((await call(cart('GIAM10', { captchaToken: 'pass' }), guesser)).status, 429);
  console.log('[ordering-test] wrong-code guard: captcha after 3 guesses, 429 at the limit');
});
