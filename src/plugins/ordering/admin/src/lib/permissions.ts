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
} as const;

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
