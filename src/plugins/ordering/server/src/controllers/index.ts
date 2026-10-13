import adminBranches from './admin-branches';
import adminCustomers from './admin-customers';
import adminOrders from './admin-orders';
import adminUnits from './admin-units';
import adminStream from './admin-stream';
import auditLog from './audit-log';
import availability from './availability';
import cashClosing from './cash-closing';
import courier from './courier';
import catalog from './catalog';
import catalogImport from './catalog-import';
import categories from './categories';
import customerAuth from './customer-auth';
import customer from './customer';
import cart from './cart';
import notificationTemplates from './notification-templates';
import openapi from './openapi';
import ops from './ops';
import paymentReview from './payment-review';
import reports from './reports';
import storefront from './storefront';
import webhook from './webhook';
import webhooks from './webhooks';

export default {
  'admin-branches': adminBranches,
  'admin-customers': adminCustomers,
  'admin-orders': adminOrders,
  'admin-units': adminUnits,
  'admin-stream': adminStream,
  availability,
  catalog,
  'catalog-import': catalogImport,
  categories,
  storefront,
  webhook,
  webhooks,
  'payment-review': paymentReview,
  openapi,
  ops,
  'cash-closing': cashClosing,
  courier,
  reports,
  'audit-log': auditLog,
  'notification-templates': notificationTemplates,
  'customer-auth': customerAuth,
  customer,
  cart,
};
