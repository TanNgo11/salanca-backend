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
import catalogAvailability from './catalog-availability';
import catalogCategory from './catalog-category';
import catalogSlug from './catalog-slug';
import changeLog from './change-log';
import jobLock from './job-lock';
import lineCancel from './line-cancel';
import pickupScheduling from './pickup-scheduling';
import storefront from './storefront';
import adminOrders from './admin-orders';
import orderingSettings from './ordering-settings';
import notification from './notification';
import alert from './alert';
import orderStream from './order-stream';

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
  'catalog-availability': catalogAvailability,
  'catalog-category': catalogCategory,
  'catalog-slug': catalogSlug,
  'change-log': changeLog,
  'job-lock': jobLock,
  'line-cancel': lineCancel,
  'pickup-scheduling': pickupScheduling,
  storefront,
  'admin-orders': adminOrders,
  'ordering-settings': orderingSettings,
  notification,
  alert,
  'order-stream': orderStream,
  migrations: ({ strapi }: { strapi: Core.Strapi }) => ({
    run: (migrations: OrderingMigration[]) => runOrderingMigrations(strapi, migrations),
  }),
};
