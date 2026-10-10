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
import branch from './branch';
import changeLog from './change-log';
import jobLock from './job-lock';
import lineCancel from './line-cancel';

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
  branch,
  'change-log': changeLog,
  'job-lock': jobLock,
  'line-cancel': lineCancel,
  migrations: ({ strapi }: { strapi: Core.Strapi }) => ({
    run: (migrations: OrderingMigration[]) => runOrderingMigrations(strapi, migrations),
  }),
};
