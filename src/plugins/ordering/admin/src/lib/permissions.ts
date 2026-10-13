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
  promotion: action('promotion.manage'),
  rating: action('rating.manage'),
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
export const RBAC_PROMOTION = [...PERMISSIONS.promotion];
export const RBAC_RATING = [...PERMISSIONS.rating];
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
  ...RBAC_PROMOTION,
  ...RBAC_RATING,
];
