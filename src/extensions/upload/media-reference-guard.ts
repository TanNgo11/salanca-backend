import type { Core, UID } from '@strapi/strapi';
import { errors } from '@strapi/utils';

/**
 * Strapi's upload service deletes the stored object first and the database row
 * second, without checking whether any document still points at the file. That
 * silently breaks every document referencing it, so deletion is guarded here —
 * in the backend, not as an Admin-only warning.
 */
const FILE_MODEL_UID = 'plugin::upload.file';

export type MediaFileReference = Readonly<{
  id: number | string;
  name?: string;
}>;

export type MediaRemove = (file: MediaFileReference) => Promise<unknown>;

type MediaFileRow = Readonly<{
  name?: unknown;
  related?: unknown;
}>;

const toReferencingUids = (related: unknown): string[] => {
  if (!Array.isArray(related)) {
    return [];
  }

  const uids: string[] = [];

  for (const entry of related) {
    const type: unknown = (entry as Readonly<{ __type?: unknown }> | null)?.__type;

    if (typeof type === 'string' && type && !uids.includes(type)) {
      uids.push(type);
    }
  }

  return uids;
};

const toDisplayName = (strapi: Core.Strapi, uid: string): string => {
  const contentType = strapi.contentType(uid as UID.ContentType);
  const displayName = contentType?.info?.displayName;

  return typeof displayName === 'string' && displayName ? displayName : uid;
};

/**
 * Wraps the upload plugin's `remove` so a file that is still referenced by a
 * document can never reach the provider delete call.
 */
export const createReferenceSafeRemove =
  (strapi: Core.Strapi, remove: MediaRemove): MediaRemove =>
  async (file: MediaFileReference): Promise<unknown> => {
    const row = (await strapi.db.query(FILE_MODEL_UID).findOne({
      where: { id: file.id },
      populate: ['related'],
    })) as MediaFileRow | null;

    const referencingUids = toReferencingUids(row?.related);

    if (referencingUids.length > 0) {
      const fileName = typeof row?.name === 'string' ? row.name : (file.name ?? String(file.id));
      const usedBy = referencingUids.map((uid) => toDisplayName(strapi, uid)).join(', ');

      throw new errors.ApplicationError(
        `Không thể xoá tệp "${fileName}" vì đang được sử dụng trong: ${usedBy}. ` +
          'Hãy gỡ tệp khỏi các nội dung đó trước khi xoá.',
        { fileId: file.id, referencedBy: referencingUids },
      );
    }

    return remove(file);
  };
