import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

export const TEST_DATABASE = 'salanca_ordering_test';

/**
 * Shared harness for ordering integration scripts. Boots a real Strapi against a dedicated
 * loopback database, never the dev or production database. Logs go to `[ordering-test]` and
 * must never contain names, phones, emails, addresses or tokens.
 */
export function configureTestEnvironment() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const host = process.env.DATABASE_HOST ?? '127.0.0.1';
  assert.ok(
    ['localhost', '127.0.0.1', '::1'].includes(host),
    'ordering test scripts require a loopback PostgreSQL host',
  );
  assert.ok(!process.env.DATABASE_URL, 'DATABASE_URL is forbidden for ordering test scripts');
  process.env.DATABASE_NAME = TEST_DATABASE;
  process.env.DATABASE_SCHEMA = 'public';
  process.env.NODE_ENV = 'development';
  process.env.HOST = '127.0.0.1';
  process.env.ORDERING_ENABLED = 'true';
  process.env.ORDERING_TEST_BUILTINS = 'true';
  process.env.AUDIT_IDENTIFIER_HASH_SECRET ??= randomBytes(32).toString('hex');
  process.env.S3_BUCKET = '';
  process.env.EMAIL_SMTP_HOST = '';
  process.env.CMS_WEBHOOK_URL = '';
  process.env.CMS_WEBHOOK_ENABLED = 'false';
  process.env.STRAPI_TELEMETRY_DISABLED = 'true';
  process.env.PORT ??= String(1400 + (process.pid % 500));
}

const require = createRequire(import.meta.url);
export const strapiRequire = createRequire(require.resolve('@strapi/strapi/package.json'));

/** Creates TEST_DATABASE on the configured loopback server when it does not exist yet. */
export async function ensureTestDatabase() {
  const { Client } = require('pg');
  const client = new Client({
    host: process.env.DATABASE_HOST ?? '127.0.0.1',
    port: Number(process.env.DATABASE_PORT ?? 5432),
    database: 'postgres',
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
  });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      TEST_DATABASE,
    ]);
    if (rows.length === 0) {
      await client.query(`CREATE DATABASE ${TEST_DATABASE} TEMPLATE template0 ENCODING 'UTF8'`);
      console.log(`[ordering-test] created database ${TEST_DATABASE}`);
    }
  } finally {
    await client.end();
  }
}

export async function bootOrderingTestApp() {
  configureTestEnvironment();
  await ensureTestDatabase();
  const { compileStrapi, createStrapi } = strapiRequire('@strapi/core');
  const app = createStrapi(await compileStrapi());
  try {
    await app.load();
    const { rows } = await app.db.connection.raw('SELECT current_database() AS name');
    assert.equal(rows[0].name, TEST_DATABASE, 'connected database must be the ordering test database');
    return app;
  } catch (error) {
    try {
      await app.destroy();
    } catch {
      // The boot aborted before the app was fully loaded; ignore teardown errors.
    }
    throw error;
  }
}

/** Empties every plugin table (keeping the migrations ledger) and rewinds the code sequence. */
export async function resetOrderingTables(app) {
  const rows = await app.db
    .connection('information_schema.tables')
    .select('table_name')
    .where('table_schema', 'public')
    .where('table_name', 'like', 'plugins_ordering_%')
    .whereNot('table_name', 'plugins_ordering_migrations');
  if (rows.length > 0) {
    const names = rows.map((row) => `"${row.table_name}"`).join(', ');
    await app.db.connection.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
    console.log(`[ordering-test] truncated ${rows.length} ordering tables`);
  }
  await app.db.connection.raw(
    'ALTER SEQUENCE IF EXISTS plugins_ordering_order_code_seq RESTART WITH 1',
  );
}

/** Boots, resets, runs `fn(app)` and always destroys. Failures set the exit code and rethrow. */
export async function withApp(fn) {
  let app;
  try {
    app = await bootOrderingTestApp();
    await resetOrderingTables(app);
    console.log(`[ordering-test] app booted on ${TEST_DATABASE}`);
    await fn(app);
    console.log('[ordering-test] done');
  } catch (error) {
    process.exitCode = 1;
    console.error('[ordering-test] failed:', error?.message ?? error);
    throw error;
  } finally {
    if (app) {
      try {
        await app.destroy();
      } catch (error) {
        console.error('[ordering-test] destroy failed (ignored):', error?.message ?? error);
      }
    }
  }
}
