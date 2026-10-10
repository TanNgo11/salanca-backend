// O0 probe (check 4): two real OS processes claim the same outbox with FOR UPDATE SKIP LOCKED + lease.
// Worker B crashes after claiming a batch without delivering; once its lease expires worker A reclaims it.
// Exactly-once delivery is enforced by a unique delivery log (idempotent consumer).
// Run: node scripts/spike-ordering/dispatch-two-process.mjs   (needs the outbox table: run load.mjs once)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { SPIKE_DATABASE } from './runtime.mjs';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const TABLE = 'plugins_ordering_outbox';
const LOG = 'spike_o0_delivery_log';
const LEASE_SECONDS = 3;
const ROWS = 200;
const BATCH = 10;

const connect = async () => {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const host = process.env.DATABASE_HOST ?? '127.0.0.1';
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host), 'spike requires a loopback PostgreSQL host');
  const client = new Client({
    host, port: Number(process.env.DATABASE_PORT ?? 5432), user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD, database: SPIKE_DATABASE,
  });
  await client.connect();
  const { rows } = await client.query('SELECT current_database() AS name');
  assert.equal(rows[0].name, SPIKE_DATABASE);
  return client;
};

const claimBatch = async (client, owner) => {
  await client.query('BEGIN');
  const { rows } = await client.query(
    `SELECT id FROM ${TABLE}
      WHERE status = 'pending' OR (status = 'claimed' AND lease_until < NOW())
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1`, [BATCH]);
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await client.query(
      `UPDATE ${TABLE} SET status = 'claimed', owner = $1, lease_until = NOW() + ($2 || ' seconds')::interval,
              deliveries = deliveries + 1, updated_at = NOW() WHERE id = ANY($3)`, [owner, String(LEASE_SECONDS), ids]);
  }
  await client.query('COMMIT');
  return ids;
};

const deliver = async (client, owner, ids) => {
  for (const id of ids) {
    // Idempotent consumer: the unique key rejects a second delivery of the same event.
    await client.query(`INSERT INTO ${LOG} (outbox_id, owner) VALUES ($1, $2) ON CONFLICT (outbox_id) DO NOTHING`, [id, owner]);
    // Fencing: only the current lease owner may mark the row delivered.
    await client.query(`UPDATE ${TABLE} SET status = 'delivered', updated_at = NOW() WHERE id = $1 AND owner = $2`, [id, owner]);
  }
};

const worker = async (owner, crashAfterBatches) => {
  const client = await connect();
  let batches = 0;
  for (;;) {
    const ids = await claimBatch(client, owner);
    if (ids.length === 0) break;
    batches += 1;
    if (crashAfterBatches && batches === crashAfterBatches) {
      console.log(`[worker ${owner}] crash with ${ids.length} claimed rows`);
      process.exit(1); // no COMMIT of deliveries, lease left behind
    }
    await deliver(client, owner, ids);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await client.end();
};

const runChild = (owner, crashAfterBatches = 0) => new Promise((resolve) => {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'worker', owner, String(crashAfterBatches)], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code) => resolve({ owner, code, pid: child.pid }));
});

if (process.argv[2] === 'worker') {
  await worker(process.argv[3], Number(process.argv[4]));
} else {
  const client = await connect();
  try {
    await client.query(`DROP TABLE IF EXISTS ${LOG}`);
    await client.query(`CREATE TABLE ${LOG} (outbox_id integer PRIMARY KEY, owner text NOT NULL, delivered_at timestamptz DEFAULT NOW())`);
    await client.query(`DELETE FROM ${TABLE}`);
    for (let i = 0; i < ROWS; i += 1) {
      await client.query(
        `INSERT INTO ${TABLE} (document_id, event_id, status, deliveries, created_at, updated_at)
         VALUES (gen_random_uuid()::text, $1, 'pending', 0, NOW(), NOW())`, [`O0-2P-${i}`]);
    }

    const [a, b] = await Promise.all([runChild('A'), runChild('B', 2)]);
    console.log(`[spike] worker A pid ${a.pid} exit ${a.code}; worker B pid ${b.pid} exit ${b.code} (crashed)`);
    assert.equal(b.code, 1);

    const stuck = await client.query(`SELECT count(*)::int AS n FROM ${TABLE} WHERE status = 'claimed' AND owner = 'B'`);
    console.log(`[spike] rows left claimed by crashed worker B: ${stuck.rows[0].n}`);
    assert.ok(stuck.rows[0].n > 0, 'the crash must leave leased rows behind');

    await new Promise((resolve) => setTimeout(resolve, (LEASE_SECONDS + 1) * 1000));
    const again = await runChild('A2');
    assert.equal(again.code, 0);

    const status = await client.query(`SELECT status, count(*)::int AS n FROM ${TABLE} GROUP BY status`);
    const delivered = await client.query(`SELECT count(*)::int AS n, count(DISTINCT outbox_id)::int AS uniq FROM ${LOG}`);
    const reclaimed = await client.query(`SELECT count(*)::int AS n FROM ${TABLE} WHERE deliveries > 1`);
    console.log('[spike] outbox status:', JSON.stringify(status.rows));
    assert.deepEqual(status.rows, [{ status: 'delivered', n: ROWS }]);
    assert.equal(delivered.rows[0].n, ROWS);
    assert.equal(delivered.rows[0].uniq, ROWS);
    assert.ok(reclaimed.rows[0].n > 0, 'some rows must have been reclaimed after lease expiry');
    console.log(`[spike] two processes: ${ROWS}/${ROWS} delivered exactly once; ${reclaimed.rows[0].n} rows reclaimed after the crashed worker's ${LEASE_SECONDS}s lease expired`);
  } finally {
    await client.query(`DELETE FROM ${TABLE}`);
    await client.query(`DROP TABLE IF EXISTS ${LOG}`);
    await client.end();
  }
}
