import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

export const SPIKE_DATABASE = 'salanca_ordering_spike';

/** All spike entry points use this before Strapi loads config or touches a database. */
export function configureSpikeEnvironment(enabled = true) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const host = process.env.DATABASE_HOST ?? '127.0.0.1';
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host), 'spike requires a loopback PostgreSQL host');
  assert.ok(!process.env.DATABASE_URL, 'DATABASE_URL is forbidden for spike scripts');
  process.env.DATABASE_NAME = SPIKE_DATABASE;
  process.env.DATABASE_SCHEMA = 'public';
  process.env.NODE_ENV = 'development';
  process.env.HOST = '127.0.0.1';
  process.env.ORDERING_ENABLED = String(enabled);
  process.env.ORDERING_SPIKE_ENABLED = String(enabled);
  process.env.ORDERING_SPIKE_SECRET ??= randomBytes(32).toString('hex');
  process.env.AUDIT_IDENTIFIER_HASH_SECRET ??= randomBytes(32).toString('hex');
  process.env.S3_BUCKET = '';
  process.env.EMAIL_SMTP_HOST = '';
  process.env.CMS_WEBHOOK_URL = '';
  process.env.CMS_WEBHOOK_ENABLED = 'false';
  process.env.STRAPI_TELEMETRY_DISABLED = 'true';
}

const require = createRequire(import.meta.url);
export const strapiRequire = createRequire(require.resolve('@strapi/strapi/package.json'));

export async function loadSpikeApp(enabled = true) {
  configureSpikeEnvironment(enabled);
  const { compileStrapi, createStrapi } = strapiRequire('@strapi/core');
  const app = createStrapi(await compileStrapi());
  try {
    await app.load();
    const { rows } = await app.db.connection.raw('SELECT current_database() AS name');
    assert.equal(rows[0].name, SPIKE_DATABASE, 'connected database must be the spike database');
    return app;
  } catch (error) {
    await app.destroy();
    throw error;
  }
}
