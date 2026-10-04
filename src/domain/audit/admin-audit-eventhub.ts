import { isPlainRecord, trimmedNonEmptyString } from '../../shared/normalization/value';

import {
  isAdminRouteContext,
  isAuditLedgerUid,
  isExplicitDomainAdminRoute,
  isPermissionEventName,
} from './admin-audit-coverage';
import { AuditAction, AuditTargetType } from './audit-event.types';
import { isGenericAuditCaptureSuppressed } from './audit-event.suppression';
import { readStableTargetId, resolveAuditTargetLabel } from './audit-target-label';

/**
 * media.delete and media-folder.update are intentionally absent: upstream
 * emits them too early (or not at all), so the upload extension wrapper writes
 * those rows directly after the mutation resolves — one row per target.
 */
export const ADMIN_AUDIT_EVENTHUB_ALLOWLIST = [
  'entry.create',
  'entry.update',
  'entry.delete',
  'entry.publish',
  'entry.unpublish',
  'media.create',
  'media.update',
  'media-folder.create',
  'media-folder.delete',
  'user.create',
  'user.update',
  'user.delete',
  'admin.logout',
  'role.create',
  'role.update',
  'role.delete',
] as const;

export type AdminAuditEventHubName = (typeof ADMIN_AUDIT_EVENTHUB_ALLOWLIST)[number];

export interface AdminAuditEventHubDecision {
  action: AuditAction;
  targetType: AuditTargetType;
  targetUid?: string;
  targetDocumentId?: string;
  targetLabel?: string;
  publicationStatus?: 'draft' | 'published';
  locale?: string;
  isActiveChange?: 'activate' | 'deactivate';
}

const ALLOWLIST = new Set<string>(ADMIN_AUDIT_EVENTHUB_ALLOWLIST);

const MEDIA_UIDS = new Set(['plugin::upload.file', 'plugin::upload.folder']);

const SINGULAR_TARGET_KEYS = ['entry', 'user', 'media', 'role', 'folder'] as const;
const PLURAL_TARGET_KEYS = ['users', 'folders', 'entries'] as const;
const USER_PROFILE_MUTATION_KEYS = [
  'email',
  'firstname',
  'lastname',
  'password',
  'preferedLanguage',
  'roles',
  'username',
] as const;

export const isAllowlistedAdminAuditEvent = (eventName: string): boolean =>
  ALLOWLIST.has(eventName);

const recordsFromArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isPlainRecord) : [];

export const readAdminAuditEventHubRecords = (
  payload: unknown,
): Record<string, unknown>[] => {
  if (!isPlainRecord(payload)) {
    return [];
  }

  for (const key of PLURAL_TARGET_KEYS) {
    if (Array.isArray(payload[key])) {
      return recordsFromArray(payload[key]);
    }
  }

  for (const key of SINGULAR_TARGET_KEYS) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return recordsFromArray(value);
    }
    if (isPlainRecord(value)) {
      return [value];
    }
  }

  return [payload];
};

const readUid = (payload: unknown): string | undefined => {
  if (!isPlainRecord(payload)) {
    return undefined;
  }
  return trimmedNonEmptyString(payload.uid) ?? undefined;
};

const readLocale = (entry: Record<string, unknown> | null): string | undefined =>
  trimmedNonEmptyString(entry?.locale) ?? undefined;

const readPublicationStatus = (
  eventName: string,
  entry: Record<string, unknown> | null,
): 'draft' | 'published' | undefined => {
  if (eventName === 'entry.publish') {
    return 'published';
  }
  if (eventName === 'entry.unpublish' || eventName === 'entry.delete') {
    return 'draft';
  }
  const publishedAt = entry?.publishedAt;
  if (typeof publishedAt === 'string' && publishedAt.trim().length > 0) {
    return 'published';
  }
  if (entry && 'publishedAt' in entry) {
    return 'draft';
  }
  return undefined;
};

const mapUserAction = (
  eventName: string,
  mutation: unknown,
): AuditAction => {
  if (eventName === 'user.create') {
    return AuditAction.AdminUserCreate;
  }
  if (eventName === 'user.delete') {
    return AuditAction.AdminUserDelete;
  }
  if (isPlainRecord(mutation) && typeof mutation.isActive === 'boolean') {
    const hasProfileMutation = USER_PROFILE_MUTATION_KEYS.some((key) => key in mutation);
    if (!hasProfileMutation) {
      return mutation.isActive
        ? AuditAction.AdminUserActivate
        : AuditAction.AdminUserDeactivate;
    }
  }
  return AuditAction.AdminUserUpdate;
};

