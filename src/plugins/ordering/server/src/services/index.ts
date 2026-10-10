import type { Core } from '@strapi/strapi';

import { type OrderingMigration, runOrderingMigrations } from '../migrations/runner';
import registry from './registry';
import scope from './scope';
import idempotency from './idempotency';
import order from './order';
import transition from './transition';
import payment from './payment';
import refund from './refund';
import timeline from './timeline';
import hold from './hold';
import outbox from './outbox';

export default {
  registry,
  scope,
  idempotency,
  order,
  transition,
  payment,
  refund,
  timeline,
  hold,
  outbox,
  migrations: ({ strapi }: { strapi: Core.Strapi }) => ({
    run: (migrations: OrderingMigration[]) => runOrderingMigrations(strapi, migrations),
  }),
};
