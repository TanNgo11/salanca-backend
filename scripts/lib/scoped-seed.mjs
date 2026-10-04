import { resolve } from 'node:path';
import { loadStrapiApp } from './strapi-load.mjs';

/** Backend root, whether npm was started from /app or this script's folder. */
export const backendRoot = resolve(import.meta.dirname, '../..');

export function applyRequested() {
  if (process.argv.includes('--prune')) {
    throw new Error('These seeds never prune.');
  }
  return process.argv.includes('--apply');
}

/**
 * Runs `work` against one Strapi app, then closes the database pool.
 * `work` must throw before any write when the destination is unsafe.
 */
export async function withStrapi(work) {
  process.chdir(backendRoot);
  const app = await loadStrapiApp();
  try {
    return await work(app);
  } finally {
    const pool = app.db.connection.client.pool;
    const deadline = Date.now() + 10000;
    let idleTurns = 0;
    while (idleTurns < 2) {
      await new Promise((done) => setImmediate(done));
      if (pool.numUsed() === 0 && pool.numPendingAcquires() === 0) idleTurns += 1;
      else {
        idleTurns = 0;
        if (Date.now() > deadline) throw new Error('Pending database events; shutdown withheld.');
        await new Promise((done) => setTimeout(done, 50));
      }
    }
    await app.destroy();
  }
}

/**
 * One published single type, and no newer draft. Publishing writes the whole
 * locale, so a draft saved after the last publish would go live too.
 */
export async function requirePublishedSingle(app, uid, locale) {
  const published = await app.documents(uid).findMany({ locale, status: 'published', limit: 2 });
  if (published.length !== 1) {
    throw new Error(`Expected exactly one published ${uid}/${locale}. Refusing to create a document.`);
  }
  const drafts = await app.documents(uid).findMany({ locale, status: 'draft', limit: 2 });
  const draft = drafts.find((row) => row.documentId === published[0].documentId);
  if (draft && new Date(draft.updatedAt).getTime() > new Date(published[0].updatedAt).getTime()) {
    throw new Error(
      `Unpublished edits on ${uid}/${locale}. Publish or discard them in admin before this seed. No content written.`,
    );
  }
  return published[0];
}
