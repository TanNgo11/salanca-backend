/**
 * Plugin policies for admin routes (plan step 8). Referenced as
 * `plugin::ordering.<name>`; registered under the plugin's own namespace by the
 * module loader.
 */

type AbilityLike = { can?: (action: string, subject?: unknown) => boolean };
type PolicyCtx = { state?: { userAbility?: AbilityLike } };

const CATALOG_ACTIONS = [
  'plugin::ordering.catalog.manage',
  'plugin::ordering.catalog.toggle-availability',
];

const ALERT_ACTIONS = [
  'plugin::ordering.ops.read',
  'plugin::ordering.report.read',
  'plugin::ordering.payment.review',
  'plugin::ordering.order.read',
];

export default {
  /**
   * Admits an admin holding either catalog action — `admin::hasPermissions` only
   * expresses AND, while the "Tạm hết món" screen serves managers and scoped branch
   * staff alike.
   */
  'has-catalog-access': (ctx: PolicyCtx) =>
    CATALOG_ACTIONS.some((action) => ctx.state?.userAbility?.can?.(action) === true),
  /**
   * Admits an admin holding at least one alert-recipient action — the alert list narrows
   * further in the service (each rule's recipients + location scope).
   */
  'has-alert-access': (ctx: PolicyCtx) =>
    ALERT_ACTIONS.some((action) => ctx.state?.userAbility?.can?.(action) === true),
};
