/**
 * Internal collections of the ordering plugin (contracts §5, §21). All are hidden from Content
 * Manager and Content-Type Builder; every mutation goes through a plugin service. Schemas own the
 * tables; `migrations/` owns constraints, indexes and sequences Strapi cannot express.
 */
import adjustmentAllocation from './adjustment-allocation';
import adminChangeLog from './admin-change-log';
import branch from './branch';
import cashClosing from './cash-closing';
import catalogAvailabilityWindow from './catalog-availability-window';
import catalogCategory from './catalog-category';
import catalogDailyLimit from './catalog-daily-limit';
import catalogDailyReservation from './catalog-daily-reservation';
import catalogDailyUsage from './catalog-daily-usage';
import catalogImport from './catalog-import';
import catalogLocationState from './catalog-location-state';
import catalogModifier from './catalog-modifier';
import catalogModifierGroup from './catalog-modifier-group';
import catalogPrice from './catalog-price';
import catalogProduct from './catalog-product';
import catalogSlug from './catalog-slug';
import catalogVariant from './catalog-variant';
import cart from './cart';
import customer from './customer';
import customerAddress from './customer-address';
import customerOtp from './customer-otp';
import customerSession from './customer-session';
import dataRequest from './data-request';
import fulfillment from './fulfillment';
import fulfillmentGroup from './fulfillment-group';
import fulfillmentLine from './fulfillment-line';
import hold from './hold';
import idempotencyKey from './idempotency-key';
import notificationDelivery from './notification-delivery';
import notificationTemplate from './notification-template';
import opsAlert from './ops-alert';
import order from './order';
import orderAdjustment from './order-adjustment';
import orderEvent from './order-event';
import orderJobLock from './order-job-lock';
import orderLine from './order-line';
import outbox from './outbox';
import payment from './payment';
import paymentEvent from './payment-event';
import refund from './refund';
import refundLine from './refund-line';
import staffLocationScope from './staff-location-scope';
import webhookDelivery from './webhook-delivery';
import webhookEndpoint from './webhook-endpoint';

export default {
  'adjustment-allocation': adjustmentAllocation,
  'admin-change-log': adminChangeLog,
  branch,
  'cash-closing': cashClosing,
  'catalog-availability-window': catalogAvailabilityWindow,
  'catalog-category': catalogCategory,
  'catalog-daily-limit': catalogDailyLimit,
  'catalog-daily-reservation': catalogDailyReservation,
  'catalog-daily-usage': catalogDailyUsage,
  'catalog-import': catalogImport,
  'catalog-location-state': catalogLocationState,
  'catalog-modifier': catalogModifier,
  'catalog-modifier-group': catalogModifierGroup,
  'catalog-price': catalogPrice,
  'catalog-product': catalogProduct,
  'catalog-slug': catalogSlug,
  'catalog-variant': catalogVariant,
  cart,
  customer,
  'customer-address': customerAddress,
  'customer-otp': customerOtp,
  'customer-session': customerSession,
  'data-request': dataRequest,
  fulfillment,
  'fulfillment-group': fulfillmentGroup,
  'fulfillment-line': fulfillmentLine,
  hold,
  'idempotency-key': idempotencyKey,
  'notification-delivery': notificationDelivery,
  'notification-template': notificationTemplate,
  'ops-alert': opsAlert,
  order,
  'order-adjustment': orderAdjustment,
  'order-event': orderEvent,
  'order-job-lock': orderJobLock,
  'order-line': orderLine,
  outbox,
  payment,
  'payment-event': paymentEvent,
  refund,
  'refund-line': refundLine,
  'staff-location-scope': staffLocationScope,
  'webhook-delivery': webhookDelivery,
  'webhook-endpoint': webhookEndpoint,
};
