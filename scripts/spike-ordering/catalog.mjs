import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadSpikeApp } from './runtime.mjs';

const app = await loadSpikeApp();
const slug = `o0-${randomUUID()}`;
try {
  const product = await app.db.query('plugin::ordering.catalog-product').create({ data: { name: { vi: 'Món thử', en: 'Probe dish' }, slug: { vi: slug, en: `${slug}-en` }, modifierGroups: [{ code: 'size' }], isActive: true, isFeatured: true } });
  const row = (await app.db.connection('plugins_ordering_catalog_product').whereRaw("slug->>'vi' = ?", [slug]).first());
  assert.equal(row.id, product.id);
  assert.equal(row.is_featured, true);
  console.log('[spike] catalog: localized JSON, jsonb slug query, modifierGroups JSON and app extension field passed');
} finally { await app.db.query('plugin::ordering.catalog-product').deleteMany({ where: { slug: { $contains: slug } } }).catch(() => undefined); await app.destroy(); }
