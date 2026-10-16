/** Plugin admin actions (server register.ts) in the shape `useRBAC` / `Page.Protect` expect. */
const action = (name: string) => [{ action: `plugin::ordering.${name}`, subject: null }];

export const PERMISSIONS = {
  read: action('order.read'),
  process: action('order.process'),
  cancel: action('order.cancel'),
  create: action('order.create'),
  editLines: action('order.edit-lines'),
  edit: action('order.edit'),
  recordCash: action('payment.record-cash'),
  refund: action('refund.manage'),
  settings: action('settings.manage'),
  scope: action('scope.manage'),
  review: action('payment.review'),
  report: action('report.read'),
  export: action('export'),
  ops: action('ops.read'),
  audit: action('audit.read'),
  webhook: action('webhook.manage'),
  // O11 (screens C1–C3).
  customerRead: action('customer.read'),
  customerManage: action('customer.manage'),
  dataRequest: action('customer.erase'),
  promotion: action('promotion.manage'),
  rating: action('rating.manage'),
  price: action('price.manage'),
  // O9 (screens G1–G3): adjust is the tighter action beyond day-to-day card management.
  giftCardManage: action('gift-card.manage'),
  giftCardAdjust: action('gift-card.adjust'),
  // O16 (screens Y1-Y4): manage the program and tiers; adjust is the tighter action on a customer.
  loyaltyManage: action('loyalty.manage'),
  loyaltyAdjust: action('loyalty.adjust'),
  // O12 (screens N2, N7).
  kitchenRead: action('kitchen.read'),
  tableManage: action('table.manage'),
} as const;

/** Stable arrays for `useRBAC` (a new array each render makes it re-check every time). */
export const RBAC_INBOX = [...PERMISSIONS.read, ...PERMISSIONS.process];
export const RBAC_LIST = [...PERMISSIONS.create, ...PERMISSIONS.process];

/** `useRBAC` input: one key per capability → `allowedActions.canRead`, `canProcess`, … */
export const ORDER_RBAC = {
  read: PERMISSIONS.read,
  process: PERMISSIONS.process,
  cancel: PERMISSIONS.cancel,
  create: PERMISSIONS.create,
  editLines: PERMISSIONS.editLines,
  edit: PERMISSIONS.edit,
  recordCash: PERMISSIONS.recordCash,
  refund: PERMISSIONS.refund,
  review: PERMISSIONS.review,
};

export const RBAC_DETAIL = Object.values(ORDER_RBAC).flat();

/** Main-menu entry and sub-navigation gates (pages/App.tsx). */
const catalog = (name: string) => [{ action: `plugin::ordering.catalog.${name}`, subject: null }];
export const RBAC_ORDERS_READ = [...PERMISSIONS.read];
export const RBAC_CATALOG_MANAGE = catalog('manage');
export const RBAC_CATALOG_ACCESS = [...catalog('manage'), ...catalog('toggle-availability')];
export const RBAC_SETTINGS = [...PERMISSIONS.settings];
export const RBAC_SCOPE = [...PERMISSIONS.scope];
export const RBAC_PAYMENT_REVIEW = [...PERMISSIONS.review];
export const RBAC_OPS = [...PERMISSIONS.ops];
export const RBAC_REPORT = [...PERMISSIONS.report];
export const RBAC_EXPORT = [...PERMISSIONS.export];
export const RBAC_AUDIT = [...PERMISSIONS.audit];
export const RBAC_WEBHOOK = [...PERMISSIONS.webhook];
/** O11: Customers list+profile needs read; staff note / status edits need manage. */
export const RBAC_CUSTOMERS = [...PERMISSIONS.customerRead, ...PERMISSIONS.customerManage];
export const RBAC_DATA_REQUESTS = [...PERMISSIONS.dataRequest];
export const RBAC_PROMOTION = [...PERMISSIONS.promotion];
export const RBAC_RATING = [...PERMISSIONS.rating];
export const RBAC_PRICE = [...PERMISSIONS.price];
/** O9: the cards tab + batch tools need manage; the ± balance correction checks adjust too. */
export const RBAC_GIFT_CARD = [...PERMISSIONS.giftCardManage];
export const RBAC_GIFT_CARD_FULL = [...PERMISSIONS.giftCardManage, ...PERMISSIONS.giftCardAdjust];
export const RBAC_LOYALTY = [...PERMISSIONS.loyaltyManage];
/** O12: the kitchen display and all its routes (board, stream, prepared, start, complete) sit behind `kitchen.read`. */
export const RBAC_KITCHEN = [...PERMISSIONS.kitchenRead];
export const RBAC_TABLES = [...PERMISSIONS.tableManage];
/** O6 alert list: anyone a rule could notify (ops, reports, payment review or branch staff). */
export const RBAC_ALERTS = [
  ...PERMISSIONS.ops,
  ...PERMISSIONS.report,
  ...PERMISSIONS.review,
  ...PERMISSIONS.read,
];
/** Anyone holding one of these sees the "Bán hàng" menu entry. */
export const RBAC_ANY_ORDERING = [
  ...RBAC_ORDERS_READ,
  ...PERMISSIONS.process,
  ...PERMISSIONS.recordCash,
  ...RBAC_CATALOG_ACCESS,
  ...RBAC_SETTINGS,
  ...RBAC_SCOPE,
  ...RBAC_PAYMENT_REVIEW,
  ...RBAC_OPS,
  ...RBAC_REPORT,
  ...RBAC_AUDIT,
  ...RBAC_WEBHOOK,
  ...RBAC_CUSTOMERS,
  ...RBAC_DATA_REQUESTS,
  ...RBAC_PROMOTION,
  ...RBAC_RATING,
  ...RBAC_PRICE,
  ...RBAC_GIFT_CARD_FULL,
  ...RBAC_LOYALTY,
  ...RBAC_KITCHEN,
  ...RBAC_TABLES,
];
