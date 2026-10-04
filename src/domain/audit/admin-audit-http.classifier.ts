import { AuditAction, AuditHttpMethod, AuditTargetType } from './audit-event.types';
import { normalizeAdminPath } from './admin-audit-coverage';

export interface AdminAuditHttpClassification {
  action: AuditAction;
  captureOn: 'failure' | 'success' | 'outcome';
  successAction?: AuditAction;
  targetType: AuditTargetType;
  targetUid: string;
}

const NUMERIC_ID = '([0-9]+)';

const matchPath = (path: string, pattern: RegExp): RegExpMatchArray | null =>
  normalizeAdminPath(path).match(pattern);

export const classifyAdminAuditHttpRequest = (
  method: string,
  path: string,
): AdminAuditHttpClassification | null => {
  const normalizedMethod = method.toUpperCase();

  if (normalizedMethod === AuditHttpMethod.Post && matchPath(path, /^\/login$/)) {
    return {
      action: AuditAction.AdminLoginFailure,
      captureOn: 'outcome',
      successAction: AuditAction.AdminLoginSuccess,
      targetType: AuditTargetType.Authentication,
      targetUid: 'admin::user',
    };
  }

  if (
    normalizedMethod === AuditHttpMethod.Put &&
    matchPath(path, new RegExp(`^/roles/${NUMERIC_ID}/permissions$`))
  ) {
    return {
      action: AuditAction.AdminRolePermissionsUpdate,
      captureOn: 'success',
      targetType: AuditTargetType.AdminRole,
      targetUid: 'admin::role',
    };
  }

  if (normalizedMethod === AuditHttpMethod.Post && matchPath(path, /^\/api-tokens$/)) {
    return {
      action: AuditAction.ApiTokenCreate,
      captureOn: 'success',
      targetType: AuditTargetType.ApiToken,
      targetUid: 'admin::api-token',
    };
  }

  if (
    normalizedMethod === AuditHttpMethod.Put &&
    matchPath(path, new RegExp(`^/api-tokens/${NUMERIC_ID}$`))
  ) {
    return {
      action: AuditAction.ApiTokenUpdate,
      captureOn: 'success',
      targetType: AuditTargetType.ApiToken,
      targetUid: 'admin::api-token',
    };
  }

  if (
    normalizedMethod === AuditHttpMethod.Post &&
    matchPath(path, new RegExp(`^/api-tokens/${NUMERIC_ID}/regenerate$`))
  ) {
    return {
      action: AuditAction.ApiTokenRegenerate,
      captureOn: 'success',
      targetType: AuditTargetType.ApiToken,
      targetUid: 'admin::api-token',
    };
  }

  if (
    normalizedMethod === AuditHttpMethod.Delete &&
    matchPath(path, new RegExp(`^/api-tokens/${NUMERIC_ID}$`))
  ) {
    return {
      action: AuditAction.ApiTokenRevoke,
      captureOn: 'success',
      targetType: AuditTargetType.ApiToken,
      targetUid: 'admin::api-token',
    };
  }

  if (
    normalizedMethod === AuditHttpMethod.Post &&
    matchPath(path, /^\/transfer\/tokens$/)
  ) {
    return {
      action: AuditAction.TransferTokenCreate,
      captureOn: 'success',
      targetType: AuditTargetType.TransferToken,
      targetUid: 'admin::transfer-token',
    };
  }

  if (
    normalizedMethod === AuditHttpMethod.Put &&
    matchPath(path, new RegExp(`^/transfer/tokens/${NUMERIC_ID}$`))
  ) {
    return {
      action: AuditAction.TransferTokenUpdate,
      captureOn: 'success',
      targetType: AuditTargetType.TransferToken,
      targetUid: 'admin::transfer-token',
    };
  }

  if (
    normalizedMethod === AuditHttpMethod.Post &&
    matchPath(path, new RegExp(`^/transfer/tokens/${NUMERIC_ID}/regenerate$`))
  ) {
    return {
      action: AuditAction.TransferTokenRegenerate,
      captureOn: 'success',
      targetType: AuditTargetType.TransferToken,
      targetUid: 'admin::transfer-token',
    };
  }

  if (
    normalizedMethod === AuditHttpMethod.Delete &&
    matchPath(path, new RegExp(`^/transfer/tokens/${NUMERIC_ID}$`))
  ) {
    return {
      action: AuditAction.TransferTokenRevoke,
      captureOn: 'success',
      targetType: AuditTargetType.TransferToken,
      targetUid: 'admin::transfer-token',
    };
  }

  if (normalizedMethod === AuditHttpMethod.Post && matchPath(path, /^\/webhooks$/)) {
    return {
      action: AuditAction.WebhookCreate,
      captureOn: 'success',
      targetType: AuditTargetType.Webhook,
      targetUid: 'admin::webhook',
    };
  }

  if (
    normalizedMethod === AuditHttpMethod.Put &&
    matchPath(path, new RegExp(`^/webhooks/${NUMERIC_ID}$`))
  ) {
    return {
      action: AuditAction.WebhookUpdate,
      captureOn: 'success',
      targetType: AuditTargetType.Webhook,
      targetUid: 'admin::webhook',
    };
  }

  if (
    normalizedMethod === AuditHttpMethod.Delete &&
    matchPath(path, new RegExp(`^/webhooks/${NUMERIC_ID}$`))
  ) {
    return {
      action: AuditAction.WebhookDelete,
      captureOn: 'success',
      targetType: AuditTargetType.Webhook,
      targetUid: 'admin::webhook',
    };
  }

  if (
    normalizedMethod === AuditHttpMethod.Post &&
    matchPath(path, /^\/webhooks\/batch-delete$/)
  ) {
    return {
      action: AuditAction.WebhookDelete,
      captureOn: 'success',
      targetType: AuditTargetType.Webhook,
      targetUid: 'admin::webhook',
    };
  }

  return null;
};

export const readNumericPathTargetId = (path: string): string | undefined => {
  const match = normalizeAdminPath(path).match(/\/(\d+)(?:\/[a-z-]+)?$/i);
  return match?.[1];
};
