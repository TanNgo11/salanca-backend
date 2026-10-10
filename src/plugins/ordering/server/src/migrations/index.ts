import { o1CoreMigration } from './0001-o1-core';
import type { OrderingMigration } from './runner';

/** Production migrations, in order. */
export const orderingMigrations: OrderingMigration[] = [o1CoreMigration];
