import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
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

/** System actor for service calls — unscoped, never used for staff-only flows. */
export const systemCtx = { actor: { kind: 'system' } };

export const services = (app) => {
  const plugin = app.plugin('ordering');
  return {
    registry: plugin.service('registry'),
    scope: plugin.service('scope'),
    idempotency: plugin.service('idempotency'),
    order: plugin.service('order'),
    transition: plugin.service('transition'),
    payment: plugin.service('payment'),
    refund: plugin.service('refund'),
    timeline: plugin.service('timeline'),
    hold: plugin.service('hold'),
    outbox: plugin.service('outbox'),
  };
};

/** Two branches: Q1 plain, Q3 with cash rounding to 1000 on the `test` provider. */
export async function seedBranches(app) {
  const branches = () => app.db.query('plugin::ordering.branch');
  const base = (code, vi, en, extra = {}) => ({
    code,
    name: { vi, en },
    timezone: 'Asia/Ho_Chi_Minh',
    isActive: true,
    onlineOrdering: true,
    rank: 0,
    fulfillment: {
      pickup: {
        enabled: true,
        paymentTiming: 'pay-on-pickup',
        schedule: { businessDayPolicy: { cutoffLocalTime: '04:00' } },
      },
    },
    ...extra,
  });
  const Q1 = await branches().create({ data: base('Q1', 'Quận 1', 'District 1') });
  const Q3 = await branches().create({
    data: base('Q3', 'Quận 3', 'District 3', {
      cashRounding: { enabled: true, multiple: 1000, providerCodes: ['test'] },
    }),
  });
  console.log('[ordering-test] seeded branches Q1, Q3');
  return { Q1, Q3 };
}

const sellable = (overrides) => ({
  requiresShipping: false,
  isVirtual: false,
  isDownloadable: false,
  isGiftCard: false,
  fulfillmentKinds: ['pickup', 'delivery'],
  options: [],
  availability: {},
  categories: [{ ref: 'mon-chinh', title: 'Món chính', path: ['mon-chinh'] }],
  isActive: true,
  purchasable: true,
  ...overrides,
});

/** Test menu into the `test-catalog` adapter (registered via ORDERING_TEST_BUILTINS). */
export function seedMenu(app) {
  // createOrder reads the adapter code from config at call time; point it at the seeded catalog.
  app.config.set('plugin::ordering.catalog.adapter', 'test-catalog');
  const adapter = app.plugin('ordering').service('registry').catalogAdapter('test-catalog');
  adapter.seed([
    sellable({
      ref: { uid: 'bun-bo' },
      productType: 'test-food',
      title: 'Bún bò',
      listPrice: { amount: 65000, currency: 'VND' },
      options: [
        {
          uid: 'size',
          name: 'Size',
          required: false,
          defaultOptionUids: [],
          minQuantity: 0,
          maxQuantity: 1,
          stepQuantity: 1,
          freeQuantity: 0,
          options: [
            { uid: 'lon', name: 'Lớn', unitPriceDelta: { amount: 10000, currency: 'VND' }, isActive: true },
          ],
        },
      ],
    }),
    sellable({
      ref: { uid: 'tra-dao' },
      productType: 'test-food',
      title: 'Trà đào',
      listPrice: { amount: 45000, currency: 'VND' },
    }),
    sellable({
      ref: { uid: 'goi-cuon' },
      productType: 'test-food',
      title: 'Gỏi cuốn',
      listPrice: { amount: 15000, currency: 'VND' },
    }),
    sellable({
      ref: { uid: 'cat-toc' },
      productType: 'test-service',
      title: 'Cắt tóc',
      listPrice: { amount: 200000, currency: 'VND' },
      fulfillmentKinds: ['appointment'],
      categories: [{ ref: 'dich-vu', title: 'Dịch vụ', path: ['dich-vu'] }],
    }),
  ]);
  console.log('[ordering-test] seeded test-catalog menu');
}

/** Staff users + scope rows: lan [Q1], minh [Q1,Q3], keToan all, moi unscoped. */
export async function seedStaff(app) {
  const scopeService = services(app).scope;
  const suffix = randomUUID().slice(0, 8);
  const makeUser = async (name) =>
    app.admin.services.user.create({
      firstname: name,
      lastname: 'O1',
      email: `o1-${name}-${suffix}@example.invalid`,
      isActive: true,
      registrationToken: null,
      roles: [],
    });
  const [lan, minh, keToan, moi] = await Promise.all([
    makeUser('lan'),
    makeUser('minh'),
    makeUser('ketoan'),
    makeUser('moi'),
  ]);
  const scopes = app.db.query('plugin::ordering.staff-location-scope');
  await scopes.create({ data: { adminUserId: lan.id, allLocations: false, locationRefs: ['Q1'] } });
  await scopes.create({
    data: { adminUserId: minh.id, allLocations: false, locationRefs: ['Q1', 'Q3'] },
  });
  await scopes.create({ data: { adminUserId: keToan.id, allLocations: true, locationRefs: [] } });
  const withActor = async (user) => ({
    user,
    actor: await scopeService.actorFromAdminUser(user),
  });
  const staff = {
    lan: await withActor(lan),
    minh: await withActor(minh),
    keToan: await withActor(keToan),
    moi: await withActor(moi),
  };
  console.log('[ordering-test] seeded staff lan[Q1] minh[Q1,Q3] keToan[all] moi[none]');
  return staff;
}

export async function cleanupStaff(app, staff) {
  for (const { user } of Object.values(staff)) {
    await app.admin.services.user.deleteById(user.id).catch(() => undefined);
  }
}

/** Valid createOrder input against Q1 mirroring the mockup cart (−25k discount, 195000). */
export function basicOrderInput(overrides = {}) {
  return {
    idempotencyKey: randomUUID(),
    locationRef: 'Q1',
    locale: 'vi',
    lines: [
      { sellableUid: 'bun-bo', quantity: 2 },
      { sellableUid: 'tra-dao', quantity: 1 },
      { sellableUid: 'goi-cuon', quantity: 3 },
    ],
    receiveMethod: { kind: 'pickup', locationRef: 'Q1' },
    contact: { name: 'Khách test', phone: '+84900000001' },
    consent: { policyVersion: 'v1', channel: 'web-checkout' },
    adjustments: [{ kind: 'discount', code: 'test-25k', label: 'Giảm test 25k', amount: -25000 }],
    fulfillmentAmount: 0,
    origin: { kind: 'storefront' },
    ...overrides,
  };
}
