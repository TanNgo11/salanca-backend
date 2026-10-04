import { describe, expect, it } from 'vitest';

import { listActionsForCategory, resolveAuditEventCategory } from './audit-event-category';
import { AuditAction, AuditEventCategory } from './audit-event.types';

describe('resolveAuditEventCategory', () => {
  it('maps security, account, and content actions', () => {
    expect(resolveAuditEventCategory(AuditAction.AdminLoginSuccess, true)).toBe(
      AuditEventCategory.Security,
    );
    expect(resolveAuditEventCategory(AuditAction.AdminRoleUpdate, true)).toBe(
      AuditEventCategory.Security,
    );
    expect(resolveAuditEventCategory(AuditAction.ApiTokenRevoke, true)).toBe(
      AuditEventCategory.Security,
    );
    expect(resolveAuditEventCategory(AuditAction.AdminUserCreate, true)).toBe(
      AuditEventCategory.Account,
    );
    expect(resolveAuditEventCategory(AuditAction.CmsEntryPublish, true)).toBe(
      AuditEventCategory.Content,
    );
    expect(resolveAuditEventCategory(AuditAction.MediaFolderDelete, true)).toBe(
      AuditEventCategory.Content,
    );
  });

  it('classifies failed outcomes as the error group without changing the action', () => {
    expect(resolveAuditEventCategory(AuditAction.CmsEntryUpdate, false)).toBe(
      AuditEventCategory.Error,
    );
    expect(resolveAuditEventCategory(AuditAction.AdminLoginFailure, false)).toBe(
      AuditEventCategory.Error,
    );
    expect(listActionsForCategory(AuditEventCategory.Error)).toEqual([]);
  });
});
