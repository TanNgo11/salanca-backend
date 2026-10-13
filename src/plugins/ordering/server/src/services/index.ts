import type { Core } from '@strapi/strapi';

import { type OrderingMigration, runOrderingMigrations } from '../migrations/runner';
import registry from './registry';
import scope from './scope';
import idempotency from './idempotency';
import order from './order';
import deliveryAssignment from './delivery-assignment';
import courier from './courier';
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
import catalogCsv from './catalog-csv';
import catalogSlug from './catalog-slug';
import changeLog from './change-log';
import jobLock from './job-lock';
import lineCancel from './line-cancel';
import orderEdit from './order-edit';
import pickupScheduling from './pickup-scheduling';
import storefront from './storefront';
import adminOrders from './admin-orders';
import orderingSettings from './ordering-settings';
import notification from './notification';
import notificationTemplate from './notification-template';
import adminUnits from './admin-units';
import alert from './alert';
import alertRules from './alert-rules';
import alertRecipients from './alert-recipients';
import opsStatus from './ops-status';
import auditLog from './audit-log';
import orderStream from './order-stream';
import staffScope from './staff-scope';
import webhook from './webhook';
import webhookDelivery from './webhook-delivery';
import webhookEndpoint from './webhook-endpoint';
import paymentMatching from './payment-matching';
import paymentReview from './payment-review';
import manualPayment from './manual-payment';
import paymentLink from './payment-link';
import customerAuth from './customer-auth';
import customer from './customer';
import cart from './cart';
import dataRights from './data-rights';
import adminCustomers from './admin-customers';
import promotion from './promotion';
import rating from './rating';
import promotionAdmin from './promotion-admin';
import priceList from './price-list';
import print from './print';
import customerGroup from './customer-group';

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
  'catalog-csv': catalogCsv,
  'catalog-slug': catalogSlug,
  'change-log': changeLog,
  'job-lock': jobLock,
  'line-cancel': lineCancel,
  'order-edit': orderEdit,
  'pickup-scheduling': pickupScheduling,
  storefront,
  'admin-orders': adminOrders,
  'delivery-assignment': deliveryAssignment,
  courier,
  'ordering-settings': orderingSettings,
  notification,
  'notification-template': notificationTemplate,
  'admin-units': adminUnits,
  alert,
  'alert-rules': alertRules,
  'alert-recipients': alertRecipients,
  'ops-status': opsStatus,
  'audit-log': auditLog,
  'cash-closing': cashClosing,
  'order-export': orderExport,
  reports,
  'order-stream': orderStream,
  'staff-scope': staffScope,
  webhook,
  'webhook-delivery': webhookDelivery,
  'webhook-endpoint': webhookEndpoint,
  'payment-matching': paymentMatching,
  'payment-review': paymentReview,
  'manual-payment': manualPayment,
  'payment-link': paymentLink,
  'customer-auth': customerAuth,
  customer,
  cart,
  'data-rights': dataRights,
  'admin-customers': adminCustomers,
  promotion,
  rating,
  'promotion-admin': promotionAdmin,
  'price-list': priceList,
  'customer-group': customerGroup,
  // O12 (plan step 5): kitchen-ticket / provisional-receipt print payloads.
  print,
  migrations: ({ strapi }: { strapi: Core.Strapi }) => ({
    run: (migrations: OrderingMigration[]) => runOrderingMigrations(strapi, migrations),
  }),
};
