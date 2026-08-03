import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compileStrapi, createStrapi } = require('@strapi/core');

/**
 * Loads a Strapi application instance (Document Service ready, HTTP not started).
 */
export async function loadStrapiApp() {
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  return app;
}
