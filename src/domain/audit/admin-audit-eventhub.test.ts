import { describe, expect, it } from 'vitest';

import {
  listAdminAuditEventHubDecisions,
  mapAdminAuditEventHub,
  shouldCaptureAdminAuditEventHub,
} from './admin-audit-eventhub';
import { withGenericAuditCaptureSuppressed } from './audit-event.suppression';
import { AuditAction } from './audit-event.types';

const adminRequest = {
  hasUser: true,
  path: '/admin/content-manager/collection-types/api::article.article',
  routeType: 'admin',
};

const adminUsersRequest = {
  hasUser: true,
  path: '/admin/users/batch-delete',
  routeType: 'admin',
};

describe('mapAdminAuditEventHub', () => {
  it('maps one CMS target from an allowlisted entry event', () => {
    expect(
      mapAdminAuditEventHub('entry.publish', {
        uid: 'api::article.article',
        entry: { documentId: 'art-1', title: 'Tin mới', locale: 'vi' },
      }),
    ).toEqual({
      action: AuditAction.CmsEntryPublish,
      targetType: 'cms_entry',
      targetUid: 'api::article.article',
      targetDocumentId: 'art-1',
      targetLabel: 'Tin mới',
      locale: 'vi',
      publicationStatus: 'published',
    });
  });

  it('does not persist permission events or the audit ledger', () => {
    expect(
      mapAdminAuditEventHub('permission.create', { uid: 'admin::permission' }),
    ).toBeNull();
    expect(
      mapAdminAuditEventHub('entry.create', {
        uid: 'api::audit-event.audit-event',
        entry: { documentId: 'evt-1' },
      }),
    ).toBeNull();
  });

  it('maps wrapper-owned media events to null (they are not EventHub rows)', () => {
    expect(
      mapAdminAuditEventHub('media-folder.update', {
        folder: { id: 9, name: 'Tài liệu' },
      }),
    ).toBeNull();
    expect(
      mapAdminAuditEventHub('media.delete', {
        media: { id: 5, name: 'x.jpg' },
      }),
    ).toBeNull();
  });

  it('unwraps Strapi 5.51.1 role and media-folder payloads', () => {
    expect(
      mapAdminAuditEventHub('role.create', {
        role: { id: 4, name: 'Biên tập', code: 'editor' },
      }),
    ).toMatchObject({
      action: AuditAction.AdminRoleCreate,
      targetDocumentId: '4',
      targetLabel: 'Biên tập',
      targetUid: 'admin::role',
    });
    expect(
      mapAdminAuditEventHub('media-folder.create', {
        folder: { id: 9, name: 'Tài liệu' },
      }),
    ).toMatchObject({
      action: AuditAction.MediaFolderCreate,
      targetDocumentId: '9',
      targetLabel: 'Tài liệu',
      targetUid: 'plugin::upload.folder',
    });
  });

  it('writes one row per target for bulk user and folder deletes', () => {
    const users = listAdminAuditEventHubDecisions('user.delete', {
      users: [
        { id: 11, firstname: 'An', lastname: 'Nguyễn', email: 'an@example.com' },
        { id: 12, firstname: 'Bình', email: 'binh@example.com' },
      ],
    });
    expect(users).toHaveLength(2);
    expect(users.map((row) => row.targetDocumentId)).toEqual(['11', '12']);
    expect(users.map((row) => row.targetLabel)).toEqual([
      'an@example.com',
      'binh@example.com',
    ]);
    expect(users.every((row) => row.action === AuditAction.AdminUserDelete)).toBe(
      true,
    );

    const folders = listAdminAuditEventHubDecisions('media-folder.delete', {
      folders: [
        { id: 21, name: 'Banner' },
        { id: 22, name: 'Hồ sơ' },
      ],
    });
    expect(folders).toHaveLength(2);
    expect(folders.map((row) => row.targetDocumentId)).toEqual(['21', '22']);
    expect(folders.map((row) => row.targetLabel)).toEqual(['Banner', 'Hồ sơ']);
  });

  it('does not treat an active-user profile edit as activation', () => {
    expect(
      mapAdminAuditEventHub('user.update', {
        user: {
          id: 8,
          firstname: 'Lan',
          email: 'lan@example.com',
          isActive: true,
        },
      })?.action,
    ).toBe(AuditAction.AdminUserUpdate);
    expect(
      mapAdminAuditEventHub(
        'user.update',
        { user: { id: 8, firstname: 'Lan', isActive: true } },
        { firstname: 'Lan', email: 'lan@example.com', isActive: true, roles: [1] },
      )?.action,
    ).toBe(AuditAction.AdminUserUpdate);
  });

  it('classifies isActive-only mutations as activate or deactivate', () => {
    expect(
      mapAdminAuditEventHub(
        'user.update',
        { user: { id: 8, firstname: 'Lan', isActive: true } },
        { isActive: true },
      )?.action,
    ).toBe(AuditAction.AdminUserActivate);
    expect(
      mapAdminAuditEventHub(
        'user.update',
        { user: { id: 8, firstname: 'Lan', isActive: false } },
        { isActive: false },
      )?.action,
    ).toBe(AuditAction.AdminUserDeactivate);
  });
});

