import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapAuditLogPermissions,
  registerAuditLogPermissions,
} from './index';
import { AUDIT_LOG_INDEX_STATEMENTS } from './audit-log.indexes';

describe('Admin audit-log lifecycle', () => {
  it('registers actions only during register and bootstraps indexes and Super Admin access', async () => {
    const registerMany = vi.fn();
    const raw = vi.fn().mockResolvedValue(undefined);
    const resetSuperAdminPermissions = vi.fn().mockResolvedValue(undefined);
    const strapi = {
      admin: {
        services: {
          permission: { actionProvider: { registerMany } },
          role: { resetSuperAdminPermissions },
        },
      },
      db: { connection: { raw } },
    } as never;

    registerAuditLogPermissions(strapi);
    await bootstrapAuditLogPermissions(strapi);

    expect(registerMany).toHaveBeenCalledOnce();
    expect(raw).toHaveBeenCalledTimes(AUDIT_LOG_INDEX_STATEMENTS.length);
    expect(resetSuperAdminPermissions).toHaveBeenCalledOnce();
  });
});
