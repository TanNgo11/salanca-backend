import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Harness for seo-toolkit integration scripts. Boots a real Strapi against a dedicated loopback
 * database (`SEO_TOOLKIT_TEST_DATABASE`, default `salanca_seo_test`), never the dev database.
 * Deliberately independent of `scripts/ordering/_harness.mjs` so the seo-toolkit never depends on
 * the ordering plugin. Logs go to `[seo-toolkit-test]` and never contain emails or tokens.
 */
export const TEST_DATABASE = process.env.SEO_TOOLKIT_TEST_DATABASE ?? 'salanca_seo_test';

export function configureTestEnvironment() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const host = process.env.DATABASE_HOST ?? '127.0.0.1';
  assert.ok(
    ['localhost', '127.0.0.1', '::1'].includes(host),
    'seo-toolkit test scripts require a loopback PostgreSQL host',
  );
  assert.ok(!process.env.DATABASE_URL, 'DATABASE_URL is forbidden for seo-toolkit test scripts');
  process.env.DATABASE_NAME = TEST_DATABASE;
  process.env.DATABASE_SCHEMA = 'public';
  process.env.NODE_ENV = 'development';
  process.env.HOST = '127.0.0.1';
  process.env.SEO_TOOLKIT_ENABLED = 'true';
  process.env.ORDERING_ENABLED = 'false';
  delete process.env.ORDERING_TEST_BUILTINS;
  process.env.AUDIT_IDENTIFIER_HASH_SECRET ??= randomBytes(32).toString('hex');
  process.env.S3_BUCKET = '';
  process.env.EMAIL_SMTP_HOST = '';
  process.env.CMS_WEBHOOK_URL = '';
  process.env.CMS_WEBHOOK_ENABLED = 'false';
  process.env.STRAPI_TELEMETRY_DISABLED = 'true';
  process.env.PORT ??= String(1500 + (process.pid % 500));
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
      console.log(`[seo-toolkit-test] created database ${TEST_DATABASE}`);
    }
  } finally {
    await client.end();
  }
}

export async function bootSeoToolkitTestApp() {
  configureTestEnvironment();
  await ensureTestDatabase();
  const { compileStrapi, createStrapi } = strapiRequire('@strapi/core');
  const app = createStrapi(await compileStrapi());
  try {
    await app.load();
    // Test runs purge admin users, so Strapi sees a fresh install and would open a browser tab
    // on app.listen() in development. Never open one from a script.
    app.config.set('admin.autoOpen', false);
    const { rows } = await app.db.connection.raw('SELECT current_database() AS name');
    assert.equal(
      rows[0].name,
      TEST_DATABASE,
      'connected database must be the seo-toolkit test database',
    );
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

/** Boots, runs `fn(app)` and always destroys. Failures set the exit code and rethrow. */
export async function withApp(fn) {
  let app;
  try {
    app = await bootSeoToolkitTestApp();
    console.log(`[seo-toolkit-test] app booted on ${TEST_DATABASE}`);
    await fn(app);
    console.log('[seo-toolkit-test] done');
  } catch (error) {
    process.exitCode = 1;
    console.error('[seo-toolkit-test] failed:', error?.message ?? error);
    throw error;
  } finally {
    if (app) {
      try {
        await app.destroy();
      } catch (error) {
        console.error('[seo-toolkit-test] destroy failed (ignored):', error?.message ?? error);
      }
    }
  }
}

export const SEO_TOOLKIT_ACTION = 'plugin::seo-toolkit.audit.run';

/**
 * HTTP-level admin fixtures: a non-super-admin role holding `actions` (none by default) and one
 * staff user with that role. `login` returns a Bearer token from POST /admin/login, so the route
 * policies (`admin::isAuthenticatedAdmin`, `admin::hasPermissions`) run for real. Requires
 * `app.listen()` first. The `call` helper targets the plugin admin prefix (`/seo-toolkit`).
 */
export async function seedAdminHttpStaff(app, { actions = [] } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const role = await app.admin.services.role.create({
    name: `seo-toolkit-test-${suffix}`,
    description: 'seo-toolkit integration test role',
  });
  if (actions.length > 0) {
    await app.admin.services.role.assignPermissions(
      role.id,
      actions.map((action) => ({ action, subject: null, properties: {}, conditions: [] })),
    );
  }
  const password = `Test-${randomUUID()}-Aa1`;
  const user = await app.admin.services.user.create({
    firstname: 'seo',
    lastname: 'HTTP',
    email: `seo-http-${suffix}@example.invalid`,
    password,
    isActive: true,
    registrationToken: null,
    roles: [role.id],
  });
  const base = `http://127.0.0.1:${process.env.PORT}`;
  const login = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password }),
  });
  assert.equal(login.status, 200, 'admin login must succeed');
  const token = (await login.json()).data.token;
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/seo-toolkit${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return {
    role,
    user,
    as: call,
    token,
    async cleanup() {
      await app.admin.services.user.deleteById(user.id).catch(() => undefined);
      await app.admin.services.role.deleteByIds([role.id]).catch(() => undefined);
    },
  };
}
