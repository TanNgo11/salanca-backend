export enum AuditActorType {
  Anonymous = 'anonymous',
  AdminUser = 'admin_user',
  System = 'system',
}

export enum AuditAction {
  CmsEntryCreate = 'cms_entry_create',
  CmsEntryUpdate = 'cms_entry_update',
  CmsEntryDelete = 'cms_entry_delete',
  CmsEntryPublish = 'cms_entry_publish',
  CmsEntryUnpublish = 'cms_entry_unpublish',
  MediaCreate = 'media_create',
  MediaUpdate = 'media_update',
  MediaDelete = 'media_delete',
  MediaFolderCreate = 'media_folder_create',
  MediaFolderUpdate = 'media_folder_update',
  MediaFolderDelete = 'media_folder_delete',
  AdminUserCreate = 'admin_user_create',
  AdminUserUpdate = 'admin_user_update',
  AdminUserActivate = 'admin_user_activate',
  AdminUserDeactivate = 'admin_user_deactivate',
  AdminUserDelete = 'admin_user_delete',
  AdminRoleCreate = 'admin_role_create',
  AdminRoleUpdate = 'admin_role_update',
  AdminRoleDelete = 'admin_role_delete',
  AdminRolePermissionsUpdate = 'admin_role_permissions_update',
  AdminLoginSuccess = 'admin_login_success',
  AdminLoginFailure = 'admin_login_failure',
  AdminLogout = 'admin_logout',
  ApiTokenCreate = 'api_token_create',
  ApiTokenUpdate = 'api_token_update',
  ApiTokenRegenerate = 'api_token_regenerate',
  ApiTokenRevoke = 'api_token_revoke',
  TransferTokenCreate = 'transfer_token_create',
  TransferTokenUpdate = 'transfer_token_update',
  TransferTokenRegenerate = 'transfer_token_regenerate',
  TransferTokenRevoke = 'transfer_token_revoke',
  WebhookCreate = 'webhook_create',
  WebhookUpdate = 'webhook_update',
  WebhookDelete = 'webhook_delete',
}

export enum AuditEventSource {
  AdminPanel = 'admin_panel',
  SystemProcess = 'system_process',
}

export enum AuditEventCategory {
  Account = 'account',
  Content = 'content',
  Error = 'error',
  Security = 'security',
}

export enum AuditTargetType {
  Authentication = 'authentication',
  CmsEntry = 'cms_entry',
  Media = 'media',
  MediaFolder = 'media_folder',
  AdminUser = 'admin_user',
  AdminRole = 'admin_role',
  ApiToken = 'api_token',
  TransferToken = 'transfer_token',
  Webhook = 'webhook',
}

export enum AuditHttpMethod {
  Delete = 'DELETE',
  Get = 'GET',
  Patch = 'PATCH',
  Post = 'POST',
  Put = 'PUT',
}

export interface AuditEventActor {
  documentId?: string;
  label?: string;
  type: AuditActorType;
}

export type AuditGenericIdentityValues = Readonly<{
  changedFields?: readonly string[];
  locale?: string;
  maskedIdentifier?: string;
  publicationStatus?: 'draft' | 'published';
}>;

export type AuditEventValues = AuditGenericIdentityValues;

export interface CreateAuditEventInput {
  action: AuditAction;
  actor: AuditEventActor;
  afterValues?: AuditEventValues;
  beforeValues?: AuditEventValues;
  eventSource?: AuditEventSource;
  httpMethod: AuditHttpMethod;
  identifierFingerprint?: string;
  occurredAt: string;
  requestId: string;
  requestPath: string;
  statusCode: number;
  success: boolean;
  targetDocumentId?: string;
  targetLabel?: string;
  targetType: AuditTargetType;
  targetUid?: string;
}
