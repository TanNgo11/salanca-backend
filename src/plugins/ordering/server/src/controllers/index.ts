import adminBranches from './admin-branches';
import adminOrders from './admin-orders';
import adminUnits from './admin-units';
import adminStream from './admin-stream';
import auditLog from './audit-log';
import availability from './availability';
import cashClosing from './cash-closing';
import catalog from './catalog';
import categories from './categories';
import ops from './ops';
import paymentReview from './payment-review';
import reports from './reports';
import storefront from './storefront';
import webhook from './webhook';
import webhooks from './webhooks';

export default {
  'admin-branches': adminBranches,
  'admin-orders': adminOrders,
  'admin-units': adminUnits,
  'admin-stream': adminStream,
  availability,
  catalog,
  categories,
  storefront,
  webhook,
  webhooks,
  'payment-review': paymentReview,
  ops,
  'cash-closing': cashClosing,
  reports,
  'audit-log': auditLog,
};
