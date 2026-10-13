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

  // GIAM10 has a per-customer limit: the quote never reads the phone's history, so it lists the
  // code as pending at full price, and create applies it for real (the total only goes down).
  const quoteFor = async (phone) => {
    const { idempotencyKey: _key, ...draft } = inputFor(phone, 'giam10');
    return order.quote({ ...draft, contact: { phone: '' } }, systemCtx);
  };
  const quoted = await quoteFor(PHONE);
  assert.equal(quoted.totals.grandTotal, 220000);
  assert.equal(quoted.promotions.length, 0);
  assert.deepEqual(quoted.pendingPromotions, [{ code: 'GIAM10', label: 'Giảm 10%', condition: 'per-customer' }]);
  assert.equal(quoted.rejectedPromotions.length, 0);
  const created = await order.createOrder({ ...inputFor(PHONE, 'giam10'), expectedCartHash: quoted.cartHash }, systemCtx);
  assert.equal(created.order.order.totalAmount, 198000);
  assert.equal(created.order.order.adjustmentAmount, -22000);
  const again = await quoteFor(PHONE);
  assert.equal(again.cartHash, quoted.cartHash, 'a quote is the same before and after the number ordered');
  assert.deepEqual(again.pendingPromotions, quoted.pendingPromotions);
  console.log('[ordering-test] per-customer code: quote pending at full price, create applies it, quote reveals no history');

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
  // First-order automatic promotion: quote shows it pending for everyone; create applies it only
  // to a number with no earlier order.
  const firstOrder = await createPromotion(
    app,
    basePromotion({
      name: { vi: 'Đơn đầu giảm 50.000đ' },
      kind: 'auto',
      discountType: 'amount',
      value: 50000,
      firstOrderOnly: true,
      stackable: true,
      priority: 5,
    }),
  );
  const firstQuote = await order.quote(
    basicOrderInput({ adjustments: [], contact: { phone: '' }, placedAt: '2026-10-13T04:30:00.000Z' }),
    systemCtx,
  );
  assert.ok(firstQuote.pendingPromotions.some((row) => row.condition === 'first-order'));
  const hasFirstOrder = (created) =>
    created.order.adjustments.some((row) => row.sourceRef === `promotion:${firstOrder.id}`);
  const newcomer = await order.createOrder(inputFor('+84901110009', undefined), systemCtx);
  assert.equal(hasFirstOrder(newcomer), true, 'a new number gets the first-order promotion');
  const returning = await order.createOrder(inputFor(PHONE, undefined), systemCtx);
  assert.equal(hasFirstOrder(returning), false, 'a number that ordered before does not');
  console.log('[ordering-test] first-order promotion: pending on the quote, applied at create to new numbers only');

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
  // bookableFrom is today. After closing time every slot is too-early, so quote on the next day.
  const today = config.branch.pickup.bookableFrom;
  const next = new Date(`${today}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const slotDate = next.toISOString().slice(0, 10);
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
