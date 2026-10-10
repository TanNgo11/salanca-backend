import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadSpikeApp } from './runtime.mjs';

const app = await loadSpikeApp();
const code = `O0-MW-${randomUUID()}`;
try {
  const created = await app.db.query('plugin::ordering.order').create({ data: { code, locationRef: 'spike', counter: 0 } });
  await assert.rejects(app.documents('plugin::ordering.order').update({ documentId: created.documentId, data: { counter: 1 } }), /must use the ordering service/);
  await app.db.query('plugin::ordering.order').update({ where: { documentId: created.documentId }, data: { counter: 2 } });
  const row = await app.db.query('plugin::ordering.order').findOne({ where: { documentId: created.documentId } });
  assert.equal(row.counter, 2);
  console.log('[spike] Document Service middleware blocked update; db.query bypass confirmed');
} finally { await app.db.query('plugin::ordering.order').deleteMany({ where: { code } }); await app.destroy(); }
