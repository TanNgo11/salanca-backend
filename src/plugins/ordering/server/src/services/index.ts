import type { Core } from '@strapi/strapi';

import { type OrderingMigration, runOrderingMigrations } from '../migrations/runner';
import registry from './registry';
import branchScope from './branch-scope';

export default {
  registry,
  'branch-scope': branchScope,
  migrations: ({ strapi }: { strapi: Core.Strapi }) => ({
    run: (migrations: OrderingMigration[]) => runOrderingMigrations(strapi, migrations),
  }),
};
