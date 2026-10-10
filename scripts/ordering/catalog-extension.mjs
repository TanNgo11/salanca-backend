// Verifies the app-side extension point: src/extensions/ordering/strapi-server.ts adds
// `isFeatured` to the plugin's catalog-product by code (no schema.json copy). The column
// must sync on boot and keep its value across two restarts — i.e. the extension field
// behaves like any schema attribute. Run: node scripts/ordering/catalog-extension.mjs
import assert from 'node:assert/strict';

import { bootOrderingTestApp, resetOrderingTables } from './_harness.mjs';

const TABLE = 'plugins_ordering_catalog_product';
const PRODUCT_UID = 'plugin::ordering.catalog-product';

const destroy = async (app) => {
  try {
    await app.destroy();
  } catch (error) {
    console.error('[ordering-test] destroy failed (ignored):', error?.message ?? error);
  }
};

const isFeaturedOf = async (app, documentId) =>
  app.db.connection(TABLE).select('is_featured').where({ document_id: documentId }).first();

let app;
try {
  // Boot 1: schema sync must create the app-added column on the plugin table.
  app = await bootOrderingTestApp();
  await resetOrderingTables(app);
  assert.ok(
    await app.db.connection.schema.hasColumn(TABLE, 'is_featured'),
    'extension column is_featured must exist on the catalog product table',
  );
  const product = app.documents(PRODUCT_UID);
  const created = await product.create({
    data: {
      name: { vi: 'Món nổi bật thử nghiệm' },
      productType: 'food',
      status: 'active',
      sellOnline: true,
      isFeatured: true,
    },
  });
  assert.equal(
    (await isFeaturedOf(app, created.documentId))?.is_featured,
    true,
    'extension value written on boot 1',
  );
  await destroy(app);
  app = null;

  // Boot 2 (restart 1): column AND value survive.
  app = await bootOrderingTestApp();
  assert.ok(await app.db.connection.schema.hasColumn(TABLE, 'is_featured'), 'column survives restart 1');
  assert.equal(
    (await isFeaturedOf(app, created.documentId))?.is_featured,
    true,
    'value survives restart 1',
  );
  await destroy(app);
  app = null;

  // Boot 3 (restart 2): still there — schema sync does not drop the app-owned column.
  app = await bootOrderingTestApp();
  assert.ok(await app.db.connection.schema.hasColumn(TABLE, 'is_featured'), 'column survives restart 2');
  assert.equal(
    (await isFeaturedOf(app, created.documentId))?.is_featured,
    true,
    'value survives restart 2',
  );
  console.log('[ordering-test] catalog-extension: is_featured persisted across 2 restarts');
} catch (error) {
  process.exitCode = 1;
  console.error('[ordering-test] failed:', error?.message ?? error);
  throw error;
} finally {
  if (app) await destroy(app);
}
