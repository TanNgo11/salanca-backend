import type { Core } from '@strapi/strapi';

type Scope = { allLocations: boolean; locationRefs: unknown };

/** O0 condition probe; service-level enforcement remains mandatory in O1. */
const branchScope = ({ strapi }: { strapi: Core.Strapi }) => ({
  async condition({ user }: { user?: { id?: number } }): Promise<false | true | object> {
    if (!user?.id) return false;
    const scope = await strapi.db.query('plugin::ordering.staff-location-scope').findOne({
      where: { adminUserId: user.id },
    }) as Scope | null;
    if (!scope) return false;
    if (scope.allLocations) return true;
    const refs = scope.locationRefs;
    if (!Array.isArray(refs) || refs.length === 0 || refs.some((ref) => typeof ref !== 'string' || !ref)) {
      return false;
    }
    return { locationRef: { $in: refs } };
  },
});

export default branchScope;
