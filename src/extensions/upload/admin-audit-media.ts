import type { Core } from '@strapi/strapi';

import { writeAdminAuditForCurrentRequest } from '../../domain/audit/admin-audit-request';
import { AuditAction, AuditTargetType } from '../../domain/audit/audit-event.types';
import {
  readStableTargetId,
  resolveAuditTargetLabel,
} from '../../domain/audit/audit-target-label';
import { isPlainRecord, trimmedNonEmptyString } from '../../shared/normalization/value';

import type { MediaFileReference, MediaRemove } from './media-reference-guard';

const FILE_MODEL_UID = 'plugin::upload.file';

export type FolderUpdate = (
  id: number | string,
  data: { name?: string; parent?: number | string | null },
  opts?: unknown,
) => Promise<unknown>;

const readStoredFileName = async (
  strapi: Core.Strapi,
  id: number | string,
): Promise<string | undefined> => {
  const row = (await strapi.db.query(FILE_MODEL_UID).findOne({
    where: { id },
  })) as { name?: unknown } | null;
  return trimmedNonEmptyString(row?.name) ?? undefined;
};

/**
 * Upstream @strapi/upload emits media.delete BEFORE the file row is removed,
 * so the EventHub subscriber ignores that event. This wrapper writes the
 * media_delete row itself after the wrapped remove resolves successfully —
 * composed on top of the reference-safe remove in strapi-server.ts.
 */
export const createAuditedMediaRemove =
  (strapi: Core.Strapi, remove: MediaRemove): MediaRemove =>
  async (file: MediaFileReference): Promise<unknown> => {
    const targetLabel =
      resolveAuditTargetLabel(file) ?? (await readStoredFileName(strapi, file.id));
    const result = await remove(file);
    writeAdminAuditForCurrentRequest(strapi, {
      action: AuditAction.MediaDelete,
      eventName: 'media.delete',
      targetDocumentId: readStableTargetId(file),
      targetLabel,
      targetType: AuditTargetType.Media,
      targetUid: FILE_MODEL_UID,
    });
    return result;
  };

/**
 * Upstream @strapi/upload skips media-folder.update for a name-only rename.
 * The EventHub subscriber ignores that event entirely; this wrapper writes
 * media_folder_update after update resolves for both rename and move.
 */
export const createAuditedFolderUpdate =
  (strapi: Core.Strapi, update: FolderUpdate): FolderUpdate =>
  async (id, data, opts) => {
    const folder = await update(id, data, opts);
    if (!isPlainRecord(folder)) {
      return folder;
    }
    writeAdminAuditForCurrentRequest(strapi, {
      action: AuditAction.MediaFolderUpdate,
      eventName: 'media-folder.update',
      targetDocumentId: readStableTargetId(folder) ?? String(id),
      targetLabel:
        resolveAuditTargetLabel(folder) ??
        trimmedNonEmptyString(data?.name) ??
        undefined,
      targetType: AuditTargetType.MediaFolder,
      targetUid: 'plugin::upload.folder',
    });
    return folder;
  };
