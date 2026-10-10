import { mkdtemp, rm } from 'node:fs/promises';
import { createReadStream, type ReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

/**
 * Strapi's `replace` keeps the file hash, so a replaced image is written over
 * the same storage keys. Objects are stored with
 * `Cache-Control: immutable` (config/media-storage.helper.ts), so browsers and
 * the CDN would keep the old picture for up to a year.
 *
 * This replace stores the new file under a fresh hash instead. It runs the
 * same steps as Strapi's upload (`formatFileInfo`, optimize, `_uploadImage`,
 * provider upload) and writes the result onto the existing row, so every
 * document that points at the file id keeps pointing at it. No temporary row
 * is created, so only `media.update` is emitted.
 *
 * The previous objects are NOT deleted here: ISR pages cached before the
 * replace still reference the old URLs. `pnpm media:reconcile -- --delete-orphans`
 * removes them once they are older than the grace period.
 *
 * Mirrors `@strapi/upload` 5.51.1 `services/upload.js` (`enhanceAndValidateFile`,
 * `replace`). Re-check against that file on every Strapi upgrade.
 */
const FILE_MODEL_UID = 'plugin::upload.file';

/** Fields that describe the stored object; everything else stays on the row. */
export const REPLACED_FILE_FIELDS = [
  'name',
  'alternativeText',
  'caption',
  'focalPoint',
  'hash',
  'ext',
  'mime',
  'size',
  'width',
  'height',
  'url',
  'previewUrl',
  'formats',
  'provider',
  'provider_metadata',
] as const;

type FileRow = Readonly<Record<string, unknown> & { id: number | string }>;

/** Strapi's working file object; mutated in place by optimize and the provider. */
export type UploadFileData = Record<string, unknown> & {
  getStream?: () => ReadStream;
  filepath?: string;
};

/** Koa/formidable file handed to the admin replace controller. */
type IncomingFile = Readonly<{
  filepath: string;
  originalFilename?: string | null;
  mimetype?: string | null;
  detectedMimeType?: string | null;
  size: number;
}>;

type ReplaceOptions = Readonly<{ user?: Readonly<{ id: number | string }> }> | undefined;

type ReplaceInput = Readonly<{
  data: Readonly<{ fileInfo?: Readonly<Record<string, unknown>> }>;
  file: IncomingFile;
}>;

export type MediaReplace = (
  id: number | string,
  input: ReplaceInput,
  opts?: ReplaceOptions,
) => Promise<unknown>;

export type FreshHashReplaceDeps = Readonly<{
  findOne: (id: number | string) => Promise<FileRow | null | undefined>;
  /** Upload service `formatFileInfo`: name, fresh hash, ext, folder fields. */
  formatFileInfo: (
    file: Readonly<{ filename: string; type: string; size: number }>,
    fileInfo: Readonly<Record<string, unknown>>,
    metas: Readonly<{ tmpWorkingDirectory: string }>,
  ) => Promise<UploadFileData>;
  isImage: (file: UploadFileData) => Promise<boolean>;
  isFaultyImage: (file: UploadFileData) => Promise<boolean>;
  isOptimizableImage: (file: UploadFileData) => Promise<boolean>;
  optimize: (file: UploadFileData) => Promise<UploadFileData>;
  checkFileSize: (file: UploadFileData) => Promise<void>;
  /** Upload service `_uploadImage`: original + thumbnail + responsive formats. */
  uploadImage: (file: UploadFileData) => Promise<void>;
  uploadFile: (file: UploadFileData) => Promise<void>;
  providerName: () => string;
  /** Re-saves the row through Strapi so `media.update` fires and `updatedBy` is set. */
  updateFileInfo: (
    id: number | string,
    info: Readonly<Record<string, never>>,
    opts?: ReplaceOptions,
  ) => Promise<unknown>;
  /** Tells the web to revalidate pages that embed the old URL. */
  onReplaced: (fileId: number | string) => void;
}>;

export const pickReplacedFields = (row: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const fields: Record<string, unknown> = {};
  for (const key of REPLACED_FILE_FIELDS) {
    if (row[key] !== undefined) fields[key] = row[key];
  }
  return fields;
};

/** Same MIME preference as Strapi: detected type, then a real declared type. */
export const resolveMimeType = (file: IncomingFile): string => {
  const declared = file.mimetype ?? '';
  return (
    file.detectedMimeType
    || (declared && declared !== 'application/octet-stream' ? declared : undefined)
    || 'application/octet-stream'
  );
};

const prepareFile = async (
  deps: FreshHashReplaceDeps,
  file: IncomingFile,
  fileInfo: Readonly<Record<string, unknown>>,
  tmpWorkingDirectory: string,
): Promise<UploadFileData> => {
  const fileData = await deps.formatFileInfo(
    { filename: file.originalFilename ?? 'unamed', type: resolveMimeType(file), size: file.size },
    fileInfo,
    { tmpWorkingDirectory },
  );
  fileData.filepath = file.filepath;
  fileData.getStream = () => createReadStream(file.filepath);

  if (await deps.isImage(fileData)) {
    if (await deps.isFaultyImage(fileData)) {
      throw new errors.ApplicationError('File is not a valid image');
    }
    if (await deps.isOptimizableImage(fileData)) {
      return deps.optimize(fileData);
    }
  }
  return fileData;
};

export const createFreshHashReplace =
  (strapi: Core.Strapi, deps: FreshHashReplaceDeps): MediaReplace =>
  async (id, { data, file }, opts) => {
    const existing = await deps.findOne(id);
    if (!existing) {
      throw new errors.NotFoundError();
    }

    const tmpWorkingDirectory = await mkdtemp(path.join(tmpdir(), 'strapi-upload-'));
    try {
      const fileData = await prepareFile(deps, file, data.fileInfo ?? {}, tmpWorkingDirectory);
      await deps.checkFileSize(fileData);
      // Reset what the old file described, as stock replace does: a new file
      // with no derivatives (SVG, tiny image, PDF) must not inherit the old
      // formats or dimensions. uploadImage fills them again for an image.
      Object.assign(fileData, { formats: {}, width: null, height: null });
      if (await deps.isImage(fileData)) {
        await deps.uploadImage(fileData);
      } else {
        await deps.uploadFile(fileData);
      }
      fileData.provider = deps.providerName();

      const fields = pickReplacedFields(fileData);
      // Keep the row's name unless the editor typed a new one, as stock replace
      // does.
      if (typeof data.fileInfo?.name !== 'string' || data.fileInfo.name.trim() === '') {
        delete fields.name;
      }
      await strapi.db.query(FILE_MODEL_UID).update({ where: { id }, data: fields });
    } finally {
      await rm(tmpWorkingDirectory, { recursive: true, force: true });
    }

    const result = await deps.updateFileInfo(id, {}, opts);
    deps.onReplaced(id);
    return result;
  };
