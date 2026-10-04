import { describe, expect, it } from 'vitest';

import {
  isAuditLedgerUid,
  isExplicitDomainAdminRoute,
  isPermissionEventName,
  normalizeAdminPath,
} from './admin-audit-coverage';

describe('admin audit coverage registry', () => {
  it('normalizes Admin and unprefixed paths the same way', () => {
    expect(normalizeAdminPath('/admin/roles/1/permissions')).toBe(
      '/roles/1/permissions',
    );
    expect(normalizeAdminPath('/roles/1/permissions')).toBe(
      '/roles/1/permissions',
    );
  });

  it('marks the audit-log Admin routes as explicit custom domain routes', () => {
    expect(isExplicitDomainAdminRoute('/admin/audit-log/events')).toBe(true);
    expect(isExplicitDomainAdminRoute('/audit-log/export')).toBe(true);
    expect(
      isExplicitDomainAdminRoute(
        '/content-manager/collection-types/api::article.article',
      ),
    ).toBe(false);
  });

  it('never treats permission EventHub names as persistable', () => {
    expect(isPermissionEventName('permission.create')).toBe(true);
    expect(isPermissionEventName('permission.update')).toBe(true);
    expect(isPermissionEventName('permission.delete')).toBe(true);
    expect(isPermissionEventName('role.update')).toBe(false);
  });

  it('only treats the audit ledger UID as suppressed', () => {
    expect(isAuditLedgerUid('api::audit-event.audit-event')).toBe(true);
    expect(isAuditLedgerUid('api::article.article')).toBe(false);
  });
});
