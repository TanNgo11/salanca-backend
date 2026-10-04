import type { Core } from '@strapi/strapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../domain/audit/admin-audit-request', () => ({
  writeAdminAuditForCurrentRequest: vi.fn(),
}));

import { writeAdminAuditForCurrentRequest } from '../../domain/audit/admin-audit-request';

import {
  createAuditedFolderUpdate,
  createAuditedMediaRemove,
} from './admin-audit-media';

const writeMock = vi.mocked(writeAdminAuditForCurrentRequest);

const createStrapi = (storedName?: string) =>
  ({
    db: {
      query: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(storedName ? { name: storedName } : null),
      }),
    },
  }) as unknown as Core.Strapi;

describe('createAuditedMediaRemove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes media_delete after remove resolves, using the file name', async () => {
    const strapi = createStrapi();
    const remove = vi.fn().mockResolvedValue(undefined);
    const audited = createAuditedMediaRemove(strapi, remove);

    await audited({ id: 7, documentId: 'doc7', name: 'photo.jpg' });

    expect(remove).toHaveBeenCalledWith({ id: 7, documentId: 'doc7', name: 'photo.jpg' });
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith(strapi, {
      action: 'media_delete',
      eventName: 'media.delete',
      targetDocumentId: 'doc7',
      targetLabel: 'photo.jpg',
      targetType: 'media',
      targetUid: 'plugin::upload.file',
    });
    expect(strapi.db.query).not.toHaveBeenCalled();
  });

  it('falls back to the stored file name when the payload has none', async () => {
    const strapi = createStrapi('stored.png');
    const remove = vi.fn().mockResolvedValue(undefined);
    const audited = createAuditedMediaRemove(strapi, remove);

    await audited({ id: 9 });

    expect(writeMock).toHaveBeenCalledWith(
      strapi,
      expect.objectContaining({
        action: 'media_delete',
        targetDocumentId: '9',
        targetLabel: 'stored.png',
      }),
    );
  });

  it('does not write audit when remove rejects', async () => {
    const strapi = createStrapi();
    const remove = vi.fn().mockRejectedValue(new Error('blocked'));
    const audited = createAuditedMediaRemove(strapi, remove);

    await expect(audited({ id: 1, name: 'a.jpg' })).rejects.toThrow('blocked');
    expect(writeMock).not.toHaveBeenCalled();
  });
});

describe('createAuditedFolderUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes media_folder_update after a successful rename', async () => {
    const strapi = createStrapi();
    const update = vi
      .fn()
      .mockResolvedValue({ id: 3, documentId: 'f3', name: 'New name' });
    const audited = createAuditedFolderUpdate(strapi, update);

    await audited(3, { name: 'New name' });

    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith(strapi, {
      action: 'media_folder_update',
      eventName: 'media-folder.update',
      targetDocumentId: 'f3',
      targetLabel: 'New name',
      targetType: 'media_folder',
      targetUid: 'plugin::upload.folder',
    });
  });

  it('writes audit for a move (parent change) too', async () => {
    const strapi = createStrapi();
    const update = vi
      .fn()
      .mockResolvedValue({ id: 4, documentId: 'f4', name: 'Folder', parent: 8 });
    const audited = createAuditedFolderUpdate(strapi, update);

    await audited(4, { parent: 8 });

    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith(
      strapi,
      expect.objectContaining({
        action: 'media_folder_update',
        targetDocumentId: 'f4',
        targetLabel: 'Folder',
      }),
    );
  });

  it('skips audit when the folder is missing (update returns null)', async () => {
    const strapi = createStrapi();
    const update = vi.fn().mockResolvedValue(null);
    const audited = createAuditedFolderUpdate(strapi, update);

    await audited(5, { name: 'x' });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('does not write audit when update rejects', async () => {
    const strapi = createStrapi();
    const update = vi.fn().mockRejectedValue(new Error('conflict'));
    const audited = createAuditedFolderUpdate(strapi, update);

    await expect(audited(5, { name: 'x' })).rejects.toThrow('conflict');
    expect(writeMock).not.toHaveBeenCalled();
  });
});
