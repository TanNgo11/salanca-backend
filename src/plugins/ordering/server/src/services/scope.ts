import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import {
  resolveScope,
  scopeCondition,
  scopeWhere,
  type LocationScope,
  type StoredScopeRow,
} from '../domain/scope';
import { scopeIncludes } from '../domain/scope';
import type { ActorContext, ServiceContext } from './context';

type AdminUserLike = { id?: number; roles?: Array<{ code?: string }> };

/**
 * Staff location scope. Out-of-scope reads answer ORDER_NOT_FOUND (a 404, deliberately — a 403
 * would confirm the order exists); listings require a scope or throw SCOPE_REQUIRED.
 * Customer/system actors are not scoped here — O3 route layer authenticates them by token.
 */
const scope = ({ strapi }: { strapi: Core.Strapi }) => {
  const scopeQuery = () => strapi.db.query('plugin::ordering.staff-location-scope');

  const service = {
    /** Builds the staff actor for an admin user; detects the super-admin role. */
    async actorFromAdminUser(user: AdminUserLike): Promise<ActorContext> {
      const hasSuperAdminRole =
        (strapi.admin?.services?.role as { hasSuperAdminRole?: (u: AdminUserLike) => boolean })
          ?.hasSuperAdminRole ??
        ((u: AdminUserLike) => (u.roles ?? []).some((role) => role.code === 'strapi-super-admin'));
      const isSuperAdmin = hasSuperAdminRole(user);
      return {
        kind: 'staff',
        adminUserId: user.id as number,
        isSuperAdmin,
        actorRef: `admin:${user.id}`,
      };
    },

    /** system/customer actors see all locations; staff resolve their stored row. */
    async loadScope(ctx: ServiceContext): Promise<LocationScope | null> {
      if (ctx.actor.kind !== 'staff') return { allLocations: true };
      const row = (await scopeQuery().findOne({
        where: { adminUserId: ctx.actor.adminUserId },
      })) as StoredScopeRow;
      return resolveScope(row, { isSuperAdmin: ctx.actor.isSuperAdmin });
    },

    /** Deliberately 404: callers must not leak that a location exists but is out of scope. */
    assertLocationInScope(scope: LocationScope | null, locationRef: string): void {
      if (!scopeIncludes(scope, locationRef)) {
        throw new OrderingError('ORDER_NOT_FOUND', 'order not found', {
          details: { locationRef },
        });
      }
    },

    /** List filter for order queries; a denied scope throws SCOPE_REQUIRED instead of all. */
    orderWhere(scope: LocationScope | null): Record<string, unknown> {
      const where = scopeWhere(scope);
      if (where === null) {
        throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
      }
      return where;
    },

    /** Admin `same-location` condition: false denies, true allows all, object is a predicate. */
    async condition(user: AdminUserLike | undefined): Promise<false | true | object> {
      if (!user?.id) return false;
      const actor = await service.actorFromAdminUser(user);
      return scopeCondition(await service.loadScope({ actor }));
    },
  };
  return service;
};

export default scope;
