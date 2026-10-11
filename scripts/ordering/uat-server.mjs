// Manual UAT server for O3 on the ordering TEST database only: resets the plugin tables, seeds two
// branches (24/7 pickup, short lead time), a small real catalog and two staff users (Q1 staff,
// chain manager), then keeps Strapi running until Ctrl+C. Emails are captured in memory (test
// builtins), captcha accepts the token "pass". Never run against the dev or production database.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { bootOrderingTestApp, resetOrderingTables, seedBranches } from './_harness.mjs';

process.env.PORT = process.env.UAT_PORT ?? '1350';
const app = await bootOrderingTestApp();
await resetOrderingTables(app);
await seedBranches(app);
app.config.set('plugin::ordering.catalog.adapter', 'ordering-catalog');

const branches = app.db.query('plugin::ordering.branch');
for (const code of ['Q1', 'Q3']) {
  const row = await branches.findOne({ where: { code } });
  await branches.update({
    where: { id: row.id },
    data: {
      email: `${code.toLowerCase()}@example.invalid`,
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          slaMinutes: 10,
          schedule: { leadTimeMinutes: 30, slotLengthMinutes: 30, capacity: 4, openingHours: { mode: '24_7' } },
        },
      },
    },
  });
}

const doc = (uid) => app.documents(`plugin::ordering.${uid}`);
const mains = await doc('catalog-category').create({ data: { name: { vi: 'Món chính', en: 'Mains' }, rank: 0 } });
const drinks = await doc('catalog-category').create({ data: { name: { vi: 'Đồ uống', en: 'Drinks' }, rank: 1 } });
const product = async (name, category, amount) => {
  const created = await doc('catalog-product').create({
    data: { productType: 'food', status: 'active', sellOnline: true, fulfillmentKinds: ['pickup'], name, categories: [category.documentId] },
  });
  const variant = await doc('catalog-variant').create({
    data: { product: created.documentId, isDefault: true, rank: 0, name: { vi: 'Thường' } },
  });
  await doc('catalog-price').create({ data: { variant: variant.documentId, amount, currency: 'VND' } });
  return created;
};
const bunBo = await product({ vi: 'Bún bò Huế', en: 'Hue beef noodle' }, mains, 100000);
await product({ vi: 'Combo trưa 1 người', en: 'Lunch combo' }, mains, 99000);
await product({ vi: 'Trà đào cam sả', en: 'Peach tea' }, drinks, 45000);
const topping = await doc('catalog-modifier-group').create({ data: { name: { vi: 'Topping', en: 'Toppings' }, selectionType: 'multiple', rank: 0 } });
await doc('catalog-modifier').create({ data: { name: { vi: 'Chả cua', en: 'Crab cake' }, priceDelta: 15000, group: topping.documentId, rank: 0 } });
await doc('catalog-product').update({
  documentId: bunBo.documentId,
  data: { modifierGroups: [{ groupRef: topping.documentId, required: false, min: 0, max: 2, freeQuantity: 0, rank: 0, overrides: {} }] },
});

// Staff: a non-super-admin role with every order action; Q1 staff and a chain manager.
const role = await app.admin.services.role.create({ name: `UAT ordering ${randomUUID().slice(0, 6)}`, description: 'O3 UAT' });
const actions = [
  'order.read', 'order.process', 'order.cancel', 'order.create', 'order.edit-lines', 'payment.record-cash',
  'refund.manage', 'settings.manage', 'scope.manage', 'catalog.toggle-availability',
];
await app.admin.services.role.assignPermissions(
  role.id,
  actions.map((action) => ({ action: `plugin::ordering.${action}`, subject: null, properties: {}, conditions: [] })),
);
const password = `Uat-${randomUUID().slice(0, 8)}-Aa1`;
const accounts = [];
for (const [name, scope] of [
  ['lan-q1', { allLocations: false, locationRefs: ['Q1'] }],
  ['quan-ly-chuoi', { allLocations: true, locationRefs: [] }],
]) {
  const email = `uat-${name}-${randomUUID().slice(0, 4)}@example.invalid`;
  const user = await app.admin.services.user.create({
    firstname: name, lastname: 'UAT', email, password, isActive: true, registrationToken: null, roles: [role.id],
  });
  await app.db.query('plugin::ordering.staff-location-scope').create({ data: { adminUserId: user.id, ...scope } });
  accounts.push({ name, email });
}
// Credentials stay in a local file outside the repo; never printed.
const credFile = process.env.UAT_CRED_FILE;
if (credFile) writeFileSync(credFile, JSON.stringify({ password, accounts }, null, 2));

await app.listen();
console.log(`[ordering-uat] ready on http://127.0.0.1:${process.env.PORT}/admin (salanca_ordering_test)`);
