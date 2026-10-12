import adminBranches from './admin-branches';
import adminOrders from './admin-orders';
import adminUnits from './admin-units';
import adminStream from './admin-stream';
import availability from './availability';
import catalog from './catalog';
import categories from './categories';
import paymentReview from './payment-review';
import storefront from './storefront';
import webhook from './webhook';

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
  'payment-review': paymentReview,
};
