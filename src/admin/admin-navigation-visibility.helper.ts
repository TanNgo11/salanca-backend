type AdminNavigationPermission = Readonly<{
  action: string;
}>;

const MARKETPLACE_READ_ACTION = 'admin::marketplace.read';
const DOCUMENTATION_ACTION_PREFIX = 'plugin::documentation.';

export const isDeveloperOnlyAdminPermission = (action: string): boolean =>
  action === MARKETPLACE_READ_ACTION || action.startsWith(DOCUMENTATION_ACTION_PREFIX);

/**
 * Marketplace and Documentation are gated only by permissions, and Super Admin
 * holds every permission, so they are stripped from the Admin UI's permission
 * list instead. This only changes the Admin UI; server endpoints are untouched.
 */
export const hideDeveloperOnlyAdminPermissions = <T extends AdminNavigationPermission>(
  permissions: readonly T[],
): T[] => permissions.filter(({ action }) => !isDeveloperOnlyAdminPermission(action));
