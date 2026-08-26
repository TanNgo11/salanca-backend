/**
 * Creates (or reuses) the read-only Strapi API token the frontend needs for
 * draft preview, then prints the value once.
 *
 * The token is only readable at creation time — Strapi stores a hash. Re-running
 * with an existing token prints nothing usable, so pass --rotate to replace it.
 *
 * Usage:
 *   node scripts/create-preview-token.mjs [--rotate]
 *
 * Copy the printed value into salanca-web/.env.local as STRAPI_PREVIEW_TOKEN.
 */
import { loadStrapiApp } from './lib/strapi-load.mjs';

const TOKEN_NAME = 'salanca-web-preview';
const rotate = process.argv.includes('--rotate');

const app = await loadStrapiApp();

try {
  const service = app.service('admin::api-token');
  const existing = await service.getByName(TOKEN_NAME);

  if (existing && !rotate) {
    console.error(
      `Token "${TOKEN_NAME}" already exists (id=${existing.id}). ` +
        'Its value is hashed and cannot be re-read. Run with --rotate to replace it.',
    );
    process.exitCode = 1;
  } else {
    if (existing) {
      await service.revoke(existing.id);
      console.error(`Revoked previous token id=${existing.id}.`);
    }

    const created = await service.create({
      name: TOKEN_NAME,
      description:
        'Read-only token for salanca-web draft preview (STRAPI_PREVIEW_TOKEN).',
      type: 'read-only',
      lifespan: null,
    });

    console.error('Add this to salanca-web/.env.local:');
    console.log(`STRAPI_PREVIEW_TOKEN=${created.accessKey}`);
  }
} catch (error) {
  console.error('create-preview-token failed');
  console.error(error);
  process.exitCode = 1;
} finally {
  await app.destroy().catch((destroyError) => {
    console.warn('shutdown warning:', destroyError?.message ?? destroyError);
  });
  process.exit(process.exitCode ?? 0);
}
