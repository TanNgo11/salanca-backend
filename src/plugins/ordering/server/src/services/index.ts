import type { Core } from '@strapi/strapi';

import { type OrderingMigration, runOrderingMigrations } from '../migrations/runner';
import registry from './registry';
import scope from './scope';
import idempotency from './idempotency';
import order from './order';
import deliveryAssignment from './delivery-assignment';
import transition from './transition';
import payment from './payment';
import refund from './refund';
import timeline from './timeline';
import hold from './hold';
import outbox from './outbox';
import branch from './branch';
import cashClosing from './cash-closing';
import orderExport from './order-export';
import reports from './reports';
import catalogAvailability from './catalog-availability';
import dailyStock from './daily-stock';
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
import adminUnits from './admin-units';
import alert from './alert';
import alertRules from './alert-rules';
import alertRecipients from './alert-recipients';
import opsStatus from './ops-status';
import orderStream from './order-stream';
import staffScope from './staff-scope';
import webhook from './webhook';
import paymentMatching from './payment-matching';
import paymentReview from './payment-review';
import manualPayment from './manual-payment';
import paymentLink from './payment-link';

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
  'daily-stock': dailyStock,
  'catalog-category': catalogCategory,
  'catalog-slug': catalogSlug,
  'change-log': changeLog,
  'job-lock': jobLock,
  'line-cancel': lineCancel,
  'pickup-scheduling': pickupScheduling,
  storefront,
  'admin-orders': adminOrders,
  'delivery-assignment': deliveryAssignment,
  'ordering-settings': orderingSettings,
  notification,
  'admin-units': adminUnits,
  alert,
  'alert-rules': alertRules,
  'alert-recipients': alertRecipients,
  'ops-status': opsStatus,
  'cash-closing': cashClosing,
  'order-export': orderExport,
  reports,
  'order-stream': orderStream,
  'staff-scope': staffScope,
  webhook,
  'payment-matching': paymentMatching,
  'payment-review': paymentReview,
  'manual-payment': manualPayment,
  'payment-link': paymentLink,
  migrations: ({ strapi }: { strapi: Core.Strapi }) => ({
    run: (migrations: OrderingMigration[]) => runOrderingMigrations(strapi, migrations),
  }),
};
