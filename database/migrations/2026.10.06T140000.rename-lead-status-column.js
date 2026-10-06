'use strict';

const LEAD_TABLES = ['reservation_requests', 'contact_messages'];

/**
 * The lead triage field was named `status`, which collides with the Strapi 5
 * Content Manager's reserved draft/publish `status` parameter: the edit view
 * showed it blank and every save failed with "Invalid status". The attribute
 * is now `leadStatus`; rename the physical column before schema sync so the
 * existing triage values survive instead of being dropped and re-defaulted.
 */
async function up(knex) {
  for (const table of LEAD_TABLES) {
    if (!(await knex.schema.hasTable(table))) {
      continue;
    }

    const hasOld = await knex.schema.hasColumn(table, 'status');
    const hasNew = await knex.schema.hasColumn(table, 'lead_status');

    if (hasOld && !hasNew) {
      await knex.schema.alterTable(table, (builder) => {
        builder.renameColumn('status', 'lead_status');
      });
    }
  }
}

/**
 * Forward-only: renaming the column back would re-break the Admin edit view.
 */
async function down() {}

// eslint-disable-next-line no-undef -- Strapi loads user migrations through CommonJS require().
module.exports = { down, up };
