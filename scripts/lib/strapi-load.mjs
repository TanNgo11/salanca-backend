import { createRequire } from 'node:module';

// Resolve @strapi/core from @strapi/strapi's dependency tree (pnpm does not
// hoist it to the project root).
const projectRequire = createRequire(import.meta.url);
const strapiRequire = createRequire(projectRequire.resolve('@strapi/strapi/package.json'));
const { compileStrapi, createStrapi } = strapiRequire('@strapi/core');

/**
 * Loads a Strapi application instance (Document Service ready, HTTP not started).
 */
export async function loadStrapiApp() {
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  return app;
}
