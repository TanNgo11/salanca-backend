import { describe, expect, it, vi } from 'vitest';

import { createAuditEvent } from './audit-event.service';
import {
  wasAuditRequestCaptured,
  withAuditRequestCapture,
} from './audit-request-capture';
import {
  AuditAction,
  AuditActorType,
  AuditHttpMethod,
  AuditTargetType,
} from './audit-event.types';

const input = {
  action: AuditAction.CmsEntryUpdate,
  actor: { type: AuditActorType.AdminUser, documentId: 'user-document' },
  httpMethod: AuditHttpMethod.Post,
  occurredAt: '2026-09-08T07:00:00.000Z',
  requestId: 'request-typed-audit',
  requestPath: '/admin/content-manager/collection-types/api::article.article/doc',
  statusCode: 200,
  success: true,
  targetDocumentId: 'doc',
  targetType: AuditTargetType.CmsEntry,
};

describe('createAuditEvent request capture', () => {
  it('marks the request only after the audit row was persisted', async () => {
    const create = vi.fn(async () => ({ documentId: 'audit-document' }));

    await withAuditRequestCapture(async () => {
      expect(wasAuditRequestCaptured(input.requestId)).toBe(false);
      await createAuditEvent({ documents: () => ({ create }) } as never, input);
      expect(wasAuditRequestCaptured(input.requestId)).toBe(true);
    });

    expect(create).toHaveBeenCalledOnce();
  });

  it('does not suppress generic coverage when persistence failed', async () => {
    const create = vi.fn(async () => { throw new Error('audit unavailable'); });

    await withAuditRequestCapture(async () => {
      await expect(
        createAuditEvent({ documents: () => ({ create }) } as never, input),
      ).rejects.toThrow('audit unavailable');
      expect(wasAuditRequestCaptured(input.requestId)).toBe(false);
    });
  });
});
