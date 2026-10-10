import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadSpikeApp } from './runtime.mjs';

const app = await loadSpikeApp();
const table = 'plugins_ordering_outbox';
const ownerA = randomUUID(), ownerB = randomUUID();
const now = new Date();
try {
  await app.db.connection(table).del();
  await app.db.connection(table).insert(Array.from({ length: 100 }, (_, i) => ({
    document_id: randomUUID(), event_id: `O0-EVENT-${i}-${randomUUID()}`, status: 'pending', deliveries: 0,
    created_at: now, updated_at: now,
  })));
  const claim = async (owner) => app.db.transaction(async ({ trx }) => {
    const rows = await trx(table).select('id').where((query) => query.where('status', 'pending').orWhere((q) => q.where('status', 'claimed').andWhere('lease_until', '<', trx.fn.now()))).forUpdate().skipLocked().limit(1);
    if (rows.length === 0) return null;
    await trx(table).where({ id: rows[0].id }).update({ status: 'claimed', owner, lease_until: trx.raw("NOW() + interval '30 seconds'"), deliveries: trx.raw('deliveries + 1'), updated_at: trx.fn.now() });
    return rows[0].id;
  });
  const claimed = await Promise.all(Array.from({ length: 100 }, (_, i) => claim(i % 2 ? ownerA : ownerB)));
  assert.equal(new Set(claimed.filter(Boolean)).size, 100);
  const duplicateOwners = await app.db.connection(table).select('id').groupBy('id').havingRaw('count(*) > 1');
  assert.equal(duplicateOwners.length, 0);
  console.log('[spike] dispatch claim: 100/100 rows, no duplicate claims, FOR UPDATE SKIP LOCKED + 30s lease');
} finally { await app.db.connection(table).del(); await app.destroy(); }
