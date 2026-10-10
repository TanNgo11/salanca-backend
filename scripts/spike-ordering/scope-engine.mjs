// O0 probe (checks 8, 13): branch condition evaluated by Strapi's own permission engine,
// for two real admin users of two branches, plus what happens when a handler returns null.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { loadSpikeApp } from './runtime.mjs';

const app = await loadSpikeApp();
const ORDER = 'plugin::ordering.order';
const ACTION = 'plugin::ordering.order.read';
const createdUsers = [];
try {
  const admin = app.admin.services;
  const suffix = randomUUID().slice(0, 8);
  const makeUser = async (name) => {
    const user = await admin.user.create({
      firstname: name, lastname: 'O0', email: `o0-${name}-${suffix}@example.invalid`, isActive: true, registrationToken: null,
    });
    createdUsers.push(user.id);
    return user;
  };
  const staffA = await makeUser('staff-a');
  const staffB = await makeUser('staff-b');
  const unscoped = await makeUser('unscoped');

  const scopes = app.db.query('plugin::ordering.staff-location-scope');
  await scopes.create({ data: { adminUserId: staffA.id, allLocations: false, locationRefs: ['A'] } });
  await scopes.create({ data: { adminUserId: staffB.id, allLocations: false, locationRefs: ['B'] } });

  const orders = app.db.query(ORDER);
  await orders.create({ data: { code: `O0-A-${suffix}`, locationRef: 'A' } });
  await orders.create({ data: { code: `O0-B-${suffix}`, locationRef: 'B' } });

  const visibleCodes = async (user, condition) => {
    const ability = await admin.permission.engine.generateTokenAbility(
      [{ action: ACTION, subject: ORDER, properties: {}, conditions: [condition] }], user);
    const manager = admin.permission.createPermissionsManager({ ability, action: ACTION, model: ORDER });
    if (!manager.isAllowed) return [];
    const where = manager.getQuery() ?? {};
    const rows = await orders.findMany({ where: { $and: [where, { code: { $endsWith: suffix } }] } });
    return rows.map((row) => row.code).sort();
  };

  const scoped = 'plugin::ordering.same-location';
  assert.deepEqual(await visibleCodes(staffA, scoped), [`O0-A-${suffix}`]);
  assert.deepEqual(await visibleCodes(staffB, scoped), [`O0-B-${suffix}`]);
  assert.deepEqual(await visibleCodes(unscoped, scoped), []);
  console.log('[spike] engine: staff A sees only branch A, staff B only branch B, unscoped user sees nothing');

  // @strapi/permissions drops non boolean/object results, then `[].every(...)` is true, so a permission
  // whose only condition returns null is denied (fail-closed). Earlier desk reading said fail-open.
  assert.deepEqual(await visibleCodes(unscoped, 'plugin::ordering.spike-null-probe'), []);
  const mixed = async (user) => {
    const ability = await admin.permission.engine.generateTokenAbility([{
      action: ACTION, subject: ORDER, properties: {}, conditions: ['plugin::ordering.spike-null-probe', scoped],
    }], user);
    const manager = admin.permission.createPermissionsManager({ ability, action: ACTION, model: ORDER });
    const rows = await orders.findMany({ where: { $and: [manager.getQuery() ?? {}, { code: { $endsWith: suffix } }] } });
    return rows.map((row) => row.code);
  };
  assert.deepEqual(await mixed(staffA), [`O0-A-${suffix}`]);
  console.log('[spike] engine: a condition returning null is dropped; alone it denies (fail-closed), next to another condition it is ignored');
} finally {
  await app.db.query(ORDER).deleteMany({ where: { code: { $startsWith: 'O0-' } } });
  await app.db.query('plugin::ordering.staff-location-scope').deleteMany({ where: { adminUserId: { $in: createdUsers } } });
  for (const id of createdUsers) await app.admin.services.user.deleteById(id).catch(() => undefined);
  await app.destroy();
}
