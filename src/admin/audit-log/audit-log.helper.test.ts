import { describe, expect, it } from 'vitest';

import { AuditAction } from '../../domain/audit/audit-event.types';
import {
  allowlistedTargetPath,
  auditLogCalendarValueToDate,
  auditLogContentTypeLabel,
  auditLogDateToCalendarValue,
  defaultAuditLogDraftFilters,
  draftFiltersToQuery,
  draftFiltersToUrlParams,
  countActiveAuditLogFilters,
  formatAuditLogAction,
  formatAuditLogTarget,
  listAuditLogActionOptions,
  listAuditLogSourceOptions,
  parseAuditLogListResponse,
  queryParamsToDraftFilters,
  readAuditLogValueRows,
  readChangedFields,
  toggleAuditLogQuickCategory,
} from './audit-log.helper';

describe('audit log Admin helpers', () => {
  it('maps known actions to Vietnamese labels instead of raw keys', () => {
    expect(formatAuditLogAction('cms_entry_publish')).toBe('Xuất bản');
    expect(formatAuditLogAction('not_a_real_action')).toBe('Hoạt động hệ thống');
    expect(formatAuditLogAction('admin_login_failure')).toBe(
      'Đăng nhập Admin thất bại',
    );
  });

  it('gives every persisted audit action a specific Vietnamese label', () => {
    const fallback = 'Hoạt động hệ thống';
    const unlabeled = Object.values(AuditAction).filter(
      (action) => formatAuditLogAction(action) === fallback,
    );
    expect(unlabeled).toEqual([]);
    expect(formatAuditLogAction(AuditAction.AdminRoleCreate)).toBe(
      'Tạo vai trò Admin',
    );
    expect(formatAuditLogAction(AuditAction.MediaFolderDelete)).toBe(
      'Xóa thư mục media',
    );
    expect(formatAuditLogAction(AuditAction.TransferTokenRevoke)).toBe(
      'Thu hồi transfer token',
    );
  });

  it('labels Salanca content types with their schema display names', () => {
    expect(auditLogContentTypeLabel('api::contact-message.contact-message')).toBe(
      'Tin nhắn liên hệ',
    );
    expect(
      auditLogContentTypeLabel('api::reservation-request.reservation-request'),
    ).toBe('Yêu cầu đặt bàn');
    expect(auditLogContentTypeLabel('api::unknown.type')).toBeNull();
  });

  it('counts only the filters the user narrowed', () => {
    const draft = defaultAuditLogDraftFilters(new Date('2026-09-05T03:00:00.000Z'));
    expect(countActiveAuditLogFilters(draft)).toBe(0);
    expect(
      countActiveAuditLogFilters({ ...draft, category: 'security', search: ' an ' }),
    ).toBe(2);
  });

  it('lists action filter options with Vietnamese labels', () => {
    const options = listAuditLogActionOptions();
    expect(options.length).toBe(Object.values(AuditAction).length);
    expect(options.some((option) => option.value === 'admin_role_create')).toBe(
      true,
    );
    const securityValues = listAuditLogActionOptions('security').map(
      (option) => option.value,
    );
    expect(securityValues).toContain('admin_login_success');
    expect(securityValues).toContain('admin_role_create');
    expect(securityValues).not.toContain('cms_entry_publish');
  });

  it('serializes Vietnam calendar dates into a half-open UTC range', () => {
    const query = draftFiltersToQuery(
      {
        ...defaultAuditLogDraftFilters(new Date('2026-08-27T10:00:00+07:00')),
        from: '2026-08-27',
        to: '2026-08-27',
      },
      1,
    );
    expect(query.from).toBe('2026-08-26T17:00:00.000Z');
    expect(query.toExclusive).toBe('2026-08-27T17:00:00.000Z');
  });

  it('formats audit targets with readable type labels and compact identifiers', () => {
    expect(
      formatAuditLogTarget({
        targetId: 'wtyxrx9bk9dndtf5di4gzhqb',
        targetLabel: 'wtyxrx9bk9dndtf5di4gzhqb',
        targetType: 'cms_entry',
        targetUid: 'api::contact-message.contact-message',
      }),
    ).toEqual({
      accessibleLabel: 'Tin nhắn liên hệ, Mã: wtyxrx9b…4gzhqb',
      detail: 'Mã: wtyxrx9b…4gzhqb',
      fullIdentifier: 'wtyxrx9bk9dndtf5di4gzhqb',
      typeLabel: 'Tin nhắn liên hệ',
    });
    expect(
      formatAuditLogTarget({
        targetId: '4',
        targetLabel: 'Biên tập',
        targetType: 'admin_role',
        targetUid: 'admin::role',
      }),
    ).toMatchObject({
      detail: 'Biên tập',
      typeLabel: 'Vai trò Admin',
    });
    expect(
      formatAuditLogTarget({
        targetId: null,
        targetLabel: 'Không xác định',
        targetType: null,
        targetUid: null,
      }),
    ).toMatchObject({
      detail: null,
      typeLabel: 'Đối tượng hệ thống',
    });
  });

  it('bridges calendar strings to the Design System date picker without UTC drift', () => {
    const date = auditLogCalendarValueToDate('2026-08-28');
    expect(date).toBeDefined();
    expect(auditLogDateToCalendarValue(date as Date)).toBe('2026-08-28');
    expect(auditLogCalendarValueToDate('not-a-date')).toBeUndefined();
    expect(auditLogCalendarValueToDate('2026-02-31')).toBeUndefined();
  });

  it('never builds a target link from an arbitrary stored path', () => {
    expect(
      allowlistedTargetPath('api::contact-message.contact-message', 'doc-1'),
    ).toContain('api::contact-message.contact-message');
    expect(allowlistedTargetPath('plugin::evil.model', 'doc-1')).toBeNull();
  });

  it('round-trips draft filters through bookmarkable URL params', () => {
    const draft = {
      ...defaultAuditLogDraftFilters(new Date('2026-08-27T10:00:00+07:00')),
      action: 'cms_entry_publish',
      category: 'content',
      from: '2026-08-01',
      search: 'Nguyễn',
      source: 'system_process',
      success: 'true',
      to: '2026-08-27',
    };
    const restored = queryParamsToDraftFilters(
      new URLSearchParams(draftFiltersToUrlParams(draft, 3)),
    );
    expect(restored.page).toBe(3);
    expect(restored.draft).toEqual(draft);
  });

  it('restores filters from a bookmarked URL instead of the 30-day default', () => {
    const restored = queryParamsToDraftFilters(
      new URLSearchParams(
        'page=2&from=2026-08-10&to=2026-08-20&category=security&action=admin_login_failure&source=admin_panel&success=false&search=Lan',
      ),
    );
    expect(restored.page).toBe(2);
    expect(restored.draft).toMatchObject({
      action: 'admin_login_failure',
      category: 'security',
      from: '2026-08-10',
      search: 'Lan',
      source: 'admin_panel',
      success: 'false',
      to: '2026-08-20',
    });
  });

  it('sends the source filter to the API as eventSource', () => {
    const base = defaultAuditLogDraftFilters(new Date('2026-08-27T10:00:00+07:00'));
    expect(draftFiltersToQuery(base, 1).eventSource).toBeUndefined();
    expect(
      draftFiltersToQuery({ ...base, source: 'system_process' }, 1).eventSource,
    ).toBe('system_process');
  });

  it('toggles the error shortcut without leaving a hidden failure filter behind', () => {
    const base = defaultAuditLogDraftFilters(new Date('2026-08-27T10:00:00+07:00'));
    const enabled = toggleAuditLogQuickCategory(base, 'error');

    expect(enabled).toMatchObject({
      action: '',
      category: 'error',
      success: 'false',
    });
    expect(toggleAuditLogQuickCategory(enabled, 'error')).toMatchObject({
      action: '',
      category: '',
      success: '',
    });
  });

  it('clears the error-only result when switching to a business category', () => {
    const base = defaultAuditLogDraftFilters(new Date('2026-08-27T10:00:00+07:00'));
    const errorDraft = toggleAuditLogQuickCategory(base, 'error');

    expect(toggleAuditLogQuickCategory(errorDraft, 'content')).toMatchObject({
      category: 'content',
      success: '',
    });
  });

  it('lists every event source as a filter option', () => {
    const values = listAuditLogSourceOptions().map((option) => option.value);
    expect(values).toEqual(['admin_panel', 'system_process']);
    expect(
      listAuditLogSourceOptions().find((option) => option.value === 'system_process')
        ?.label,
    ).toBe('Hệ thống');
  });

  it('reads typed before/after rows instead of only changedFields', () => {
    expect(
      readChangedFields({
        changedFields: ['title', 'slug'],
        locale: 'vi',
      }),
    ).toEqual(['title', 'slug']);
    expect(
      readAuditLogValueRows({
        changedFields: ['title'],
        locale: 'vi',
        publicationStatus: 'published',
      }),
    ).toEqual([
      { key: 'Ngôn ngữ', value: 'vi' },
      { key: 'Trạng thái xuất bản', value: 'Đã xuất bản' },
    ]);
  });

  it('reads a paginated list envelope', () => {
    expect(
      parseAuditLogListResponse({
        data: [{ eventId: 'e1', occurredAt: '2026-08-27T00:00:00.000Z' }],
        meta: { pagination: { pageCount: 2, total: 26 } },
      }),
    ).toEqual({
      items: [{ eventId: 'e1', occurredAt: '2026-08-27T00:00:00.000Z' }],
      pageCount: 2,
      total: 26,
    });
  });
});
