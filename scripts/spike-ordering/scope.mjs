import assert from 'node:assert/strict';
import { loadSpikeApp } from './runtime.mjs';

const app = await loadSpikeApp();
try {
  const service = app.plugin('ordering').service('branch-scope');
  assert.equal(await service.condition({}), false);
  const userId = 900000 + process.pid;
  await app.db.query('plugin::ordering.staff-location-scope').create({ data: { adminUserId: userId, allLocations: false, locationRefs: ['A'] } });
  assert.deepEqual(await service.condition({ user: { id: userId } }), { locationRef: { $in: ['A'] } });
  await app.db.query('plugin::ordering.staff-location-scope').update({ where: { adminUserId: userId }, data: { allLocations: true } });
  assert.equal(await service.condition({ user: { id: userId } }), true);
  console.log('[spike] branch condition: no scope denied; assigned branch filtered; allLocations allowed');
} finally { await app.db.query('plugin::ordering.staff-location-scope').deleteMany({ where: { adminUserId: { $gte: 900000 } } }); await app.destroy(); }
