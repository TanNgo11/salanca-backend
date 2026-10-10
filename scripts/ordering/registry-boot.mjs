// O1 registry check: (a) builtins registered under ORDERING_TEST_BUILTINS, (b) bootstrap
// refuses to start when config enables a code nothing registered.
import assert from 'node:assert/strict';

import {
  configureTestEnvironment,
  ensureTestDatabase,
  strapiRequire,
  withApp,
} from './_harness.mjs';

await withApp(async (app) => {
  const registry = app.plugin('ordering').service('registry');

  assert.ok(registry.hasProductType('test-food'), 'test-food product type missing');
  assert.ok(registry.hasProductType('test-service'), 'test-service product type missing');
  assert.ok(registry.hasPaymentProvider('test'), 'test payment provider missing');
  assert.ok(registry.hasCatalogAdapter('test-catalog'), 'test-catalog adapter missing');
  assert.ok(registry.hasCatalogAdapter('ordering-catalog'), 'ordering-catalog stub missing');
  assert.equal(registry.catalogAdapter('test-catalog').code, 'test-catalog');
  assert.equal(registry.workflows().length, 3, 'expected 3 built-in workflows');
  assert.ok(registry.workflow('pickup-pay-on-pickup', '1'));
  assert.equal(registry.outboxConsumers('test.ping').length, 1, 'test.ping consumer missing');

  console.log('[ordering-test] product types:', registry.productTypeCodes().join(', '));
  console.log('[ordering-test] catalog adapters:', registry.catalogAdapterCodes().join(', '));
  console.log('[ordering-test] payment providers:', registry.paymentProviderCodes().join(', '));
  console.log(
    '[ordering-test] workflows:',
    registry.workflows().map((workflow) => `${workflow.name}@${workflow.version}`).join(', '),
  );
});

// Bootstrap must stop when the config enables a code nothing registered (validator cannot
// know codes; only bootstrap can).
configureTestEnvironment();
await ensureTestDatabase();
const { compileStrapi, createStrapi } = strapiRequire('@strapi/core');
const app = createStrapi(await compileStrapi());
try {
  await app.register();
  app.config.set('plugin::ordering.productTypes', { ghost: { enabled: true } });
  await assert.rejects(app.bootstrap(), /ghost/);
  console.log('[ordering-test] bootstrap rejects an enabled but unregistered product type: passed');
} finally {
  try {
    await app.destroy();
  } catch (error) {
    console.error('[ordering-test] destroy failed (ignored):', error?.message ?? error);
  }
}
