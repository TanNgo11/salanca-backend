// Phase O0 spike: boot Strapi with the ordering plugin and report lifecycle + registry state.
// Run: DATABASE_NAME=salanca_ordering_spike ORDERING_ENABLED=true node scripts/spike-ordering/load.mjs
import assert from 'node:assert/strict';
import { loadSpikeApp } from './runtime.mjs';

const app = await loadSpikeApp();
try {
  const plugin = app.plugin('ordering');
  assert.ok(plugin, 'ordering plugin is loaded');
  const registry = plugin.service('registry');
  assert.deepEqual(registry.lifecycle(), ['plugin.register', 'app.register', 'plugin.bootstrap', 'app.bootstrap']);
  assert.equal(registry.appEvents().length, 1, 'app listener receives plugin event');
  console.log('[spike] catalog adapters:', registry.catalogAdapterCodes().join(', '));
  console.log('[spike] lifecycle:', registry.lifecycle().join(' → '));
  console.log('[spike] app event bridge: passed');
} finally {
  await app.destroy();
}
