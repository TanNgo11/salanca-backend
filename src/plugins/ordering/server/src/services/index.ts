import type { Core } from '@strapi/strapi';

import { type OrderingMigration, runOrderingMigrations } from '../migrations/runner';
import registry from './registry';
import branchScope from './branch-scope';
import { runSpikeTransaction } from './spike-tx';

export default {
  registry,
  'branch-scope': branchScope,
  'spike-tx': () => ({ run: runSpikeTransaction }),
  migrations: ({ strapi }: { strapi: Core.Strapi }) => ({
    run: (migrations: OrderingMigration[]) => runOrderingMigrations(strapi, migrations),
  }),
};
