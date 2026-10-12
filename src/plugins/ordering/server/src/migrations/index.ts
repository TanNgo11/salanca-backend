import { o1CoreMigration } from './0001-o1-core';
import { o2CatalogMigration } from './0002-o2-catalog';
import { o3PickupMigration } from './0003-o3-pickup';
import { o6OpsMigration } from './0004-o6-ops';
import { o7OpsExtrasMigration } from './0005-o7-ops-extras';
import type { OrderingMigration } from './runner';

/** Production migrations, in order. */
export const orderingMigrations: OrderingMigration[] = [
  o1CoreMigration,
  o2CatalogMigration,
  o3PickupMigration,
  o6OpsMigration,
  o7OpsExtrasMigration,
];
