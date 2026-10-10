import { o1CoreMigration } from './0001-o1-core';
import { o2CatalogMigration } from './0002-o2-catalog';
import type { OrderingMigration } from './runner';

/** Production migrations, in order. */
export const orderingMigrations: OrderingMigration[] = [o1CoreMigration, o2CatalogMigration];
