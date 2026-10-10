import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadSpikeApp } from './runtime.mjs';

const app = await loadSpikeApp();
const code = `O0-TX-${randomUUID()}`;
const eventLog = [];
try {
  const created = await app.db.query('plugin::ordering.order').create({ data: { code, locationRef: 'spike', counter: 0 } });
  const service = app.plugin('ordering').service('spike-tx');
  await Promise.all(Array.from({ length: 20 }, () => service.run(app, code)));
  const row = await app.db.query('plugin::ordering.order').findOne({ where: { code } });
  assert.equal(row.counter, 20);

  await app.db.connection.raw('CREATE SEQUENCE IF NOT EXISTS plugins_ordering_spike_seq');
  const values = await Promise.all(Array.from({ length: 200 }, async () =>
    (await app.db.connection.raw("SELECT nextval('plugins_ordering_spike_seq') AS value")).rows[0].value));
  assert.equal(new Set(values.map(Number)).size, 200);

  await assert.rejects(app.db.transaction(async ({ onCommit, onRollback }) => {
    onCommit(() => eventLog.push('commit'));
    onRollback(() => eventLog.push('rollback'));
    await app.db.query('plugin::ordering.order').create({ data: { code: `${code}-rollback`, locationRef: 'spike' } });
    throw new Error('expected rollback');
  }), /expected rollback/);
  assert.deepEqual(eventLog, ['rollback']);
  assert.equal(await app.db.query('plugin::ordering.order').count({ where: { code: `${code}-rollback` } }), 0);
  console.log('[spike] transaction row lock: 20/20; sequence: 200 unique; callbacks: commit/rollback API available');
} finally {
  await app.db.query('plugin::ordering.order').deleteMany({ where: { code: { $startsWith: code } } });
  await app.destroy();
}
