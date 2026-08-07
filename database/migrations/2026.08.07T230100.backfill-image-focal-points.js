'use strict';

const IMAGE_COMPONENT_TABLE = 'components_shared_images';
const DEFAULT_FOCAL_POINT = 50;

/**
 * `focalPointX/Y` were added after image components already existed. Schema
 * defaults protect new components but do not rewrite legacy database rows, so
 * any later Document Service update tries to validate `null` as `NaN`.
 *
 * Backfill the two physical columns independently: a partially repaired row
 * must keep its valid coordinate while only the missing coordinate defaults.
 */
async function up(knex) {
  if (!(await knex.schema.hasTable(IMAGE_COMPONENT_TABLE))) {
    return;
  }

  if (await knex.schema.hasColumn(IMAGE_COMPONENT_TABLE, 'focal_point_x')) {
    await knex(IMAGE_COMPONENT_TABLE)
      .whereNull('focal_point_x')
      .update({ focal_point_x: DEFAULT_FOCAL_POINT });
  }

  if (await knex.schema.hasColumn(IMAGE_COMPONENT_TABLE, 'focal_point_y')) {
    await knex(IMAGE_COMPONENT_TABLE)
      .whereNull('focal_point_y')
      .update({ focal_point_y: DEFAULT_FOCAL_POINT });
  }
}

/**
 * Data repair is intentionally irreversible: restoring null would recreate
 * records that the current required 0–100 schema cannot update.
 */
async function down() {}

// eslint-disable-next-line no-undef -- Strapi loads user migrations through CommonJS require().
module.exports = { down, up };
