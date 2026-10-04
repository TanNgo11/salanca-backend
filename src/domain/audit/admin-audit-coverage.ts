import { trimmedNonEmptyString } from '../../shared/normalization/value';

export const AUDIT_EVENT_UID = 'api::audit-event.audit-event';

const EXPLICIT_ADMIN_ROUTE_PREFIXES = [
  '/audit-log',
] as const;

const stripAdminPrefix = (path: string): string =>
  path.replace(/^\/admin(?=\/|$)/, '');

export const normalizeAdminPath = (path: string): string => {
  const trimmed = trimmedNonEmptyString(path) ?? '';
  const withoutQuery = trimmed.split('?')[0] ?? '';
  const withLeadingSlash = withoutQuery.startsWith('/')
    ? withoutQuery
    : `/${withoutQuery}`;
  const normalized = stripAdminPrefix(withLeadingSlash);
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized || '/';
};

export const isExplicitDomainAdminRoute = (path: string): boolean => {
  const normalized = normalizeAdminPath(path);
  return EXPLICIT_ADMIN_ROUTE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
};

export const isAuditLedgerUid = (uid: string | undefined): boolean =>
  uid === AUDIT_EVENT_UID;

export const isPermissionEventName = (eventName: string): boolean =>
  eventName === 'permission.create' ||
  eventName === 'permission.update' ||
  eventName === 'permission.delete';

export const isAdminRouteContext = (
  routeType: string | undefined,
  hasUser: boolean,
): boolean => routeType === 'admin' && hasUser;
