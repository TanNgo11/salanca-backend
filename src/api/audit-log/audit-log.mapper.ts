import { listActionsForCategory, resolveAuditEventCategory } from '../../domain/audit/audit-event-category';
import {
  AuditActorType,
  AuditAction,
  AuditEventCategory,
  AuditEventSource,
  AuditTargetType,
} from '../../domain/audit/audit-event.types';
import { normalizeAuditPayload } from '../../domain/audit/audit-payload';

import type {
  ApiAuditLogDetail,
  ApiAuditLogListQuery,
  ApiAuditLogSummary,
  AuditLogStoredRow,
} from './audit-log.types';

const ACTION_VALUES = new Set<string>(Object.values(AuditAction));
const TARGET_TYPE_VALUES = new Set<string>(Object.values(AuditTargetType));
const SOURCE_VALUES = new Set<string>(Object.values(AuditEventSource));

const readAction = (value: string): AuditAction =>
  ACTION_VALUES.has(value) ? (value as AuditAction) : AuditAction.CmsEntryUpdate;

const readTargetType = (value: string | null | undefined): AuditTargetType | null =>
  value && TARGET_TYPE_VALUES.has(value) ? (value as AuditTargetType) : null;

/**
 * Every row persists an explicit source; the table is new so there is no
 * legacy inference. A missing value falls back to admin_panel, the only
 * writer this backend has.
 */
const readEventSource = (value: string | null | undefined): AuditEventSource =>
  value && SOURCE_VALUES.has(value)
    ? (value as AuditEventSource)
    : AuditEventSource.AdminPanel;

const readOccurredAt = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const displayLabel = (value: string | null | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

const displayActorLabel = (
  actorLabel: string | null | undefined,
  actorType: string | null | undefined,
): string => {
  const trimmed = actorLabel?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (actorType === AuditActorType.Anonymous) {
    return 'Ẩn danh';
  }
  if (actorType === AuditActorType.System) {
    return 'Hệ thống';
  }
  return 'Không xác định';
};

export const toAuditLogSummary = (row: AuditLogStoredRow): ApiAuditLogSummary => {
  const action = readAction(row.action);

  return {
    action,
    actorLabel: displayActorLabel(row.actorLabel, row.actorType),
    actorType: row.actorType ?? null,
    category: resolveAuditEventCategory(action, row.success),
    eventId: row.eventId,
    eventSource: readEventSource(row.eventSource),
    occurredAt: readOccurredAt(row.occurredAt),
    success: row.success,
    targetId: row.targetDocumentId,
    targetLabel: displayLabel(row.targetLabel ?? row.targetDocumentId, 'Không xác định'),
    targetType: readTargetType(row.targetType),
    targetUid: row.targetUid ?? null,
  };
};

export const toAuditLogDetail = (row: AuditLogStoredRow): ApiAuditLogDetail => {
  const summary = toAuditLogSummary(row);
  const sanitizeValues = (value: unknown): unknown => {
    if (value == null) {
      return null;
    }
    try {
      return normalizeAuditPayload(value);
    } catch {
      return null;
    }
  };
  const beforeValues = sanitizeValues(row.beforeValues);
  const afterValues = sanitizeValues(row.afterValues);

  return {
    ...summary,
    afterValues,
    beforeValues,
    httpMethod: row.httpMethod,
    requestId: row.requestId,
    requestPath: row.requestPath ?? '',
    statusCode: row.statusCode,
  };
};

export const actionsMatchingQuery = (
  query: ApiAuditLogListQuery,
): readonly AuditAction[] | undefined => {
  if (query.action) {
    if (query.category && query.category !== AuditEventCategory.Error) {
      const allowed = new Set(listActionsForCategory(query.category));
      return allowed.has(query.action) ? [query.action] : [];
    }
    return [query.action];
  }

  if (query.category && query.category !== AuditEventCategory.Error) {
    return listActionsForCategory(query.category);
  }

  return undefined;
};
