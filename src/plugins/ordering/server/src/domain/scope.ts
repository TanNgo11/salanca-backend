/**
 * Staff location scope resolution. Deny-by-default: any malformed stored row resolves to null
 * (deny everything) rather than widening access. Superadmin bypasses the row entirely — an
 * explicit rule, not an emergent property of the data.
 */
export type LocationScope =
  | { allLocations: true }
  | { allLocations: false; locationRefs: string[] };

export type StoredScopeRow =
  | { allLocations?: unknown; locationRefs?: unknown }
  | null
  | undefined;

export function resolveScope(
  row: StoredScopeRow,
  options: { isSuperAdmin: boolean },
): LocationScope | null {
  if (options.isSuperAdmin) return { allLocations: true };
  if (row === null || row === undefined) return null;
  if (row.allLocations === true) return { allLocations: true };
  const refs = row.locationRefs;
  if (
    Array.isArray(refs) &&
    refs.length > 0 &&
    refs.every((ref) => typeof ref === 'string' && ref.length > 0)
  ) {
    return { allLocations: false, locationRefs: refs };
  }
  return null;
}

export function scopeIncludes(scope: LocationScope | null, locationRef: string): boolean {
  if (scope === null) return false;
  return scope.allLocations ? true : scope.locationRefs.includes(locationRef);
}

/** Query filter shape: null denies everything, `{}` matches all, `$in` scopes the list. */
export function scopeWhere(scope: LocationScope | null): null | Record<string, unknown> {
  if (scope === null) return null;
  if (scope.allLocations) return {};
  return { locationRef: { $in: scope.locationRefs } };
}

/** Admin condition predicate: false denies, true allows all, object is a where-clause. */
export function scopeCondition(scope: LocationScope | null): false | true | Record<string, unknown> {
  if (scope === null) return false;
  if (scope.allLocations) return true;
  return { locationRef: { $in: scope.locationRefs } };
}