describe('shouldCaptureAdminAuditEventHub', () => {
  it('requires an authenticated Admin route', () => {
    expect(
      shouldCaptureAdminAuditEventHub(
        'entry.update',
        { uid: 'api::article.article', entry: { documentId: 'a' } },
        { hasUser: false, routeType: 'admin' },
      ),
    ).toEqual([]);
    expect(
      shouldCaptureAdminAuditEventHub(
        'entry.update',
        { uid: 'api::article.article', entry: { documentId: 'a' } },
        { hasUser: true, routeType: 'content-api' },
      ),
    ).toEqual([]);
  });

  it('skips the audit-log Admin routes and the audit ledger UID', () => {
    expect(
      shouldCaptureAdminAuditEventHub(
        'entry.publish',
        { uid: 'api::article.article', entry: { documentId: 'p1' } },
        {
          hasUser: true,
          path: '/admin/audit-log/events',
          routeType: 'admin',
        },
      ),
    ).toEqual([]);
    expect(
      shouldCaptureAdminAuditEventHub(
        'entry.create',
        { uid: 'api::audit-event.audit-event', entry: { documentId: 'e1' } },
        adminRequest,
      ),
    ).toEqual([]);
  });

  it('leaves media.delete and media-folder.update to the upload wrappers', () => {
    expect(
      shouldCaptureAdminAuditEventHub(
        'media.delete',
        { media: { id: 5, documentId: 'm5', name: 'x.jpg' } },
        adminRequest,
      ),
    ).toEqual([]);
    expect(
      shouldCaptureAdminAuditEventHub(
        'media-folder.update',
        { folder: { id: 9, name: 'Tài liệu' } },
        adminRequest,
      ),
    ).toEqual([]);
  });

  it('does not persist permission noise from role or token services', () => {
    expect(
      shouldCaptureAdminAuditEventHub(
        'permission.delete',
        {},
        { hasUser: true, path: '/admin/roles/1/permissions', routeType: 'admin' },
      ),
    ).toEqual([]);
  });

  it('captures Content Manager lead edits so later saves can store changed fields', () => {
    expect(
      shouldCaptureAdminAuditEventHub(
        'entry.update',
        {
          uid: 'api::contact-message.contact-message',
          entry: { documentId: 'c1', name: 'An' },
        },
        {
          hasUser: true,
          path: '/admin/content-manager/collection-types/api::contact-message.contact-message/c1',
          routeType: 'admin',
        },
      ).map((row) => row.action),
    ).toEqual([AuditAction.CmsEntryUpdate]);
  });

  it('captures Content Manager article edits', () => {
    expect(
      shouldCaptureAdminAuditEventHub(
        'entry.update',
        { uid: 'api::article.article', entry: { documentId: 'a1', title: 'Sửa' } },
        adminRequest,
      ).map((row) => row.action),
    ).toEqual([AuditAction.CmsEntryUpdate]);
  });

  it('uses the request body to distinguish profile edits from activation', () => {
    expect(
      shouldCaptureAdminAuditEventHub(
        'user.update',
        { user: { id: 8, firstname: 'Lan', isActive: true } },
        {
          body: { firstname: 'Lan', isActive: true, roles: [1] },
          hasUser: true,
          path: '/admin/users/8',
          routeType: 'admin',
        },
      ).map((row) => row.action),
    ).toEqual([AuditAction.AdminUserUpdate]);
  });

  it('captures one decision per bulk-deleted Admin user', () => {
    expect(
      shouldCaptureAdminAuditEventHub(
        'user.delete',
        {
          users: [
            { id: 11, email: 'an@example.com' },
            { id: 12, email: 'binh@example.com' },
          ],
        },
        adminUsersRequest,
      ).map((row) => row.targetDocumentId),
    ).toEqual(['11', '12']);
  });

  it('does not capture admin.auth.success before session issuance', () => {
    expect(
      shouldCaptureAdminAuditEventHub(
        'admin.auth.success',
        { user: { id: 3, email: 'an@example.com' } },
        { hasUser: true, path: '/admin/login', routeType: 'admin' },
      ),
    ).toEqual([]);
    expect(
      mapAdminAuditEventHub('admin.auth.success', {
        user: { id: 3, email: 'an@example.com' },
      }),
    ).toBeNull();
  });

  it('skips capture while the append service is writing', async () => {
    await withGenericAuditCaptureSuppressed(async () => {
      expect(
        shouldCaptureAdminAuditEventHub(
          'entry.create',
          { uid: 'api::article.article', entry: { documentId: 'a1' } },
          adminRequest,
        ),
      ).toEqual([]);
    });
  });
});