const mapOneAdminAuditEventHub = (
  eventName: string,
  uid: string | undefined,
  entry: Record<string, unknown> | null,
  mutation: unknown,
): AdminAuditEventHubDecision | null => {
  if (eventName.startsWith('entry.')) {
    if (isAuditLedgerUid(uid) || (uid && MEDIA_UIDS.has(uid))) {
      return null;
    }

    const actionByEvent: Record<string, AuditAction> = {
      'entry.create': AuditAction.CmsEntryCreate,
      'entry.update': AuditAction.CmsEntryUpdate,
      'entry.delete': AuditAction.CmsEntryDelete,
      'entry.publish': AuditAction.CmsEntryPublish,
      'entry.unpublish': AuditAction.CmsEntryUnpublish,
    };

    return {
      action: actionByEvent[eventName] ?? AuditAction.CmsEntryUpdate,
      targetType: AuditTargetType.CmsEntry,
      targetUid: uid,
      targetDocumentId: readStableTargetId(entry),
      targetLabel: resolveAuditTargetLabel(entry),
      locale: readLocale(entry),
      publicationStatus: readPublicationStatus(eventName, entry),
    };
  }

  if (eventName.startsWith('media-folder.')) {
    const actionByEvent: Record<string, AuditAction> = {
      'media-folder.create': AuditAction.MediaFolderCreate,
      'media-folder.update': AuditAction.MediaFolderUpdate,
      'media-folder.delete': AuditAction.MediaFolderDelete,
    };
    return {
      action: actionByEvent[eventName] ?? AuditAction.MediaFolderUpdate,
      targetType: AuditTargetType.MediaFolder,
      targetUid: 'plugin::upload.folder',
      targetDocumentId: readStableTargetId(entry),
      targetLabel: resolveAuditTargetLabel(entry),
    };
  }

  if (eventName.startsWith('media.')) {
    const actionByEvent: Record<string, AuditAction> = {
      'media.create': AuditAction.MediaCreate,
      'media.update': AuditAction.MediaUpdate,
      'media.delete': AuditAction.MediaDelete,
    };
    return {
      action: actionByEvent[eventName] ?? AuditAction.MediaUpdate,
      targetType: AuditTargetType.Media,
      targetUid: 'plugin::upload.file',
      targetDocumentId: readStableTargetId(entry),
      targetLabel: resolveAuditTargetLabel(entry),
    };
  }

  if (eventName.startsWith('user.')) {
    return {
      action: mapUserAction(eventName, mutation),
      targetType: AuditTargetType.AdminUser,
      targetUid: 'admin::user',
      targetDocumentId: readStableTargetId(entry),
      targetLabel: resolveAuditTargetLabel(entry),
    };
  }

  if (eventName.startsWith('role.')) {
    const actionByEvent: Record<string, AuditAction> = {
      'role.create': AuditAction.AdminRoleCreate,
      'role.update': AuditAction.AdminRoleUpdate,
      'role.delete': AuditAction.AdminRoleDelete,
    };
    return {
      action: actionByEvent[eventName] ?? AuditAction.AdminRoleUpdate,
      targetType: AuditTargetType.AdminRole,
      targetUid: 'admin::role',
      targetDocumentId: readStableTargetId(entry),
      targetLabel: resolveAuditTargetLabel(entry),
    };
  }

  if (eventName === 'admin.logout') {
    return {
      action: AuditAction.AdminLogout,
      targetType: AuditTargetType.Authentication,
      targetUid: 'admin::user',
      targetDocumentId: readStableTargetId(entry),
      targetLabel: resolveAuditTargetLabel(entry),
    };
  }

  return null;
};

export const listAdminAuditEventHubDecisions = (
  eventName: string,
  payload: unknown,
  mutation?: unknown,
): readonly AdminAuditEventHubDecision[] => {
  if (!isAllowlistedAdminAuditEvent(eventName) || isPermissionEventName(eventName)) {
    return [];
  }

  const uid = readUid(payload);
  return readAdminAuditEventHubRecords(payload)
    .map((entry) => mapOneAdminAuditEventHub(eventName, uid, entry, mutation))
    .filter((row): row is AdminAuditEventHubDecision => row !== null);
};

export const mapAdminAuditEventHub = (
  eventName: string,
  payload: unknown,
  mutation?: unknown,
): AdminAuditEventHubDecision | null =>
  listAdminAuditEventHubDecisions(eventName, payload, mutation)[0] ?? null;

export const shouldCaptureAdminAuditEventHub = (
  eventName: string,
  payload: unknown,
  request: Readonly<{
    body?: unknown;
    path?: string;
    routeType?: string;
    hasUser: boolean;
  }>,
): readonly AdminAuditEventHubDecision[] => {
  if (isGenericAuditCaptureSuppressed()) {
    return [];
  }

  if (
    isPermissionEventName(eventName) ||
    eventName === 'admin.auth.error' ||
    // Strapi 5.51.1 emits this before session/token creation. HTTP records the outcome.
    eventName === 'admin.auth.success'
  ) {
    return [];
  }

  if (!isAdminRouteContext(request.routeType, request.hasUser)) {
    return [];
  }

  if (request.path && isExplicitDomainAdminRoute(request.path)) {
    return [];
  }

  if (
    eventName === 'role.update' &&
    request.path &&
    /\/roles\/\d+\/permissions$/.test(request.path.replace(/^\/admin/, ''))
  ) {
    return [];
  }

  return listAdminAuditEventHubDecisions(eventName, payload, request.body);
};
