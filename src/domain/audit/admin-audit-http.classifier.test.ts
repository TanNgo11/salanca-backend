import { describe, expect, it } from 'vitest';

import { classifyAdminAuditHttpRequest } from './admin-audit-http.classifier';
import { AuditAction } from './audit-event.types';

describe('classifyAdminAuditHttpRequest', () => {
  it('classifies failed-login, role-permission, token, and webhook routes exactly', () => {
    expect(classifyAdminAuditHttpRequest('POST', '/admin/login')?.action).toBe(
      AuditAction.AdminLoginFailure,
    );
    expect(classifyAdminAuditHttpRequest('POST', '/admin/login')?.successAction).toBe(
      AuditAction.AdminLoginSuccess,
    );
    expect(classifyAdminAuditHttpRequest('POST', '/admin/login')?.captureOn).toBe(
      'outcome',
    );
    expect(
      classifyAdminAuditHttpRequest('PUT', '/admin/roles/12/permissions')?.action,
    ).toBe(AuditAction.AdminRolePermissionsUpdate);
    expect(classifyAdminAuditHttpRequest('POST', '/api-tokens')?.action).toBe(
      AuditAction.ApiTokenCreate,
    );
    expect(
      classifyAdminAuditHttpRequest('POST', '/admin/api-tokens/3/regenerate')?.action,
    ).toBe(AuditAction.ApiTokenRegenerate);
    expect(classifyAdminAuditHttpRequest('DELETE', '/api-tokens/3')?.action).toBe(
      AuditAction.ApiTokenRevoke,
    );
    expect(
      classifyAdminAuditHttpRequest('POST', '/transfer/tokens')?.action,
    ).toBe(AuditAction.TransferTokenCreate);
    expect(classifyAdminAuditHttpRequest('PUT', '/webhooks/9')?.action).toBe(
      AuditAction.WebhookUpdate,
    );
    expect(
      classifyAdminAuditHttpRequest('POST', '/webhooks/batch-delete')?.action,
    ).toBe(AuditAction.WebhookDelete);
  });

  it('ignores unknown Admin routes rather than guessing', () => {
    expect(classifyAdminAuditHttpRequest('GET', '/admin/users')).toBeNull();
    expect(classifyAdminAuditHttpRequest('POST', '/admin/unknown-resource')).toBeNull();
    expect(classifyAdminAuditHttpRequest('PUT', '/roles/abc/permissions')).toBeNull();
  });

  it('keeps token and webhook cardinality at one row per request', () => {
    expect(
      classifyAdminAuditHttpRequest('POST', '/webhooks/batch-delete')?.captureOn,
    ).toBe('success');
    expect(
      classifyAdminAuditHttpRequest('PUT', '/roles/1/permissions')?.captureOn,
    ).toBe('success');
  });
});
