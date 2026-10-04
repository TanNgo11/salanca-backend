import { describe, expect, it } from 'vitest';

import { AuditActorType, AuditEventSource } from '../../domain/audit/audit-event.types';

import { toAuditLogSummary } from './audit-log.mapper';
import type { AuditLogStoredRow } from './audit-log.types';

const row = (patch: Partial<AuditLogStoredRow>): AuditLogStoredRow => ({
  action: 'cms_entry_update',
  actorDocumentId: null,
  actorLabel: 'Nguyễn Văn An',
  actorType: AuditActorType.AdminUser,
  afterValues: null,
  beforeValues: null,
  eventId: 'evt-1',
  eventSource: AuditEventSource.AdminPanel,
  httpMethod: 'PUT',
  occurredAt: '2026-08-27T07:32:00.000Z',
  requestId: 'req-1',
  requestPath: '/admin/content-manager/collection-types/api::article.article/a1',
  statusCode: 200,
  success: true,
  targetDocumentId: 'a1',
  targetLabel: 'Bài viết',
  targetType: 'cms_entry',
  targetUid: 'api::article.article',
  ...patch,
});

describe('toAuditLogSummary', () => {
  it('reads the stored event source directly and defaults to admin_panel', () => {
    expect(toAuditLogSummary(row({})).eventSource).toBe(AuditEventSource.AdminPanel);
    expect(
      toAuditLogSummary(row({ eventSource: AuditEventSource.SystemProcess }))
        .eventSource,
    ).toBe(AuditEventSource.SystemProcess);
    expect(toAuditLogSummary(row({ eventSource: null })).eventSource).toBe(
      AuditEventSource.AdminPanel,
    );
  });

  it('distinguishes anonymous, system, and unknown actors when no label exists', () => {
    expect(
      toAuditLogSummary(
        row({
          actorType: AuditActorType.Anonymous,
          actorLabel: null,
        }),
      ).actorLabel,
    ).toBe('Ẩn danh');
    expect(
      toAuditLogSummary(
        row({
          actorType: AuditActorType.System,
          actorLabel: null,
        }),
      ).actorLabel,
    ).toBe('Hệ thống');
    expect(
      toAuditLogSummary(
        row({
          actorType: null,
          actorLabel: null,
        }),
      ).actorLabel,
    ).toBe('Không xác định');
  });

  it('exposes only a recognized target type in list summaries', () => {
    expect(toAuditLogSummary(row({ targetType: 'media' })).targetType).toBe('media');
    expect(toAuditLogSummary(row({ targetType: 'not-a-target' })).targetType).toBeNull();
  });
});
