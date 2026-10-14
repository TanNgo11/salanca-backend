import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Trusted visitor-IP forwarding for the storefront calls.
process.env.FORM_INTAKE_SHARED_SECRET = 'storefront-test-secret';

import { basicOrderInput, seedBranches, services, systemCtx, withApp } from './_harness.mjs';

// Core gaps step 2: the chosen variant reaches pricing. /quote, /orders and staff drafts used to
// drop `variantUid` (parse), an unknown uid silently priced the default variant, a tạm hết variant
// was still sold, and the order line kept the default variant's sku and title.
withApp(async (app) => {
  const d = {
    category: app.documents('plugin::ordering.catalog-category'),
    product: app.documents('plugin::ordering.catalog-product'),
    variant: app.documents('plugin::ordering.catalog-variant'),
    price: app.documents('plugin::ordering.catalog-price'),
    state: app.db.query('plugin::ordering.catalog-location-state'),
  };
  const { order } = services(app);
  await seedBranches(app);
  const branchRows = app.db.query('plugin::ordering.branch');
  const q1 = await branchRows.findOne({ where: { code: 'Q1' } });
  await branchRows.update({
    where: { id: q1.id },
    data: {
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          schedule: { openingHours: { mode: '24_7' } },
        },
      },
    },
  });
  app.config.set('plugin::ordering.catalog.adapter', 'ordering-catalog');

  const category = await d.category.create({ data: { name: { vi: 'Món chính' }, rank: 0 } });
  const mkProduct = (name) =>
    d.product.create({
      data: {
        productType: 'food',
        status: 'active',
        sellOnline: true,
        fulfillmentKinds: ['pickup'],
        name: { vi: name },
        categories: [category.documentId],
      },
    });
  const mkVariant = async (product, sku, name, amount, extra = {}) => {
    const variant = await d.variant.create({
      data: { product: product.documentId, sku, name: { vi: name }, isDefault: false, rank: 0, ...extra },
    });
    await d.price.create({ data: { variant: variant.documentId, amount, currency: 'VND' } });
    return variant;
  };
  const bunBo = await mkProduct('Bún bò');
  const std = await mkVariant(bunBo, 'BB-STD', 'Tô thường', 65000, { isDefault: true });
  const special = await mkVariant(bunBo, 'BB-DB', 'Tô đặc biệt', 85000, { rank: 1 });
  const large = await mkVariant(bunBo, 'BB-L', 'Tô lớn', 95000, { rank: 2 });
  const traDao = await mkProduct('Trà đào');
  const foreign = await mkVariant(traDao, 'TD-STD', 'Ly', 45000, { isDefault: true });
  await d.state.create({
    data: { entityType: 'variant', entityDocumentId: large.documentId, locationRef: 'Q1', selling: false },
  });

  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  let visitor = 1;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'x-salanca-intake-secret': 'storefront-test-secret',
        'x-salanca-visitor-ip': `192.0.4.${visitor++}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const cart = (variantUid, sellableUid = bunBo.documentId) => ({
    branch: 'Q1',
    locale: 'vi',
    lines: [{ sellableUid, quantity: 1, ...(variantUid === undefined ? {} : { variantUid }) }],
    receiveMethod: { kind: 'pickup' },
  });
  const orderBody = (variantUid, sellableUid) => ({
    ...cart(variantUid, sellableUid),
    contact: { name: 'Khách test', phone: '0901 234 567' },
    consent: { policyVersion: 'v1', accepted: true },
    captchaToken: 'pass',
  });
  const key = () => ({ 'Idempotency-Key': `test-${randomUUID()}` });
  const lineRows = app.db.query('plugin::ordering.order-line');
  const lastLine = async () => (await lineRows.findMany({ orderBy: { id: 'desc' }, limit: 1 }))[0];

  // ── Quote prices the chosen variant; no variantUid keeps the default ────────────────────
  const dflt = await call('POST', '/quote', cart());
  assert.equal(dflt.status, 200, JSON.stringify(dflt.body));
  assert.equal(dflt.body.totals.grandTotal, 65000, 'no variantUid = default variant');
  const picked = await call('POST', '/quote', cart(special.documentId));
  assert.equal(picked.status, 200, JSON.stringify(picked.body));
  assert.equal(picked.body.totals.grandTotal, 85000, 'quote prices the chosen variant');
  assert.equal(picked.body.lines[0].unitAmount, 85000);

  // ── Unknown uid, other product's variant, tạm hết variant: refused, never default-priced ──
  const unknown = await call('POST', '/quote', cart('no-such-variant'));
  assert.equal(unknown.status, 400, JSON.stringify(unknown.body));
  assert.equal(unknown.body.error.code, 'VALIDATION_ERROR');
  assert.equal(unknown.body.error.details.field, 'lines.0.variantUid');
  const wrongProduct = await call('POST', '/quote', cart(foreign.documentId));
  assert.equal(wrongProduct.status, 400);
  assert.equal(wrongProduct.body.error.details.field, 'lines.0.variantUid');
  const soldOut = await call('POST', '/quote', cart(large.documentId));
  assert.equal(soldOut.body?.error?.code, 'SELLABLE_UNAVAILABLE', JSON.stringify(soldOut.body));
  assert.equal(soldOut.body.error.details.lineIndex, 0);
  assert.equal((await call('POST', '/orders', orderBody('no-such-variant'), key())).status, 400);
  assert.equal(
    (await call('POST', '/orders', orderBody(large.documentId), key())).body.error.code,
    'SELLABLE_UNAVAILABLE',
  );

  // ── Create: the line stores the chosen variant's uid, sku, title and price ──────────────
  const created = await call('POST', '/orders', orderBody(special.documentId), key());
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.order.totals.total, 85000);
  const stored = await lastLine();
  assert.equal(stored.variantUid, special.documentId);
  assert.equal(stored.sku, 'BB-DB', 'sku of the chosen variant');
  assert.equal(stored.titleSnapshot, 'Bún bò · Tô đặc biệt', 'title names the non-default variant');
  assert.equal(Number(stored.unitAmount), 85000);

  const plain = await call('POST', '/orders', orderBody(undefined), key());
  assert.equal(plain.status, 201, JSON.stringify(plain.body));
  const plainLine = await lastLine();
  assert.equal(plainLine.variantUid, std.documentId);
  assert.equal(plainLine.sku, 'BB-STD');
  assert.equal(plainLine.titleSnapshot, 'Bún bò', 'default variant keeps the plain title');

  // ── Service layer: the same rules hold for any caller of createOrder (staff drafts too) ──
  await assert.rejects(
    order.createOrder(
      basicOrderInput({
        idempotencyKey: randomUUID(),
        lines: [{ sellableUid: bunBo.documentId, quantity: 1, variantUid: 'no-such-variant' }],
        adjustments: [],
      }),
      systemCtx,
    ),
    (error) => error?.code === 'VALIDATION_ERROR' && error.details?.field === 'lines.0.variantUid',
  );

  // ── A cart line whose variant was removed or went tạm hết is an issue on that line, not a
  //    cart-wide failure: the rest of the cart still quotes ────────────────────────────────
  const cartCreated = await call('POST', '/carts', {
    locationRef: 'Q1',
    receiveMethod: { kind: 'pickup' },
    locale: 'vi',
  });
  assert.equal(cartCreated.status, 201, JSON.stringify(cartCreated.body));
  const cartHeaders = { 'x-cart-token': cartCreated.body.cartToken };
  const addLine = (line) => call('POST', '/carts/current/lines', line, cartHeaders);
  const lineWithVariant = await addLine({ sellableUid: bunBo.documentId, variantUid: special.documentId, quantity: 1 });
  assert.equal(lineWithVariant.status, 200, JSON.stringify(lineWithVariant.body));
  const lineSoldOut = await addLine({ sellableUid: bunBo.documentId, variantUid: large.documentId, quantity: 1 });
  assert.equal(lineSoldOut.status, 200, JSON.stringify(lineSoldOut.body));
  await addLine({ sellableUid: traDao.documentId, quantity: 1 });
  const idOf = (response, variantUid) =>
    response.body.cart.lines.find((row) => row.variantUid === variantUid).id;
  const goodId = idOf(lineWithVariant, special.documentId);
  const soldOutId = idOf(lineSoldOut, large.documentId);

  const mixed = await call('GET', '/carts/current', undefined, cartHeaders);
  assert.equal(mixed.status, 200, JSON.stringify(mixed.body));
  assert.equal(mixed.body.quote.totals.grandTotal, 85000 + 45000, 'the chosen variant prices in the cart');
  assert.equal(mixed.body.issues.length, 1);
  assert.equal(mixed.body.issues[0].lineId, soldOutId);
  assert.equal(mixed.body.issues[0].code, 'SELLABLE_UNAVAILABLE');

  await d.variant.delete({ documentId: special.documentId });
  const stale = await call('GET', '/carts/current', undefined, cartHeaders);
  assert.equal(stale.status, 200, 'a deleted variant does not fail the whole cart');
  assert.equal(stale.body.quote.totals.grandTotal, 45000, 'only the live line is quoted');
  const staleIssue = stale.body.issues.find((issue) => issue.lineId === goodId);
  assert.equal(staleIssue?.code, 'VALIDATION_ERROR', 'the removed variant surfaces as an issue on its own line');

  console.log(
    '[ordering-test] variant-order: quote/create price the chosen variant, bad uid 400, tạm hết variant refused, sku/title snapshot verified',
  );
});
