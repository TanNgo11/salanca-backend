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

export default {
  /**
   * Admits an admin holding either catalog action — `admin::hasPermissions` only
   * expresses AND, while the "Tạm hết món" screen serves managers and scoped branch
   * staff alike.
   */
  'has-catalog-access': (ctx: PolicyCtx) =>
    CATALOG_ACTIONS.some((action) => ctx.state?.userAbility?.can?.(action) === true),
};
