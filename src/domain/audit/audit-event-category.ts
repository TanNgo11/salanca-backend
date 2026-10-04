import { AuditAction, AuditEventCategory } from './audit-event.types';

const ACCOUNT_ACTIONS = new Set<AuditAction>([
  AuditAction.AdminUserActivate,
  AuditAction.AdminUserCreate,
  AuditAction.AdminUserDeactivate,
  AuditAction.AdminUserDelete,
  AuditAction.AdminUserUpdate,
]);

const SECURITY_ACTIONS = new Set<AuditAction>([
  AuditAction.AdminLoginFailure,
  AuditAction.AdminLoginSuccess,
  AuditAction.AdminLogout,
  AuditAction.AdminRoleCreate,
  AuditAction.AdminRoleDelete,
  AuditAction.AdminRolePermissionsUpdate,
  AuditAction.AdminRoleUpdate,
  AuditAction.ApiTokenCreate,
  AuditAction.ApiTokenRegenerate,
  AuditAction.ApiTokenRevoke,
  AuditAction.ApiTokenUpdate,
  AuditAction.TransferTokenCreate,
  AuditAction.TransferTokenRegenerate,
  AuditAction.TransferTokenRevoke,
  AuditAction.TransferTokenUpdate,
  AuditAction.WebhookCreate,
  AuditAction.WebhookDelete,
  AuditAction.WebhookUpdate,
]);

export const resolveAuditEventCategory = (
  action: AuditAction,
  success: boolean,
): AuditEventCategory => {
  if (!success) {
    return AuditEventCategory.Error;
  }

  if (SECURITY_ACTIONS.has(action)) {
    return AuditEventCategory.Security;
  }

  if (ACCOUNT_ACTIONS.has(action)) {
    return AuditEventCategory.Account;
  }

  return AuditEventCategory.Content;
};

export const listActionsForCategory = (
  category: AuditEventCategory,
): readonly AuditAction[] => {
  switch (category) {
    case AuditEventCategory.Error:
      return [];
    case AuditEventCategory.Security:
      return [...SECURITY_ACTIONS];
    case AuditEventCategory.Account:
      return [...ACCOUNT_ACTIONS];
    case AuditEventCategory.Content:
      return Object.values(AuditAction).filter(
        (action) =>
          !SECURITY_ACTIONS.has(action) && !ACCOUNT_ACTIONS.has(action),
      );
  }
};
