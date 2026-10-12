import type { Core } from '@strapi/strapi';

import { scopeIncludes } from '../domain/scope';
import type { AlertRule } from './alert-rules';
import type branchFactory from './branch';
import type scopeFactory from './scope';

type AdminUserRow = { id: number; email: string | null; roles?: Array<{ code?: string }> };

/**
 * Resolves an alert rule's `recipients` to email addresses (contracts §19.2). `'branch-email'`
 * maps to the mailbox of the alert's `locationRef` branch; every other recipient is a plugin
 * action — the address list is the active admin users holding `plugin::ordering.<action>`.
 * Action lookup goes through `admin_permissions` (action → role) then `admin_users.roles`;
 * when the alert carries a `locationRef`, users are further filtered by their ordering
 * location scope (super admin or `allLocations` always qualify).
 */
const alertRecipients = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const branches = () => plugin().service('branch') as ReturnType<typeof branchFactory>;
  const scope = () => plugin().service('scope') as ReturnType<typeof scopeFactory>;

  const usersWithAction = async (action: string): Promise<AdminUserRow[]> => {
    const permissions = (await strapi.db.query('admin::permission').findMany({
      where: { action: `plugin::ordering.${action}` },
      populate: { role: { select: ['id'] } },
    })) as Array<{ role?: { id?: number } | null }>;
    const roleIds = [
      ...new Set(
        permissions
          .map((permission) => permission.role?.id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    if (roleIds.length === 0) return [];
    return (await strapi.db.query('admin::user').findMany({
      where: { isActive: true, roles: { id: { $in: roleIds } } },
      select: ['id', 'email'],
      populate: { roles: { select: ['code'] } },
    })) as AdminUserRow[];
  };

  const inScope = async (user: AdminUserRow, locationRef: string): Promise<boolean> => {
    const actor = await scope().actorFromAdminUser(user);
    const userScope = await scope().loadScope({ actor });
    return scopeIncludes(userScope, locationRef);
  };

  return {
    /**
     * `emails` = every resolved address (deduped); `branchEmails` = only the branch mailbox
     * portion, so callers can send the order-specific template there instead.
     */
    async resolve(
      rule: AlertRule,
      locationRef?: string | null,
    ): Promise<{ emails: string[]; branchEmails: string[] }> {
      const emails = new Set<string>();
      const branchEmails = new Set<string>();
      if (rule.recipients.includes('branch-email') && locationRef) {
        const branch = await branches().findByCode(locationRef);
        if (branch?.email) {
          branchEmails.add(branch.email);
          emails.add(branch.email);
        }
      }
      for (const recipient of rule.recipients) {
        if (recipient === 'branch-email') continue;
        for (const user of await usersWithAction(recipient)) {
          if (!user.email) continue;
          if (locationRef && !(await inScope(user, locationRef))) continue;
          emails.add(user.email);
        }
      }
      return { emails: [...emails], branchEmails: [...branchEmails] };
    },
  };
};

export default alertRecipients;
