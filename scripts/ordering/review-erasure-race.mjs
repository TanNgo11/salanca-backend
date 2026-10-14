import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { basicOrderInput, seedBranches, seedMenu, systemCtx } from './_harness.mjs';
import { deferred, directRun, interceptQuery } from './_review-race.mjs';
import { o11Hashing } from '../../src/plugins/ordering/dist/server/src/domain/customers/identity.js';

export async function testErasureRace(app) {
  await seedBranches(app); seedMenu(app);
  const plugin = app.plugin('ordering');
  const hash = o11Hashing(app.config.get('plugin::ordering').encryptionKey);
  for (const kind of ['session-email', 'guest-phone', 'closed-session']) {
    const phone = '+84907773333';
    const person = await app.db.query('plugin::ordering.customer').create({ data: {
      email: `${randomUUID()}@example.invalid`, status: 'active',
      ...(kind === 'guest-phone' ? { phone, phoneHash: hash.phoneHash(phone) } : {}),
    } });
    const counted = deferred(); const resume = deferred();
    let paused = false;
    const restore = interceptQuery(app, 'plugin::ordering.order', 'count', async (count, input) => {
      const value = await count(input);
      if (!paused && input.where?.customer === person.id && input.where?.status?.$in?.includes('open')) {
        assert.equal(value, 0); paused = true; counted.resolve(); await resume.promise;
      }
      return value;
    });
    const erasing = plugin.service('data-rights').requestSelfErase(person.id, systemCtx)
      .then(value => ({ value }), error => ({ error }));
    let placed;
    try {
      await counted.promise;
      placed = await plugin.service('order').createOrder(basicOrderInput({
        contact: { name: 'Fixture', phone }, ...(kind !== 'guest-phone' ? { customerId: person.id } : {}),
      }), systemCtx);
      if (kind === 'closed-session') {
        await plugin.service('transition').cancelOrder({ orderId: placed.order.order.id, reason: 'fixture-close' }, systemCtx);
      }
    } finally { resume.resolve(); }
    let result;
    try { result = await erasing; } finally { restore(); }
    if (result.error) throw result.error;
    const row = await app.db.query('plugin::ordering.order').findOne({ where: { id: placed.order.order.id }, populate: { customer: true } });
    if (kind === 'closed-session') {
      assert.equal(result.value.status, 'done');
      assert.ok(row.customer === null, 'a newly closed order is anonymized before erasure completes');
      assert.equal(row.contactSnapshot.phone, null);
      console.log('[review-race] erasure closed-session: newly closed order anonymized before done');
      continue;
    }
    assert.equal(result.value.status, 'waiting', `${kind}: recheck must see the committed new order`);
    assert.equal(row.customer.id, person.id);
    assert.ok(row.contactSnapshot.phone, 'waiting preserves the active order contact');
    assert.notEqual((await app.db.query('plugin::ordering.customer').findOne({ where: { id: person.id } })).status, 'erased');
    console.log(`[review-race] erasure ${kind}: waiting, active order preserved`);
  }
  // Erasure holds the customer lock while checkout starts. Observe PostgreSQL's actual
  // advisory waiter, then release erasure: checkout must not hold a cart lock it needs.
  const person = await app.db.query('plugin::ordering.customer').create({ data: {
    email: `${randomUUID()}@example.invalid`, status: 'active',
  } });
  const carts = plugin.service('cart');
  const created = await carts.create({ locationRef: 'Q1', receiveMethod: { kind: 'pickup' },
    contact: { name: 'Fixture', phone: '+84907774444' } }, { customerId: person.id }, systemCtx);
  const cart = await carts.addLine(created.row, { sellableUid: 'goi-cuon', quantity: 1 }, systemCtx);
  const counted = deferred(); const resume = deferred();
  let counts = 0;
  const restore = interceptQuery(app, 'plugin::ordering.order', 'count', async (count, input) => {
    const value = await count(input);
    if (input.where?.customer === person.id && input.where?.status?.$in?.includes('open') && ++counts === 2) {
      counted.resolve(); await resume.promise;
    }
    return value;
  });
  const erasing = plugin.service('data-rights').requestSelfErase(person.id, systemCtx)
    .then(value => ({ value }), error => ({ error }));
  await counted.promise;
  const checkingOut = carts.checkout(cart, { customerId: person.id, consent: { policyVersion: 'v1' },
    idempotencyKey: randomUUID() }, systemCtx).then(value => ({ value }), error => ({ error }));
  try {
    const deadline = performance.now() + 10000;
    let waiting = false;
    while (performance.now() < deadline) {
      const { rows } = await app.db.connection.raw(
        "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory' LIMIT 1");
      if (rows.length) { waiting = true; break; }
    }
    assert.ok(waiting, 'checkout reached the customer advisory lock while erasure held it');
  } finally { resume.resolve(); }
  let eraseResult; let checkoutResult;
  try { [eraseResult, checkoutResult] = await Promise.all([erasing, checkingOut]); }
  finally { restore(); }
  assert.ok(!eraseResult.error, 'erasure must commit without a customer/cart deadlock');
  assert.equal(eraseResult.value.status, 'done');
  assert.equal(checkoutResult.error?.code, 'CART_NOT_FOUND', 'checkout sees the erased cart after waiting');
  console.log('[review-race] erasure vs checkout: customer-before-cart locks avoid deadlock');

}
await directRun(import.meta.url, testErasureRace);
