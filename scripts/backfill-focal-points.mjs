/**
 * Backfills NULL focal points on shared.image component rows written before
 * focalPointX/Y existed. Strapi's schema sync adds the columns but does not
 * populate them, so an old row stays NULL: the public API exposes null, and the
 * next editor save of the parent entry fails the `required` rule.
 *
 * Idempotent — a second run reports 0 rows. Usage: pnpm run backfill:focal-points
 */
import { loadStrapiApp } from './lib/strapi-load.mjs';

const TABLE = 'components_shared_images';
const DEFAULT_FOCAL = 50;

const app = await loadStrapiApp();

try {
  const knex = app.db.connection;

  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) {
    console.log(`Table ${TABLE} does not exist yet — nothing to backfill.`);
  } else {
    const updated = await knex(TABLE)
      .whereNull('focal_point_x')
      .orWhereNull('focal_point_y')
      .update({
        focal_point_x: knex.raw('COALESCE(focal_point_x, ?)', [DEFAULT_FOCAL]),
        focal_point_y: knex.raw('COALESCE(focal_point_y, ?)', [DEFAULT_FOCAL]),
      });

    console.log(`Backfilled ${updated} ${TABLE} row(s) to focal point ${DEFAULT_FOCAL}.`);
  }
} finally {
  await app.destroy();
}
