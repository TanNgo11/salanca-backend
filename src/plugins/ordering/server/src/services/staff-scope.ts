import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { resolveScope, scopeIncludes } from '../domain/scope';
import type changeLogFactory from './change-log';
import type { ServiceContext } from './context';
import type scopeFactory from './scope';

type AdminUserRow = {
  id: number;
  firstname?: string | null;
  lastname?: string | null;
  email?: string | null;
  isActive?: boolean;
  roles?: Array<{ name?: string; code?: string }>;
};

type ScopeRow = { id: number; adminUserId: number; allLocations: boolean; locationRefs: string[] | null };

/**
 * "Nhân viên và chi nhánh" (screens S8; permission scope.manage). Assigns admin users to branches.
 * A manager can only grant branches inside their own scope, and only an all-locations manager can
 * grant "all branches". Super Admins always see every branch and are not editable here. Every
 * change is change-logged (contracts §21.6).
 */
const staffScope = ({ strapi }: { strapi: Core.Strapi }) => {
  const scopes = () => strapi.db.query('plugin::ordering.staff-location-scope');
  const scope = () => strapi.plugin('ordering').service('scope') as ReturnType<typeof scopeFactory>;
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;

  const isSuperAdmin = (user: AdminUserRow) =>
    (user.roles ?? []).some((role) => role.code === 'strapi-super-admin');

  return {
    async list(ctx: ServiceContext) {
      const users = (await strapi.db.query('admin::user').findMany({
        select: ['id', 'firstname', 'lastname', 'email', 'isActive'],
        populate: { roles: { select: ['name', 'code'] } },
        orderBy: { id: 'asc' },
      })) as AdminUserRow[];
      const rows = (await scopes().findMany({})) as ScopeRow[];
      const byUser = new Map(rows.map((row) => [row.adminUserId, row]));
      const viewer = await scope().loadScope(ctx);
      const items = users.map((user) => {
        const row = byUser.get(user.id);
        const resolved = resolveScope(row ?? null, { isSuperAdmin: isSuperAdmin(user) });
        return {
          adminUserId: user.id,
          name: [user.firstname, user.lastname].filter(Boolean).join(' ') || null,
          email: user.email ?? null,
          isActive: user.isActive !== false,
          roles: (user.roles ?? []).map((role) => role.name ?? role.code ?? ''),
          isSuperAdmin: isSuperAdmin(user),
          allLocations: resolved?.allLocations === true,
          locationRefs: resolved && !resolved.allLocations ? resolved.locationRefs : [],
          assigned: resolved !== null,
        };
      });
      // A branch manager sees colleagues of their branches (and unassigned people to onboard).
      const visible = viewer?.allLocations
        ? items
        : items.filter(
            (item) =>
              !item.assigned ||
              (!item.allLocations && item.locationRefs.some((ref) => scopeIncludes(viewer, ref))),
          );
      return visible.sort((a, b) => Number(a.assigned) - Number(b.assigned) || a.adminUserId - b.adminUserId);
    },

    async put(adminUserId: number, input: { allLocations?: unknown; locationRefs?: unknown }, ctx: ServiceContext) {
      const viewer = await scope().loadScope(ctx);
      if (viewer === null) throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
      const user = (await strapi.db.query('admin::user').findOne({
        where: { id: adminUserId },
        populate: { roles: { select: ['code'] } },
      })) as AdminUserRow | null;
      if (!user) throw new OrderingError('VALIDATION_ERROR', 'admin user not found', { details: { field: 'adminUserId' } });
      if (isSuperAdmin(user)) {
        throw new OrderingError('VALIDATION_ERROR', 'super admins always see every branch', {
          details: { field: 'adminUserId' },
        });
      }
      const allLocations = input.allLocations === true;
      const refs = Array.isArray(input.locationRefs)
        ? [...new Set(input.locationRefs.filter((ref): ref is string => typeof ref === 'string'))]
        : [];
      if (allLocations && !viewer.allLocations) {
        throw new OrderingError('SCOPE_REQUIRED', 'only an all-branches manager can grant every branch');
      }
      if (!allLocations && refs.length === 0) {
        throw new OrderingError('VALIDATION_ERROR', 'choose at least one branch', { details: { field: 'locationRefs' } });
      }
      const known = new Set(
        ((await strapi.db.query('plugin::ordering.branch').findMany({ select: ['code'] })) as Array<{ code: string }>).map(
          (row) => row.code,
        ),
      );
      for (const ref of refs) {
        if (!known.has(ref)) {
          throw new OrderingError('VALIDATION_ERROR', `unknown branch "${ref}"`, { details: { field: 'locationRefs' } });
        }
        if (!scopeIncludes(viewer, ref)) {
          throw new OrderingError('SCOPE_REQUIRED', 'you can only grant branches inside your scope');
        }
      }
      const current = (await scopes().findOne({ where: { adminUserId } })) as ScopeRow | null;
      const data = { allLocations, locationRefs: allLocations ? [] : refs };
      const row = current
        ? await scopes().update({ where: { id: current.id }, data })
        : await scopes().create({ data: { adminUserId, ...data } });
      await changeLog().record(
        {
          action: 'scope.update',
          entityType: 'staff-location-scope',
          entityId: adminUserId,
          before: current ? { allLocations: current.allLocations, locationRefs: current.locationRefs } : null,
          after: data,
        },
        ctx,
      );
      return { adminUserId, ...data, id: (row as { id: number }).id };
    },
  };
};

export default staffScope;
