/**
 * Idempotent demo seed for Salanca CMS content.
 * Safe to re-run: upserts by slug (collections) or singleton (single types).
 *
 * Usage: npm run seed:demo
 *
 * Layout (BDS-style modules, plain ESM — no jiti required):
 *   builders / media / location / menu / campaigns / gallery / global / pages
 */
import { createSummary } from '../lib/seed-document.mjs';
import { loadStrapiApp } from '../lib/strapi-load.mjs';
import { seedCampaigns } from './campaigns.mjs';
import { seedGallery } from './gallery.mjs';
import { seedGlobalSetting } from './global.mjs';
import { seedLocation } from './location.mjs';
import { ensureDemoMedia } from './media.mjs';
import { seedMenu } from './menu.mjs';
import { seedPages } from './pages.mjs';

const summary = createSummary();
const app = await loadStrapiApp();

try {
  const mediaId = await ensureDemoMedia(app, summary);
  const locationVi = await seedLocation(app, summary, mediaId);
  const { pkg } = await seedMenu(app, summary, mediaId);
  await seedCampaigns(app, summary, mediaId);
  await seedGallery(app, summary, mediaId, locationVi.documentId);
  await seedGlobalSetting(app, summary, locationVi.documentId);
  await seedPages(app, summary, mediaId, pkg.documentId);

  console.log(`seed:demo complete — ${summary.toString()}`);
} catch (error) {
  console.error('seed:demo failed');
  console.error(error);
  if (error?.details?.errors) {
    console.error('validation details:', JSON.stringify(error.details.errors, null, 2));
  }
  process.exitCode = 1;
} finally {
  // Strapi/pg pool sometimes aborts in-flight clients during destroy on Windows.
  await app.destroy().catch((destroyError) => {
    console.warn('seed:demo shutdown warning:', destroyError?.message ?? destroyError);
  });
  process.exit(process.exitCode ?? 0);
}
