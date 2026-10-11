/** Plugin admin actions (server register.ts) in the shape `useRBAC` / `Page.Protect` expect. */
const action = (name: string) => [{ action: `plugin::ordering.${name}`, subject: null }];

export const PERMISSIONS = {
  read: action('order.read'),
  process: action('order.process'),
  cancel: action('order.cancel'),
  create: action('order.create'),
  editLines: action('order.edit-lines'),
  recordCash: action('payment.record-cash'),
  refund: action('refund.manage'),
  settings: action('settings.manage'),
  scope: action('scope.manage'),
  review: action('payment.review'),
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
  recordCash: PERMISSIONS.recordCash,
  refund: PERMISSIONS.refund,
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
/** Anyone holding one of these sees the "Bán hàng" menu entry. */
export const RBAC_ANY_ORDERING = [
  ...RBAC_ORDERS_READ,
  ...RBAC_CATALOG_ACCESS,
  ...RBAC_SETTINGS,
  ...RBAC_SCOPE,
  ...RBAC_PAYMENT_REVIEW,
];
