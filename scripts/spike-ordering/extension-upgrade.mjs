// O0 probe (check 18): an app-added attribute (src/extensions/ordering/strapi-server.ts adds
// catalog-product.isFeatured) survives a plugin upgrade that adds its own attribute.
// Each "plugin version" boots in its own process because Node caches the plugin module.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadSpikeApp } from './runtime.mjs';

const TABLE = 'plugins_ordering_catalog_product';
const MARK = 'o0-upgrade-probe';

const columns = async (app) => (await app.db.connection.raw(
  'SELECT column_name FROM information_schema.columns WHERE table_name = ?', [TABLE])).rows.map((r) => r.column_name);

const phase = process.argv[2];
if (phase === 'v1' || phase === 'v2') {
  if (phase === 'v2') process.env.ORDERING_SPIKE_SCHEMA_V2 = 'true';
  const app = await loadSpikeApp();
  try {
    const cols = await columns(app);
    assert.ok(cols.includes('is_featured'), 'app extension column exists');
    if (phase === 'v1') {
      await app.db.connection(TABLE).whereRaw("slug->>'vi' = ?", [MARK]).del();
      await app.db.query('plugin::ordering.catalog-product').create({
        data: { name: { vi: 'Nâng cấp', en: 'Upgrade' }, slug: { vi: MARK }, isFeatured: true },
      });
    } else {
      assert.ok(cols.includes('upgrade_marker'), 'plugin v2 attribute was added');
      const row = await app.db.connection(TABLE).whereRaw("slug->>'vi' = ?", [MARK]).first();
      assert.equal(row?.is_featured, true, 'app field value kept across the plugin upgrade');
      await app.db.connection(TABLE).whereRaw("slug->>'vi' = ?", [MARK]).del();
    }
    console.log(`[spike] ${phase}: columns ok (${cols.filter((c) => ['is_featured', 'upgrade_marker'].includes(c)).join(', ')})`);
  } finally {
    await app.destroy();
  }
} else {
  for (const step of ['v1', 'v2']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), step], { encoding: 'utf8' });
    const lines = `${result.stdout}${result.stderr}`.split('\n').filter((l) => l.includes('[spike]') || l.includes('Error'));
    console.log(lines.join('\n'));
    assert.equal(result.status, 0, `${step} failed`);
  }
  console.log('[spike] extension: app-added isFeatured column and value survive a plugin upgrade that adds upgradeMarker');
}
