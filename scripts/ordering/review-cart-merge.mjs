import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { systemCtx } from './_harness.mjs';
import { directRun } from './_review-race.mjs';

export async function testCartMerge(app) {
  const carts = app.plugin('ordering').service('cart');
  const person = await app.db.query('plugin::ordering.customer').create({ data: { email: `${randomUUID()}@example.invalid`, status: 'active' } });
  await carts.create({}, { customerId: person.id }, systemCtx);
  const guest = await carts.create({}, { customerId: null }, systemCtx);
  const source = await carts.addLine(guest.row, { sellableUid: 'goi-cuon', quantity: 1 }, systemCtx);
  await Promise.all(Array.from({ length: 3 }, () => carts.merge(person.id, structuredClone(source), systemCtx)));
  const target = await carts.resolve({ customerId: person.id }, systemCtx);
  assert.equal(target.lines.length, 1);
  assert.equal(target.lines[0].quantity, 1, 'one guest portion is merged only once');
  assert.equal((await app.db.query('plugin::ordering.cart').findOne({ where: { id: source.id } })).status, 'expired');
  // Claiming a source without an existing target is also idempotent under concurrent calls.
  const newcomer = await app.db.query('plugin::ordering.customer').create({ data: { email: `${randomUUID()}@example.invalid`, status: 'active' } });
  const unclaimed = await carts.create({}, { customerId: null }, systemCtx);
  const claimed = await Promise.all(Array.from({ length: 3 }, () => carts.merge(newcomer.id, structuredClone(unclaimed.row), systemCtx)));
  assert.ok(claimed.every(row => row.id === unclaimed.row.id && row.customer.id === newcomer.id));
  console.log('[review-race] merge: three concurrent calls add once; concurrent claims keep one cart');
}
await directRun(import.meta.url, testCartMerge);
